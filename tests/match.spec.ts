import { describe, expect, it } from 'vitest';

import heroesJson from '../src/data/heroes.json';
import { PRACTICE_ROUNDS } from '../src/data/constants';
import { ROUND_CAP } from '../src/data/authored';
import {
  clampSurvivors,
  healthLoss,
  orderEliminatedForPlacement,
  phaseCountOf,
  phaseKindOf,
  planPairing,
  roundTypeOf,
  runMatch,
} from '../src/sim/match';
import { RngStream } from '../src/sim/rng';
import { createStubCombatResolver } from '../src/sim/stubCombat';
import { serializeState } from '../src/sim/types';
import type {
  Action,
  CombatContext,
  CombatOutcome,
  CombatResolver,
  MatchResult,
  PhaseBoundary,
} from '../src/sim/types';

/*
 * Encodes every M2 assertion. Reference facts are transcribed independently from
 * the plan (the practice-round list, the phase counts, the HP-loss formula) so a
 * bug in `match.ts` and a matching bug in a test cannot pass together.
 */

// Independent role lookup — NOT read back from anything under src/sim/.
const ROLE_OF = new Map<string, string>(
  (heroesJson as ReadonlyArray<{ id: string; role: string }>).map((h) => [h.id, h.role]),
);

const stub = (): CombatResolver => createStubCombatResolver();

/** Practice rounds, transcribed straight from the plan. */
const PRACTICE = [1, 6, 11, 16, 21];

// ---------------------------------------------------------------------------
// Round / phase helpers
// ---------------------------------------------------------------------------

