import { describe, expect, it } from 'vitest';

import { runMatch } from '../src/sim/match';
import { createCombatResolver } from '../src/sim/combat';
import { hashState } from '../src/sim/types';

/*
 * GOLDEN REPLAYS — five fixed seeds, each with a COMMITTED full-match outcome
 * produced by `runMatch` + the real M5 combat resolver.
 *
 * An unexplained diff here is a FAILURE, not a snapshot to bless. The sim is
 * deterministic; if these values move without a deliberate combat change, a
 * regression has been introduced. M11 will regenerate these on purpose when
 * balancing.
 *
 * REGENERATION (only after a deliberate combat / data change):
 *   PowerShell:  $env:REGEN_REPLAYS=1; npx vitest run tests/replay.spec.ts
 *   bash:        REGEN_REPLAYS=1 npx vitest run tests/replay.spec.ts
 * Review the printed table against the diff, then paste it into `COMMITTED`
 * below and drop the env var. Never widen a tolerance to absorb a diff.
 */

const SEEDS = [11, 2024, 424242, 918273, 12648430] as const;

interface ReplayOutcome {
  readonly seed: number;
  readonly winnerId: number | null;
  readonly finalRound: number;
  readonly placements: readonly (number | null)[];
  readonly boundaryCount: number;
  readonly finalStateHash: string;
}

function replay(seed: number): ReplayOutcome {
  const res = runMatch(seed, [], createCombatResolver());
  return {
    seed,
    winnerId: res.finalState.winnerId,
    finalRound: res.finalState.round,
    placements: res.finalState.players.map((p) => p.placement),
    boundaryCount: res.boundaries.length,
    finalStateHash: hashState(res.finalState),
  };
}

// ---- COMMITTED (regenerated 2026-09-02 — M10: Strengthen Modules) -----------
//      M10 gives all 76 sourced Strengthen Modules a real combat implementation
//      (passive stat folds + `onUlt` self-buff windows) and threads each
//      player's equipped Strengthen loadout into the resolver. Every player
//      picks up Strengthen Modules from the Practice-round rewards, so from
//      round 2 on both sides of every PvP battle now carry live Strengthen
//      effects — outcomes, placements and state hashes move accordingly, and
//      a few matches end a round or two sooner (buffed lineups kill faster).
//      This is the intended consequence of wiring M10, not a regression.
//
//      No determinism guarantee was weakened: `tests/determinism.spec.ts`
//      (stub resolver, self-referential) and `combat.spec.ts` / `match.spec.ts`
//      (compute their own ref in-run) are untouched and green. A battle with no
//      Strengthen modules keeps its pre-M10 digest byte-for-byte (the new
//      `strenUltTicks` hash fold only contributes while an `onUlt` window is
//      live). Regenerated via `REGEN_REPLAYS=1` and re-run twice for stability.
const COMMITTED: readonly ReplayOutcome[] = [
  {
    seed: 11,
    winnerId: 1,
    finalRound: 24,
    placements: [6, 1, 2, 4, 5, 3],
    boundaryCount: 78,
    finalStateHash: 'e1e013e259ca66150d3ea5d6d0ba4439',
  },
  {
    seed: 2024,
    winnerId: 2,
    finalRound: 26,
    placements: [6, 2, 1, 5, 3, 4],
    boundaryCount: 84,
    finalStateHash: '0101e8dfb338488f80bcb17f281fa89e',
  },
  {
    seed: 424242,
    winnerId: 2,
    finalRound: 29,
    placements: [6, 2, 1, 4, 5, 3],
    boundaryCount: 93,
    finalStateHash: 'a9cb6f3e4b29c9cd913a11148f9e7fc9',
  },
  {
    seed: 918273,
    winnerId: 3,
    finalRound: 28,
    placements: [6, 2, 3, 1, 4, 5],
    boundaryCount: 90,
    finalStateHash: '0232814b17996457379d40d4ea597eb9',
  },
  {
    seed: 12648430,
    winnerId: 1,
    finalRound: 25,
    placements: [6, 1, 3, 5, 4, 2],
    boundaryCount: 81,
    finalStateHash: 'a740dbf2df23a8d5c54348ad26217e00',
  },
];
// ---- /COMMITTED --------------------------------------------------------------

const REGEN = process.env['REGEN_REPLAYS'] === '1';

describe('golden replays (5 committed seeds)', () => {
  if (REGEN) {
    it('REGENERATE — prints the fresh committed table (not an assertion)', () => {
      const fresh = SEEDS.map(replay);
      console.log('\n---- paste into COMMITTED ----\n' + JSON.stringify(fresh, null, 2) + '\n');
      expect(fresh).toHaveLength(5);
    });
    return;
  }

  it.each(SEEDS)('seed %d matches its committed full-match outcome', (seed) => {
    const expected = COMMITTED.find((c) => c.seed === seed)!;
    expect(replay(seed)).toEqual(expected);
  });

  it('every committed match resolved to a valid 1..6 standing', () => {
    for (const c of COMMITTED) {
      const p = [...c.placements].sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(p).toEqual([1, 2, 3, 4, 5, 6]);
      expect(c.winnerId).not.toBeNull();
      expect(c.placements[c.winnerId!]).toBe(1);
    }
  });

  it('replays are stable across repeated runs (determinism guard)', () => {
    for (const seed of SEEDS) {
      const a = replay(seed);
      const b = replay(seed);
      expect(a).toEqual(b);
    }
  });
});
