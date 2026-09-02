import { describe, expect, it } from 'vitest';

import heroesJson from '../src/data/heroes.json';
import type { Role } from '../src/data/types';
import { runMatch } from '../src/sim/match';
import { createStubCombatResolver } from '../src/sim/stubCombat';
import { createCombatResolver } from '../src/sim/combat';
import { RngStream } from '../src/sim/rng';
import { isValidDeployment } from '../src/sim/board';
import {
  accountLevels,
  createAccount,
  credit,
  maxStarsOf,
  moduleById,
  openShop,
} from '../src/sim/modules';
import type { StreakKind } from '../src/sim/types';
import { balancedDraft, roleStackDraft } from '../src/ai/draft';
import { resolvePolicy, seatArchetypes } from '../src/ai/archetypes';
import { ARCHETYPES } from '../src/ai/types';
import type { ArchetypeName } from '../src/ai/types';

/*
 * M7 — the five AI opponents. Covers every plan assertion:
 *  - every AI decision draws from its OWN per-player, per-round substream, so
 *    adding a bot / changing one bot's archetype / one bot drawing more values
 *    shifts NO other seat's rolls (`substream isolation`);
 *  - no AI drives tokens < 0, buys a rarity-locked / maxed module, or
 *    refreshes what it cannot afford — asserted on the ATTEMPT, not just the
 *    library's refusal (`legality fuzz`, 10 000 turns);
 *  - every AI fields exactly 6 heroes and a legal 6×4 deployment every round;
 *  - over 100 seeded AI-only matches no archetype wins < 5 % or > 50 %
 *    (`distribution gate`, with a readable per-archetype table);
 *  - token conservation holds for every player at every phase boundary.
 */

const stub = (): ReturnType<typeof createStubCombatResolver> => createStubCombatResolver();

const ROLE_OF: Readonly<Record<string, Role>> = Object.fromEntries(
  (heroesJson as readonly { id: string; role: Role }[]).map((h) => [h.id, h.role]),
);
const heroesOf = (role: Role): string[] =>
  (heroesJson as readonly { id: string; role: Role }[]).filter((h) => h.role === role).map((h) => h.id);
/** A fixed 2-2-2 lineup for the shop fuzz (its exact heroes don't matter). */
const FUZZ_LINEUP: readonly string[] = [
  ...heroesOf('vanguard').slice(0, 2),
  ...heroesOf('duelist').slice(0, 2),
  ...heroesOf('strategist').slice(0, 2),
];

// ---------------------------------------------------------------------------
// 1. Substream isolation
// ---------------------------------------------------------------------------

/** Substream keys that reference seat `id` (its own draws + its matchups). */
function mentionsSeat(key: string, id: number): boolean {
  return (key.split('#')[0] ?? '').split(':').includes(String(id));
}
function stripSeat(subs: Readonly<Record<string, number>>, id: number): Record<string, number> {
  return Object.fromEntries(Object.entries(subs).filter(([k]) => !mentionsSeat(k, id)));
}