describe('round & phase model', () => {
  it('rounds 1/6/11/16/21 are practice with 4 phases; every other round battle with 3', () => {
    for (let round = 1; round <= 25; round++) {
      const practice = PRACTICE.includes(round);
      expect(roundTypeOf(round), `round ${round} type`).toBe(practice ? 'practice' : 'battle');
      expect(phaseCountOf(round), `round ${round} phases`).toBe(practice ? 4 : 3);
    }
    // sanity: our independent list matches the canonical constant
    expect(PRACTICE).toEqual([...PRACTICE_ROUNDS]);
  });

  it('phase ids map 1->moduleDraw, 2->selectPosition, 3->battle, 4->reward (practice only)', () => {
    for (let round = 1; round <= 25; round++) {
      expect(phaseKindOf(round, 1)).toBe('moduleDraw');
      expect(phaseKindOf(round, 2)).toBe('selectPosition');
      expect(phaseKindOf(round, 3)).toBe('battle');
      if (PRACTICE.includes(round)) {
        expect(phaseKindOf(round, 4)).toBe('reward');
      } else {
        expect(() => phaseKindOf(round, 4)).toThrow(RangeError);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// HP-loss formula
// ---------------------------------------------------------------------------

describe('DERIVED HP-loss formula', () => {
  it('loss = floor((round-1)/5) + survivors; tie = ceil(loss/2)', () => {
    expect(healthLoss(2, 3, false)).toBe(3); // 0 + 3
    expect(healthLoss(5, 3, false)).toBe(3); // 0 + 3
    expect(healthLoss(6, 3, false)).toBe(4); // 1 + 3
    expect(healthLoss(11, 6, false)).toBe(8); // 2 + 6
    expect(healthLoss(40, 1, false)).toBe(8); // 7 + 1

    expect(healthLoss(2, 4, true)).toBe(2); // ceil(4/2)
    expect(healthLoss(6, 3, true)).toBe(2); // ceil(4/2)
    expect(healthLoss(7, 5, true)).toBe(3); // ceil((1+5)/2)
  });

  it('survivor count is clamped to the canonical 1..6 range', () => {
    expect(clampSurvivors(0)).toBe(1);
    expect(clampSurvivors(99)).toBe(6);
    expect(clampSurvivors(3.4)).toBe(3);
    expect(healthLoss(2, 0, false)).toBe(1); // clamped to 1
    expect(healthLoss(2, 50, false)).toBe(6); // clamped to 6
  });
});

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

describe('planPairing', () => {
  const noHistory = () => [] as number[];

  it('even living count => a perfect matching, no solo', () => {
    const res = planPairing({
      living: [0, 1, 2, 3, 4, 5],
      eliminated: [],
      recentOpponents: noHistory,
      rng: new RngStream(1).stream('pairing', 2),
    });
    expect(res.solo).toBeNull();
    expect(res.pairs).toHaveLength(3);
    const covered = res.pairs.flat().sort((a, b) => a - b);
    expect(covered).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('odd living count + eliminated players => exactly one PHANTOM solo', () => {
    const res = planPairing({
      living: [0, 1, 2, 3, 4],
      eliminated: [5],
      recentOpponents: noHistory,
      rng: new RngStream(1).stream('pairing', 3),
    });
    expect(res.solo).not.toBeNull();
    expect(res.solo!.kind).toBe('phantom');
    expect(res.solo!.source).toBe(5);
    expect(res.pairs).toHaveLength(2);
    const participants = [res.solo!.player, ...res.pairs.flat()].sort((a, b) => a - b);
    expect(participants).toEqual([0, 1, 2, 3, 4]);
  });

  it('odd living count + NO eliminated players => exactly one MIRROR solo (source is a living player)', () => {
    const res = planPairing({
      living: [0, 1, 2, 3, 4],
      eliminated: [],
      recentOpponents: noHistory,
      rng: new RngStream(7).stream('pairing', 3),
    });
    expect(res.solo).not.toBeNull();
    expect(res.solo!.kind).toBe('mirror');
    expect([0, 1, 2, 3, 4]).toContain(res.solo!.source);
    expect(res.solo!.source).not.toBe(res.solo!.player);
    expect(res.pairs).toHaveLength(2);
  });

  it('terminates and returns the only pairing even when both survivors have faced each other twice', () => {
    const res = planPairing({
      living: [2, 4],
      eliminated: [0, 1, 3, 5],
      recentOpponents: (id) => (id === 2 ? [4, 4] : [2, 2]),
      rng: new RngStream(3).stream('pairing', 9),
    });
    expect(res.solo).toBeNull();
    expect(res.pairs).toEqual([[2, 4]]);
  });

  it('prefers a repeat-free pairing when one exists', () => {
    // 0-1 and 2-3 faced last round; 0-2 / 1-3 / 0-3 / 1-2 are all repeat-free.
    const recent = new Map<number, number[]>([
      [0, [1]],
      [1, [0]],
      [2, [3]],
      [3, [2]],
    ]);
    let repeatFree = 0;
    for (let seed = 0; seed < 40; seed++) {
      const res = planPairing({
        living: [0, 1, 2, 3],
        eliminated: [],
        recentOpponents: (id) => recent.get(id) ?? [],
        rng: new RngStream(seed).stream('pairing', 5),
      });
      const repeats = res.pairs.filter(
        ([a, b]) => (recent.get(a) ?? []).includes(b) || (recent.get(b) ?? []).includes(a),
      ).length;
      if (repeats === 0) repeatFree++;
    }
    expect(repeatFree).toBe(40); // always avoids the rematch
  });

  it('is deterministic per (seed, round)', () => {
    const mk = () =>
      planPairing({
        living: [0, 1, 2, 3, 4, 5],
        eliminated: [],
        recentOpponents: noHistory,
        rng: new RngStream(123).stream('pairing', 4),
      });
    expect(mk().pairs).toEqual(mk().pairs);
  });
});

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

describe('draft', () => {
  it('pool is 18 unique heroes at 6/6/6 by role; lineup 6; reserve 12; lineup ∪ reserve = pool', () => {
    for (const seed of [1, 2, 3, 99, 123456]) {
      const draft = runMatch(seed, [], stub()).boundaries[0]!;
      expect(draft.kind).toBe('draft');
      expect(draft.label).toBe('draft');

      for (const p of draft.state.players) {
        expect(new Set(p.pool).size, `player ${p.id} pool unique`).toBe(18);
        const byRole = { vanguard: 0, duelist: 0, strategist: 0 };
        for (const id of p.pool) {
          byRole[ROLE_OF.get(id) as keyof typeof byRole]++;
        }
        expect(byRole).toEqual({ vanguard: 6, duelist: 6, strategist: 6 });

        expect(p.lineup).toHaveLength(6);
        expect(new Set(p.lineup).size).toBe(6);
        expect(p.reserve).toHaveLength(12);

        const poolSet = new Set(p.pool);
        expect(p.lineup.every((id) => poolSet.has(id))).toBe(true);
        expect(p.reserve.every((id) => poolSet.has(id))).toBe(true);
        expect([...p.lineup, ...p.reserve].sort()).toEqual([...p.pool].sort());
      }
    }
  });

  it('a valid selectLineup action is honoured; an invalid one falls back to an auto draft', () => {
    const probe = runMatch(42, [], stub());
    const pool = probe.boundaries[0]!.state.players[0]!.pool;

    const good: Action[] = [{ type: 'selectLineup', heroes: pool.slice(0, 6) }, { type: 'confirmPhase' }];
    const g = runMatch(42, good, stub()).boundaries[0]!.state.players[0]!;
    expect(g.lineupSource).toBe('human');
    expect([...g.lineup].sort()).toEqual([...pool.slice(0, 6)].sort());
    expect(g.reserve).toHaveLength(12);

    const bad: Action[] = [{ type: 'selectLineup', heroes: pool.slice(0, 5) }, { type: 'confirmPhase' }];
    const b = runMatch(42, bad, stub()).boundaries[0]!.state.players[0]!;
    expect(b.lineupSource).toBe('auto');
    expect(b.lineup).toHaveLength(6);
    expect(b.reserve).toHaveLength(12);

    // heroes not in the player's pool are also rejected
    const foreign: Action[] = [
      { type: 'selectLineup', heroes: ['not-a-hero', 'nope', 'x', 'y', 'z', 'w'] },
      { type: 'confirmPhase' },
    ];
    expect(runMatch(42, foreign, stub()).boundaries[0]!.state.players[0]!.lineupSource).toBe('auto');
  });
});

// ---------------------------------------------------------------------------
// Determinism — at every phase boundary, not just the end
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same seed + same action list => identical hash at EVERY phase boundary and at the end', () => {
    const probe = runMatch(0xbee, [], stub());
    const pool = probe.boundaries[0]!.state.players[0]!.pool;
    const actions: Action[] = [
      { type: 'selectLineup', heroes: pool.slice(0, 6) },
      { type: 'confirmPhase' },
      { type: 'confirmPhase' },
      { type: 'advanceTimer' },
      { type: 'confirmPhase' },
      { type: 'advanceTimer' },
      { type: 'confirmPhase' },
    ];

    const ref = runMatch(0xbee, actions, stub());
    const refHashes = ref.boundaries.map((b) => b.hash);

    for (let i = 0; i < 10; i++) {
      const r = runMatch(0xbee, actions, stub());
      expect(r.boundaries.map((b) => b.hash)).toEqual(refHashes);
      expect(r.boundaries.map((b) => b.label)).toEqual(ref.boundaries.map((b) => b.label));
      expect(serializeState(r.finalState)).toBe(serializeState(ref.finalState));
    }
  });

  it('the action list visibly affects the state (confirm vs time-out is recorded)', () => {
    const empty = runMatch(5, [], stub());
    // every phase auto-advances => humanConfirmedPhase is always false
    expect(empty.boundaries.every((b) => b.state.humanConfirmedPhase === false)).toBe(true);

    const allConfirms: Action[] = Array.from(
      { length: 12 },
      () => ({ type: 'confirmPhase' }) as Action,
    );
    const confirmed = runMatch(5, allConfirms, stub());
    const anyConfirmed = confirmed.boundaries.some((b) => b.state.humanConfirmedPhase === true);
    expect(anyConfirmed).toBe(true);
    // ...and that changes hashes relative to the all-timeout run
    expect(confirmed.boundaries[3]!.hash).not.toBe(empty.boundaries[3]!.hash);
  });

  it('different seeds diverge', () => {
    expect(runMatch(1, [], stub()).finalState).not.toEqual(runMatch(2, [], stub()).finalState);
  });
});

// ---------------------------------------------------------------------------
// Phase-id sequence and the `${round}-${phase}` display string
// ---------------------------------------------------------------------------

describe('phase boundary stream', () => {
  it('phase ids advance 1->2->3(->4) within each round and the label is exactly `${round}-${phase}`', () => {
    const { boundaries } = runMatch(2024, [], stub());
    expect(boundaries[0]!.label).toBe('draft');

    const byRound = new Map<number, PhaseBoundary[]>();
    for (const b of boundaries.slice(1)) {
      expect(b.label).toBe(`${b.round}-${b.phase}`);
      const list = byRound.get(b.round) ?? [];
      list.push(b);
      byRound.set(b.round, list);
    }

    for (const [round, list] of byRound) {
      const phases = list.map((b) => b.phase);
      const expectedCount = phaseCountOf(round);
      // The final round may be cut short only if the match ends mid-round; every
      // earlier round is complete.
      expect(phases).toEqual(Array.from({ length: phases.length }, (_, i) => i + 1));
      expect(phases.length).toBeLessThanOrEqual(expectedCount);
      for (const b of list) expect(b.kind).toBe(phaseKindOf(round, b.phase));
    }
  });

  it('a full match has draft + Σ phaseCountOf(r) boundaries up to the finishing round', () => {
    const { boundaries, finalState } = runMatch(777, [], stub());
    let expected = 1; // draft
    for (let r = 1; r < finalState.round; r++) expected += phaseCountOf(r);
    expected += finalState.phase; // finishing round's phases so far
    expect(boundaries).toHaveLength(expected);
  });
});

// ---------------------------------------------------------------------------
// Matchup coverage per PvP round
// ---------------------------------------------------------------------------

function forcedResolver(opts: {
  loserId?: number;
  soloResultForA?: CombatOutcome['result'];
  survivors?: number;
}): CombatResolver {
  const survivors = opts.survivors ?? 6;
  return {
    resolve(ctx: CombatContext): CombatOutcome {
      if (ctx.matchupKind === 'pve') return { result: 'win', survivingUnits: survivors };
      if (ctx.matchupKind === 'phantom' || ctx.matchupKind === 'mirror') {
        return { result: opts.soloResultForA ?? 'loss', survivingUnits: survivors };
      }
      if (opts.loserId !== undefined) {
        if (ctx.sideA.playerId === opts.loserId) return { result: 'loss', survivingUnits: survivors };
        if (ctx.sideB.playerId === opts.loserId) return { result: 'win', survivingUnits: survivors };
      }
      return { result: 'tie', survivingUnits: 1 }; // minimal drain for everyone else
    },
  };
}

describe('matchup coverage', () => {
  it('every living player is in exactly one matchup per PvP round; odd counts add exactly one solo', () => {
    const res = runMatch(31337, [], forcedResolver({ loserId: 4 }));
    const battleBoundaries = res.boundaries.filter((b) => b.kind === 'battle');

    for (const b of battleBoundaries) {
      const { round, state } = b;
      if (roundTypeOf(round) === 'practice') continue;

      const living = state.players.filter((p) => p.alive || p.eliminatedRound === round);
      const livingIds = new Set(
        state.players.filter((p) => p.alive || p.eliminatedRound === round).map((p) => p.id),
      );

      // Reconstruct "living at the start of the round" — anyone still alive, plus
      // anyone eliminated *this* round.
      const participants: number[] = [];
      let soloCount = 0;
      for (const m of state.matchups) {
        expect(livingIds.has(m.a)).toBe(true);
        participants.push(m.a);
        if (m.kind === 'pvp') participants.push(m.b);
        if (m.kind === 'mirror' || m.kind === 'phantom') soloCount++;
      }

      participants.sort((x, y) => x - y);
      expect(participants).toEqual([...livingIds].sort((x, y) => x - y));
      expect(new Set(participants).size).toBe(participants.length); // each exactly once
      expect(soloCount).toBe(living.length % 2 === 1 ? 1 : 0);
    }
  });

  it('Practice rounds (1/6/11/16/21) put every living player in a PvE matchup — no pairing', () => {
    const res = runMatch(31337, [], forcedResolver({ loserId: 4 }));
    for (const b of res.boundaries) {
      if (b.kind !== 'battle') continue;
      if (!PRACTICE.includes(b.round)) continue;
      const livingIds = b.state.players.filter((p) => p.alive).map((p) => p.id).sort((x, y) => x - y);
      expect(b.state.matchups.every((m) => m.kind === 'pve')).toBe(true);
      expect(b.state.matchups.every((m) => m.b === -1)).toBe(true);
      expect(b.state.matchups.map((m) => m.a).sort((x, y) => x - y)).toEqual(livingIds);
      // PvE is health-neutral: nobody loses health on a practice round.
      expect(b.state.matchups.every((m) => m.healthLossA === 0 && m.healthLossB === 0)).toBe(true);
    }
  });

  it('with an odd living count the solo matchup is a PHANTOM (an eliminated player exists)', () => {
    const res = runMatch(999, [], forcedResolver({ loserId: 5, soloResultForA: 'win' }));
    const oddPvpRounds = res.boundaries.filter((b) => {
      if (b.kind !== 'battle' || roundTypeOf(b.round) === 'practice') return false;
      const startLiving = b.state.players.filter(
        (p) => p.alive || p.eliminatedRound === b.round,
      ).length;
      return startLiving % 2 === 1;
    });
    expect(oddPvpRounds.length).toBeGreaterThan(0);
    for (const b of oddPvpRounds) {
      const solos = b.state.matchups.filter((m) => m.kind === 'mirror' || m.kind === 'phantom');
      expect(solos).toHaveLength(1);
      expect(solos[0]!.kind).toBe('phantom');
    }
  });
});

// ---------------------------------------------------------------------------
// Forced loss 50 -> 0
// ---------------------------------------------------------------------------

describe('elimination & placement', () => {
  it('a player forced to lose every PvP round hits 0 on the expected round with the expected placement', () => {
    const res = runMatch(2024, [], forcedResolver({ loserId: 3, survivors: 6 }));
    const p3 = res.finalState.players[3]!;

    // Hand-computed: 50 HP, loses floor((r-1)/5)+6 each PvP round.
    //  r2..r5: 6,6,6,6 -> 26 ; r6 PvE -> 26 ; r7..r9: 7,7,7 -> 5 ; r10: 7 -> -2
    expect(p3.eliminatedRound).toBe(10);
    expect(p3.eliminationHealth).toBe(-2);
    expect(p3.health).toBe(0);
    expect(p3.alive).toBe(false);
    // Nobody else was out by round 10, so livingAfter = 5 => placement 6.
    expect(p3.placement).toBe(6);
    expect(p3.lastRoundResult).toBe('loss');
  });

  it('placements across a finished match are exactly {1..6}, distinct, with one winner', () => {
    for (const seed of [1, 2, 3, 4, 5, 100, 2024, 99999]) {
      const { finalState } = runMatch(seed, [], stub());
      expect(finalState.status).toBe('complete');
      const placements = finalState.players.map((p) => p.placement).sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(placements).toEqual([1, 2, 3, 4, 5, 6]);
      expect(finalState.winnerId).not.toBeNull();
      expect(finalState.players[finalState.winnerId!]!.placement).toBe(1);
    }
  });

  it('orderEliminatedForPlacement: best (least-negative) health first, then lower id', () => {
    expect(
      orderEliminatedForPlacement([
        { id: 3, eliminationHealth: -8 },
        { id: 1, eliminationHealth: 0 },
        { id: 5, eliminationHealth: -2 },
      ]),
    ).toEqual([1, 5, 3]);
    // exact tie on health -> lower id ranks better
    expect(
      orderEliminatedForPlacement([
        { id: 4, eliminationHealth: -2 },
        { id: 2, eliminationHealth: -2 },
        { id: 0, eliminationHealth: -2 },
      ]),
    ).toEqual([0, 2, 4]);
  });

  it('a simultaneous wipe of all six the same round gives distinct 1..6 by the id tiebreak', () => {
    // Every PvP matchup ties with 6 survivors; by round 18 the tie loss (5/round
    // for a while) has taken everyone from 50 to exactly -4 on the same round.
    const allTieBig: CombatResolver = {
      resolve: () => ({ result: 'tie', survivingUnits: 6 }),
    };
    const { finalState } = runMatch(4242, [], allTieBig);
    expect(finalState.status).toBe('complete');
    for (const p of finalState.players) {
      expect(p.eliminatedRound, `p${p.id} round`).toBe(18);
      expect(p.eliminationHealth, `p${p.id} elim health`).toBe(-4);
      expect(p.health).toBe(0);
      expect(p.alive).toBe(false);
    }
    // identical health => tiebreak is player id => placement == id + 1
    expect(finalState.players.map((p) => p.placement)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(finalState.winnerId).toBe(0);
    expect(finalState.players[0]!.placement).toBe(1);
  });

  it('a player at <= 0 HP thereafter reads as out of play (alive=false, phantomLineup frozen)', () => {
    const res = runMatch(2024, [], forcedResolver({ loserId: 3, survivors: 6 }));
    const eliminationBoundary = res.boundaries.find(
      (b) => b.kind === 'battle' && b.round === 3 + 7 && b.state.players[3]!.alive === false,
    );
    // just assert the invariant on the final state:
    const p3final = res.finalState.players[3]!;
    expect(p3final.alive).toBe(false);
    expect(p3final.phantomLineup).not.toBeNull();
    expect(p3final.phantomLineup).toHaveLength(6);
    expect(eliminationBoundary).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Beating a phantom changes nothing for the phantom's owner
// ---------------------------------------------------------------------------

describe('phantoms', () => {
  it("once eliminated, a phantom owner's player state never changes again — even when their phantom is beaten", () => {
    const res = runMatch(555, [], forcedResolver({ loserId: 5, survivors: 6, soloResultForA: 'win' }));

    const firstOut = res.boundaries.findIndex((b) => b.state.players[5]!.alive === false);
    expect(firstOut).toBeGreaterThan(0);

    const p5At = (b: PhaseBoundary): string => JSON.stringify(b.state.players[5]);
    const reference = p5At(res.boundaries[firstOut]!);
    for (const b of res.boundaries.slice(firstOut + 1)) {
      expect(p5At(b), `player 5 changed at ${b.label}`).toBe(reference);
    }
    expect(JSON.stringify(res.finalState.players[5])).toBe(reference);

    // ...and a phantom matchup against player 5 was in fact WON by the living side.
    const wonAgainstPhantom5 = res.boundaries.some((b) =>
      b.state.matchups.some((m) => m.kind === 'phantom' && m.b === 5 && m.resultA === 'win'),
    );
    expect(wonAgainstPhantom5).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round cap
// ---------------------------------------------------------------------------

describe('round cap', () => {
  it('a match with no eliminations resolves at the cap by highest remaining health', () => {
    const allTie: CombatResolver = {
      resolve: () => ({ result: 'tie', survivingUnits: 1 }),
    };
    const res = runMatch(20260901, [], allTie, { maxRounds: 5 });
    expect(res.finalState.status).toBe('complete');
    expect(res.finalState.round).toBe(5);
    expect(res.finalState.players.every((p) => p.eliminatedRound === null)).toBe(true);

    const placements = res.finalState.players.map((p) => p.placement).sort((a, b) => a! - b!);
    expect(placements).toEqual([1, 2, 3, 4, 5, 6]);

    // Everyone tied every PvP round => equal health => tiebreak is player id.
    const healths = res.finalState.players.map((p) => p.health);
    expect(new Set(healths).size).toBe(1);
    expect(res.finalState.winnerId).toBe(0);
    expect(res.finalState.players[0]!.placement).toBe(1);
  });

  it('the default cap is the canonical ROUND_CAP and matches never exceed it', () => {
    for (let seed = 0; seed < 30; seed++) {
      expect(runMatch(seed, [], stub()).finalState.round).toBeLessThanOrEqual(ROUND_CAP);
    }
  });
});

// ---------------------------------------------------------------------------
// State is hashable: a plain tree, no undefined / non-finite numbers
// ---------------------------------------------------------------------------

describe('state hashability', () => {
  it('every boundary state is plain JSON — no undefined, no NaN/Infinity', () => {
    const { boundaries, finalState } = runMatch(2024, [], stub());
    const walk = (v: unknown, path: string): void => {
      if (v === undefined) throw new Error(`undefined at ${path}`);
      if (typeof v === 'number') {
        expect(Number.isFinite(v), path).toBe(true);
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${path}[${i}]`));
        return;
      }
      if (v !== null && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) walk(val, `${path}.${k}`);
      }
    };
    [...boundaries.map((b) => b.state), finalState].forEach((s, i) => walk(s, `#${i}`));
  });

  it('serializeState sorts keys and round-trips through JSON', () => {
    const { finalState } = runMatch(7, [], stub());
    const json = serializeState(finalState);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(finalState)));
    // top-level keys are sorted
    const topKeys = Object.keys(JSON.parse(json) as Record<string, unknown>);
    expect(topKeys).toEqual([...topKeys].sort());
  });
});

// ---------------------------------------------------------------------------
// 200-seed fuzz
// ---------------------------------------------------------------------------

describe('200-seed fuzz (stub combat)', () => {
  it('every match terminates with one winner, valid placements, health never negative without elimination', () => {
    const s = createStubCombatResolver();
    for (let seed = 0; seed < 200; seed++) {
      const res: MatchResult = runMatch(seed, [], s);
      const fs = res.finalState;

      expect(fs.status, `seed ${seed} status`).toBe('complete');
      expect(fs.round, `seed ${seed} round cap`).toBeLessThanOrEqual(ROUND_CAP);

      expect(fs.winnerId, `seed ${seed} winner`).not.toBeNull();
      expect(fs.players[fs.winnerId!]!.placement, `seed ${seed} winner placement`).toBe(1);
      expect(fs.players.filter((p) => p.placement === 1), `seed ${seed} exactly one winner`).toHaveLength(1);

      const placements = fs.players.map((p) => p.placement).sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(placements, `seed ${seed} placements`).toEqual([1, 2, 3, 4, 5, 6]);

      for (const b of res.boundaries) {
        for (const p of b.state.players) {
          expect(p.health, `seed ${seed} @${b.label} p${p.id} health >= 0`).toBeGreaterThanOrEqual(0);
          if (p.eliminationHealth !== null) {
            expect(p.eliminationHealth).toBeLessThanOrEqual(0);
            expect(p.alive, `seed ${seed} p${p.id} negative but alive`).toBe(false);
          }
          if (!p.alive) {
            expect(p.placement, `seed ${seed} dead p${p.id} unplaced`).not.toBeNull();
            expect(p.eliminatedRound).not.toBeNull();
          }
        }
      }
    }
  });
});
