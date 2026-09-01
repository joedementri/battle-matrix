import { describe, expect, it } from 'vitest';

import { PRACTICE_REWARD_COUNTS, PRACTICE_ROUNDS } from '../src/data/constants';
import { createCombatResolver, simulateBattle } from '../src/sim/combat';
import { createStubCombatResolver } from '../src/sim/stubCombat';
import { galactaWave } from '../src/sim/galacta';
import { runMatch } from '../src/sim/match';
import {
  accountLevels,
  buyModule,
  convertOnSwapOut,
  createAccount,
  openShop,
  totalStrengthen,
} from '../src/sim/modules';
import type { ShopState, StrengthenInventory } from '../src/sim/modules';
import {
  autoFillStrengthenReward,
  grantStrengthenPicks,
  openStrengthenReward,
  pickStrengthenReward,
  practiceRewardCount,
  refreshStrengthenReward,
  strengthenHeroOf,
  strengthenIdsForHero,
} from '../src/sim/practice';
import { RngStream } from '../src/sim/rng';
import { hashState } from '../src/sim/types';
import type { Action, CombatContext, CombatResolver, MatchResult, PhaseBoundary } from '../src/sim/types';

/*
 * M6 — Practice Protocol: Galacta Bot waves and the reward phase (phase 4).
 * Reference facts (the Practice-round list, the reward counts) are transcribed
 * from the plan so a bug in the sim and a matching bug here cannot pass together.
 */

const PRACTICE = [1, 6, 11, 16, 21];
const REWARDS = [1, 1, 2, 2, 2];

const stub = (): CombatResolver => createStubCombatResolver();

function boundary(res: MatchResult, label: string): PhaseBoundary | undefined {
  return res.boundaries.find((b) => b.label === label);
}

// ---------------------------------------------------------------------------
// 1. Practice rounds award exactly 1 / 1 / 2 / 2 / 2 Strengthen Modules
// ---------------------------------------------------------------------------