describe('substream isolation', () => {
  it("swapping a seat's archetype shifts NO other seat's substream cursors", () => {
    // The M7 RNG invariant, stated precisely. Greedy Banker (35-token reserve,
    // few early buys) vs Streak Rider (dumps to 0 on a loss streak) — both draft
    // with `balancedDraft`, so seat 3's lineup is identical and only its shop /
    // deploy behaviour differs, drawing very different amounts from `shop:3#r`.
    for (const seed of [1, 2, 7, 100, 2024, 31337]) {
      const a = runMatch(seed, [], stub(), { ai: { 3: 'greedy-banker' } });
      const b = runMatch(seed, [], stub(), { ai: { 3: 'streak-rider' } });
      expect(a.boundaries.length).toBe(b.boundaries.length);
      for (let i = 0; i < a.boundaries.length; i++) {
        expect(
          stripSeat(b.boundaries[i]!.state.rng.substreams, 3),
          `seed ${seed} @${a.boundaries[i]!.label} non-seat-3 substreams`,
        ).toEqual(stripSeat(a.boundaries[i]!.state.rng.substreams, 3));
      }
    }
  });

  it("swapping a seat's archetype leaves every other seat's state byte-identical (stub combat)", () => {
    // Under stub combat a matchup's result is a pure function of its own
    // `combat:*` substream — independent of lineups / modules / deployment — so
    // if seat 3's build changes, ONLY seat 3's own state may move.
    for (const seed of [1, 2, 7, 100, 2024, 31337]) {
      const a = runMatch(seed, [], stub(), { ai: { 3: 'greedy-banker' } });
      const b = runMatch(seed, [], stub(), { ai: { 3: 'streak-rider' } });
      for (let i = 0; i < a.boundaries.length; i++) {
        for (const pid of [0, 1, 2, 4, 5]) {
          expect(
            JSON.stringify(b.boundaries[i]!.state.players[pid]),
            `seed ${seed} @${a.boundaries[i]!.label} player ${pid}`,
          ).toBe(JSON.stringify(a.boundaries[i]!.state.players[pid]));
        }
      }
      // ...and seat 3 itself really did diverge (the swap was not a no-op).
      const last = a.boundaries.length - 1;
      expect(JSON.stringify(a.boundaries[last]!.state.players[3])).not.toBe(
        JSON.stringify(b.boundaries[last]!.state.players[3]),
      );
    }
  });

  it('aiOnly matches replay to an identical boundary-hash sequence', () => {
    for (const seed of [3, 42, 999, 20260902]) {
      const r1 = runMatch(seed, [], stub(), { ai: 'aiOnly' });
      const r2 = runMatch(seed, [], stub(), { ai: 'aiOnly' });
      expect(r2.boundaries.map((x) => x.hash)).toEqual(r1.boundaries.map((x) => x.hash));
      expect(r2.boundaries.map((x) => x.label)).toEqual(r1.boundaries.map((x) => x.label));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Legality fuzz — 10 000 shop turns
// ---------------------------------------------------------------------------

describe('legality fuzz (10,000 shop turns)', () => {
  it('no AI ever asks for an illegal buy / refresh, drives tokens < 0, or over-stars a module', () => {
    const master = new RngStream(0x7a1efee1);
    const rng = master.stream('ai-fuzz');
    const streaks: readonly StreakKind[] = ['win', 'loss', 'none'];
    let turns = 0;

    for (let iter = 0; iter < 1400 && turns < 10_000; iter++) {
      const archetype = ARCHETYPES[rng.int(0, ARCHETYPES.length - 1)]!;
      const policy = resolvePolicy(archetype);
      const acc = createAccount(rng.int(0, 40));

      for (let round = 1; round <= 12 && turns < 10_000; round++) {
        credit(acc, rng.int(0, 25)); // round-income-ish top-up
        const shopSub = master.stream(`ai-fuzz:${iter}:${round}`);
        const shop = openShop(round, accountLevels(acc), acc.owned, shopSub, null);

        // `executeShopPlan` THROWS on any refused buy / refresh — the policy's
        // pre-checks must make sure it never asks.
        policy.runShopTurn({
          round,
          account: acc,
          shop,
          rng: shopSub,
          streakKind: streaks[rng.int(0, 2)]!,
          streak: rng.int(1, 8),
          lineup: FUZZ_LINEUP,
          roleOf: ROLE_OF,
        });
        turns++;

        expect(acc.tokens, `${archetype} tokens >= 0`).toBeGreaterThanOrEqual(0);
        expect(
          acc.earned + acc.refunded,
          `${archetype} conserves`,
        ).toBe(acc.spent + acc.tokens);
        for (const owned of acc.owned) {
          expect(owned.stars, `${archetype} ${owned.moduleId} stars`).toBeGreaterThanOrEqual(1);
          expect(
            owned.stars,
            `${archetype} ${owned.moduleId} over max stars`,
          ).toBeLessThanOrEqual(maxStarsOf(moduleById(owned.moduleId)));
        }
        for (const xp of Object.values(acc.protocolXp)) {
          expect(xp, `${archetype} protocol xp >= 0`).toBeGreaterThanOrEqual(0);
        }
      }
    }

    expect(turns).toBeGreaterThanOrEqual(10_000);
  });
});

// ---------------------------------------------------------------------------
// 3. Lineup + deployment legality, every round
// ---------------------------------------------------------------------------

describe('lineup + deployment legality', () => {
  it('every bot fields exactly 6 unique in-pool heroes and a legal 6×4 deployment, every round', () => {
    for (const seed of [10, 11, 12, 20, 21, 33]) {
      const res = runMatch(seed, [], stub(), { ai: 'aiOnly' });
      for (const b of res.boundaries) {
        for (const p of b.state.players) {
          if (!p.alive) continue;
          expect(p.lineup, `seed ${seed} @${b.label} p${p.id} lineup size`).toHaveLength(6);
          expect(new Set(p.lineup).size, `seed ${seed} @${b.label} p${p.id} lineup unique`).toBe(6);
          const pool = new Set(p.pool);
          expect(p.lineup.every((h) => pool.has(h)), `seed ${seed} p${p.id} lineup in pool`).toBe(true);

          // Deployment is set on the Select Position phase and persists.
          if (b.round >= 1 && b.phase >= 2) {
            expect(p.deployment, `seed ${seed} @${b.label} p${p.id} has a deployment`).not.toBeNull();
            expect(
              isValidDeployment(p.deployment!, 6),
              `seed ${seed} @${b.label} p${p.id} deployment legal`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('the draft helpers always return exactly 6 distinct in-pool heroes', () => {
    const master = new RngStream(0xd4a7);
    for (let i = 0; i < 200; i++) {
      const pool = master
        .stream(`pool:${i}`)
        .shuffle([...heroesOf('vanguard'), ...heroesOf('duelist'), ...heroesOf('strategist')])
        .slice(0, 18);
      const poolSet = new Set(pool);
      const check = (lineup: string[]): void => {
        expect(lineup).toHaveLength(6);
        expect(new Set(lineup).size).toBe(6);
        expect(lineup.every((h) => poolSet.has(h))).toBe(true);
      };
      check(balancedDraft(pool, ROLE_OF, master.stream(`b:${i}`)));
      for (const role of ['vanguard', 'duelist', 'strategist'] as const) {
        for (const want of [0, 2, 4, 5, 6]) {
          check(roleStackDraft({ pool, roleOf: ROLE_OF, rng: master.stream(`s:${i}:${role}:${want}`) }, role, want));
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The distribution gate — 100 seeded AI-only matches
// ---------------------------------------------------------------------------

describe('distribution gate', () => {
  it('over 100 seeded AI-only matches, no archetype wins < 5 % or > 50 %', () => {
    const wins: Record<ArchetypeName, number> = {
      'greedy-banker': 0,
      'protocol-rusher': 0,
      'equilibrium-purist': 0,
      'streak-rider': 0,
      adaptive: 0,
    };
    const seats: Record<ArchetypeName, number> = { ...wins };

    for (let seed = 0; seed < 100; seed++) {
      const rotation = seatArchetypes(seed >>> 0);
      for (const a of rotation) seats[a]++;
      const res = runMatch(seed, [], createCombatResolver(), { ai: 'aiOnly' });
      const winnerId = res.finalState.winnerId;
      expect(winnerId, `seed ${seed} has a winner`).not.toBeNull();
      wins[rotation[winnerId!]!]++;
    }

    const table = ARCHETYPES.map((a) => ({
      archetype: a,
      wins: wins[a],
      'win% (of 100)': wins[a],
      seatsOccupied: seats[a],
      'per-seat win%': +((100 * wins[a]) / seats[a]).toFixed(1),
    }));
    console.table(table); // the readable per-archetype report the plan asks for

    for (const a of ARCHETYPES) {
      expect(wins[a], `${a} win% (of 100)`).toBeGreaterThanOrEqual(5);
      expect(wins[a], `${a} win% (of 100)`).toBeLessThanOrEqual(50);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Token conservation at every phase boundary
// ---------------------------------------------------------------------------

describe('token conservation', () => {
  it('earned + refunded === spent + tokens for every player at every boundary of a full match', () => {
    for (const seed of [5, 55, 555, 2024, 90210]) {
      const res = runMatch(seed, [], stub(), { ai: 'aiOnly' });
      for (const b of res.boundaries) {
        for (const p of b.state.players) {
          const { earned, spent, refunded } = p.tokenLedger;
          expect(earned + refunded, `seed ${seed} @${b.label} p${p.id} conserves`).toBe(
            spent + p.tokens,
          );
        }
      }
    }
  });
});
