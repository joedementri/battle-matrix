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

// ---- COMMITTED (regenerated 2026-09-01 — M5 initial commit) ------------------
const COMMITTED: readonly ReplayOutcome[] = [
  {
    seed: 11,
    winnerId: 5,
    finalRound: 25,
    placements: [4, 2, 3, 6, 5, 1],
    boundaryCount: 81,
    finalStateHash: '32e988f51ee6c65a4c61dbaa262096b9',
  },
  {
    seed: 2024,
    winnerId: 2,
    finalRound: 27,
    placements: [3, 5, 1, 6, 2, 4],
    boundaryCount: 87,
    finalStateHash: '91f2b58c1da6a4105d5b711278821d83',
  },
  {
    seed: 424242,
    winnerId: 3,
    finalRound: 34,
    placements: [3, 5, 6, 1, 2, 4],
    boundaryCount: 108,
    finalStateHash: '2bf279e4ff567c0e5f885b6b358af553',
  },
  {
    seed: 918273,
    winnerId: 0,
    finalRound: 34,
    placements: [1, 3, 5, 2, 4, 6],
    boundaryCount: 108,
    finalStateHash: '5bb932cc667aed21db899db18b2b6fbf',
  },
  {
    seed: 12648430,
    winnerId: 3,
    finalRound: 28,
    placements: [4, 5, 2, 1, 3, 6],
    boundaryCount: 90,
    finalStateHash: 'e8f557c418b8e39f9000d0ed60fbca5d',
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