describe('Practice reward counts', () => {
  it('rounds 1/6/11/16/21 are the Practice rounds and pay 1/1/2/2/2', () => {
    expect(PRACTICE).toEqual([...PRACTICE_ROUNDS]);
    expect(REWARDS).toEqual([...PRACTICE_REWARD_COUNTS]);
    for (let r = 1; r <= 25; r++) {
      const idx = PRACTICE.indexOf(r);
      expect(practiceRewardCount(r)).toBe(idx >= 0 ? REWARDS[idx] : 0);
    }
  });

  it('every living player gains exactly the reward count across each Practice round (runMatch)', () => {
    for (const seed of [1, 7, 42]) {
      const res = runMatch(seed, [], stub());
      for (let i = 0; i < PRACTICE.length; i++) {
        const round = PRACTICE[i]!;
        const pre = boundary(res, `${round}-3`); // battle phase, before the reward grant
        const post = boundary(res, `${round}-4`); // reward phase, after the grant
        if (pre === undefined || post === undefined) break; // match ended before this round
        for (const p of post.state.players) {
          if (!p.alive) continue;
          const before = totalStrengthen(pre.state.players[p.id]!.strengthen);
          const after = totalStrengthen(p.strengthen);
          expect(after - before, `seed ${seed} round ${round} player ${p.id}`).toBe(REWARDS[i]);
        }
      }
    }
  });

  it('non-Practice rounds have no phase 4 and never move a Strengthen count', () => {
    const res = runMatch(2024, [], stub());
    const byRound = new Map<number, PhaseBoundary[]>();
    for (const b of res.boundaries.slice(1)) {
      const list = byRound.get(b.round) ?? [];
      list.push(b);
      byRound.set(b.round, list);
    }
    for (const [round, list] of byRound) {
      if (PRACTICE.includes(round)) continue;
      expect(list.every((b) => b.phase <= 3)).toBe(true);
      // no strengthen delta from the first to the last phase of a battle round
      const first = list[0]!.state.players.map((p) => totalStrengthen(p.strengthen));
      const last = list[list.length - 1]!.state.players.map((p) => totalStrengthen(p.strengthen));
      expect(last).toEqual(first);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Offers: 3 cards, scoped to the current lineup, excluding owned
// ---------------------------------------------------------------------------

describe('reward offers', () => {
  const LINEUP = ['captain-america', 'hulk', 'wolverine', 'black-widow', 'mantis', 'loki'];
  const rng = () => new RngStream(99).stream('reward:0', 1);

  it('are always 3 cards, always Strengthen Modules for heroes in the current lineup', () => {
    const state = openStrengthenReward(1, 1, LINEUP, [], rng());
    expect(state.offers).toHaveLength(3);
    for (const id of state.offers) expect(LINEUP).toContain(strengthenHeroOf(id));
  });

  it('exclude modules the player already owns for that hero', () => {
    const owned = [...strengthenIdsForHero('loki'), 'mantis-s1'];
    const state = openStrengthenReward(6, 1, LINEUP, owned, rng());
    for (const id of state.offers) expect(owned).not.toContain(id);
  });

  it('pickStrengthenReward records offers only, ignores non-offers, dupes and overflow', () => {
    const s0 = openStrengthenReward(11, 2, LINEUP, [], rng()); // 3 offers, need 2
    const first = s0.offers[0]!;
    const s1 = pickStrengthenReward(s0, first);
    expect(s1.picks).toEqual([first]);
    expect(pickStrengthenReward(s1, first).picks).toEqual([first]); // no duplicate pick
    expect(pickStrengthenReward(s1, 'not-an-offer').picks).toEqual([first]); // must be on offer
    const s2 = pickStrengthenReward(s1, s0.offers[1]!);
    const s3 = pickStrengthenReward(s2, s0.offers[2]!); // already have `needed` → ignored
    expect(s3.picks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Refresh — usable exactly once per phase
// ---------------------------------------------------------------------------

describe('reward refresh', () => {
  const LINEUP = ['captain-america', 'hulk', 'wolverine', 'black-widow', 'mantis', 'loki'];
  const sub = () => new RngStream(3).stream('reward:0', 11);

  it('the free REFRESH 1/1 redraws once; a second call is a no-op', () => {
    const s = sub();
    const s0 = openStrengthenReward(11, 2, LINEUP, [], s);
    const s1 = refreshStrengthenReward(s0, LINEUP, [], s);
    expect(s1.refreshesUsed).toBe(1);
    const s2 = refreshStrengthenReward(s1, LINEUP, [], s);
    expect(s2).toEqual(s1); // unchanged: offers and refreshesUsed identical
  });

  it('via runMatch: two refreshReward actions on round 1 phase 4 still grant exactly one pick', () => {
    const actions: Action[] = [
      { type: 'confirmPhase' }, // draft
      { type: 'confirmPhase' }, // 1-1
      { type: 'confirmPhase' }, // 1-2
      { type: 'confirmPhase' }, // 1-3
      { type: 'refreshReward' },
      { type: 'refreshReward' },
      { type: 'confirmPhase' }, // 1-4
    ];
    const res = runMatch(555, actions, stub());
    const p0pre = totalStrengthen(boundary(res, '1-3')!.state.players[0]!.strengthen);
    const p0post = totalStrengthen(boundary(res, '1-4')!.state.players[0]!.strengthen);
    expect(p0post - p0pre).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Shrinking-pool edge case — offer fewer cards, never throw
// ---------------------------------------------------------------------------

describe('shrinking eligible pool', () => {
  const LINEUP = ['captain-america', 'hulk', 'wolverine', 'black-widow', 'mantis', 'loki'];
  const allOwned = LINEUP.flatMap((h) => strengthenIdsForHero(h)); // 12 candidates
  const sub = () => new RngStream(1).stream('reward:0', 16);

  it('every candidate owned → 0 offers, and a grant of nothing is a clean no-op', () => {
    const state = openStrengthenReward(16, 2, LINEUP, allOwned, sub());
    expect(state.offers).toHaveLength(0);
    const filled = autoFillStrengthenReward(state);
    expect(filled.picks).toHaveLength(0);
    const inv: StrengthenInventory = { equipped: {}, selectable: [] };
    expect(totalStrengthen(grantStrengthenPicks(inv, filled.picks))).toBe(0);
  });

  it('only 1 candidate left but 2 needed → 1 offer, auto-fill grants 1, no throw', () => {
    const owned = allOwned.filter((id) => id !== 'loki-s1');
    const state = openStrengthenReward(21, 2, LINEUP, owned, sub());
    expect(state.offers).toEqual(['loki-s1']);
    const filled = autoFillStrengthenReward(state);
    expect(filled.picks).toEqual(['loki-s1']);
  });
});

// ---------------------------------------------------------------------------
// 5. Reward granted regardless of the PvE outcome
// ---------------------------------------------------------------------------

function forcedPveResolver(pveResult: 'win' | 'loss' | 'tie'): CombatResolver {
  return {
    resolve(ctx: CombatContext) {
      if (ctx.matchupKind === 'pve') return { result: pveResult, survivingUnits: 6 };
      return { result: 'tie', survivingUnits: 1 }; // minimal drain for the PvP rounds
    },
  };
}

describe('reward is unconditional / PvE is health-neutral', () => {
  it('a forced PvE LOSS still grants the full reward on round 1', () => {
    const res = runMatch(31337, [], forcedPveResolver('loss'));
    const pre = boundary(res, '1-3')!;
    const post = boundary(res, '1-4')!;
    for (const p of post.state.players) {
      const before = totalStrengthen(pre.state.players[p.id]!.strengthen);
      expect(totalStrengthen(p.strengthen) - before).toBe(1);
      expect(p.lastRoundResult).toBe('loss'); // it really was a PvE loss
    }
  });

  it('no health is lost on a Practice round even when the PvE round is a loss', () => {
    const res = runMatch(31337, [], forcedPveResolver('loss'));
    for (const round of PRACTICE) {
      const p2 = boundary(res, `${round}-2`);
      const p4 = boundary(res, `${round}-4`);
      if (p2 === undefined || p4 === undefined) break;
      for (const p of p4.state.players) {
        expect(p.health, `round ${round} player ${p.id} health held`).toBe(
          p2.state.players[p.id]!.health,
        );
      }
      const battle = boundary(res, `${round}-3`)!;
      for (const m of battle.state.matchups) {
        expect(m.kind).toBe('pve');
        expect(m.healthLossA).toBe(0);
        expect(m.healthLossB).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. `B MODULES` mid-battle — M4's ResolvedUnit freeze, proven end to end
// ---------------------------------------------------------------------------

describe('B MODULES is live in the Battle Phase but effects apply next round', () => {
  it('a module bought mid-battle changes nothing this battle and raises max health next battle', () => {
    const lineupA = ['captain-america', 'hulk', 'thor', 'groot', 'venom', 'magneto']; // 6 Vanguards
    const lineupB = ['black-widow', 'hawkeye', 'hela', 'storm', 'iron-man', 'namor'];
    const ctx = (): CombatContext => ({
      round: 3,
      roundType: 'battle',
      matchupKind: 'pvp',
      sideA: { playerId: 0, lineup: lineupA, isPhantom: false, isGalactaBots: false },
      sideB: { playerId: 1, lineup: lineupB, isPhantom: false, isGalactaBots: false },
      rng: new RngStream(1).stream('c', 3),
    });

    const account = createAccount(999);
    const asSide = () => ({ owned: account.owned.map((o) => ({ ...o })), protocolLevels: accountLevels(account) });

    // Battle 1: no modules. Capture every side-A unit's max health for the whole battle.
    let shop: ShopState = openShop(3, accountLevels(account), account.owned, new RngStream(1).stream('shop', 3));
    const frozenMax: Record<number, number> = {};
    const battle1 = simulateBattle(ctx(), {
      tieCapTicks: 200,
      sideAModules: asSide(),
      onTick: (f) => {
        for (const u of f.units) {
          if (u.side !== 0) continue;
          if (frozenMax[u.id] === undefined) frozenMax[u.id] = u.maxHealth;
          // mid-battle: "press B" and buy a Vanguard health module — the running
          // battle's resolved units must NOT move.
          if (f.tick === 60 && shop.slots.some((c) => c !== null)) {
            const slot = shop.slots.findIndex(
              (c) => c !== null && c.moduleId === 'fortress-health-expansion',
            );
            if (slot >= 0) shop = buyModule(account, shop, slot).shop;
          }
          expect(u.maxHealth).toBe(frozenMax[u.id]);
        }
      },
    });
    expect(battle1.tickCount).toBeGreaterThan(60);

    // If the mid-battle draw never surfaced the module, buy it now off a fresh shop.
    if (account.owned.length === 0) {
      let s2 = openShop(4, accountLevels(account), account.owned, new RngStream(9).stream('shop', 4));
      let guard = 0;
      while (account.owned.length === 0 && guard++ < 50) {
        const slot = s2.slots.findIndex(
          (c) => c !== null && c.moduleId === 'fortress-health-expansion',
        );
        if (slot >= 0) s2 = buyModule(account, s2, slot).shop;
        else s2 = openShop(4, accountLevels(account), account.owned, new RngStream(9 + guard).stream('shop', 4));
      }
    }
    expect(account.owned).toHaveLength(1);

    // Battle 2 (next round): the same lineup, now resolved WITH the purchase.
    let raised = 0;
    simulateBattle(ctx(), {
      tieCapTicks: 5,
      sideAModules: asSide(),
      onTick: (f) => {
        for (const u of f.units) {
          if (u.side === 0 && u.maxHealth > frozenMax[u.id]!) raised++;
        }
      },
    });
    expect(raised).toBeGreaterThan(0); // every Vanguard's max health went up next battle
  });
});

// ---------------------------------------------------------------------------
// 7. Swap-conversion path, now reachable with a real granted Strengthen Module
// ---------------------------------------------------------------------------

describe('hero swap converts a real granted Strengthen Module back to selectable', () => {
  it('equipped → selectable on swap-out; total Strengthen count unchanged', () => {
    const res = runMatch(777, [], stub());
    const inv = boundary(res, '1-4')!.state.players[0]!.strengthen;
    const equippedHeroes = Object.keys(inv.equipped);
    expect(equippedHeroes.length).toBeGreaterThan(0);

    const outgoing = equippedHeroes[0]!;
    const movedIds = inv.equipped[outgoing]!;
    const before = totalStrengthen(inv);

    const after = convertOnSwapOut(inv, outgoing);
    expect(after.equipped).not.toHaveProperty(outgoing);
    for (const id of movedIds) expect(after.selectable).toContain(id);
    expect(totalStrengthen(after)).toBe(before); // M10's invariant
  });
});

// ---------------------------------------------------------------------------
// 8. Galacta Bot waves
// ---------------------------------------------------------------------------

describe('Galacta Bot waves', () => {
  it('scale with the round: later waves are bigger and stronger, and it is deterministic', () => {
    const w1 = galactaWave(1);
    const w21 = galactaWave(21);
    expect(w1.length).toBeGreaterThanOrEqual(1);
    expect(w21.length).toBeGreaterThan(w1.length);
    for (const u of [...w1, ...w21]) {
      expect(u.maxHealth).toBeGreaterThan(0);
      expect(u.dps).toBeGreaterThan(0);
    }
    // same archetype, later round → strictly more health & dps
    const kind = w1[0]!.kind;
    const early = w1.find((u) => u.kind === kind)!;
    const late = w21.find((u) => u.kind === kind)!;
    expect(late.maxHealth).toBeGreaterThan(early.maxHealth);
    expect(late.dps).toBeGreaterThan(early.dps);
    expect(galactaWave(11)).toEqual(galactaWave(11)); // pure / deterministic
  });

  it('a non-Practice round falls back to the nearest lower tier and never throws', () => {
    expect(() => galactaWave(3)).not.toThrow();
    // round 3 uses the tier-0 composition (same kinds, same count) with its own scaling
    expect(galactaWave(3).map((u) => u.kind)).toEqual(galactaWave(1).map((u) => u.kind));
    expect(galactaWave(3)[0]!.maxHealth).toBeGreaterThan(galactaWave(1)[0]!.maxHealth);
  });

  it('round 1 is comfortable for a reasonable lineup (player wins the PvE round on most seeds)', () => {
    let wins = 0;
    const seeds = [1, 2, 3, 4, 5, 6];
    for (const seed of seeds) {
      const res = runMatch(seed, [], createCombatResolver());
      const b = boundary(res, '1-3')!;
      const mine = b.state.matchups.find((m) => m.a === 0)!;
      if (mine.resultA === 'win') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4); // clears round 1 comfortably
  });

  it('a full match with real Galacta waves + drones replays identically', () => {
    const run = (): string => hashState(runMatch(4242, [], createCombatResolver()).finalState);
    const first = run();
    for (let i = 0; i < 3; i++) expect(run()).toBe(first);
  });
});
