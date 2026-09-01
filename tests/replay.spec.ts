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

// ---- COMMITTED (regenerated 2026-09-01 — M6: Galacta Bots + Ultron Drones -----
//      wired into the resolver. Real Galacta waves replace the M5 PvE self-mirror
//      placeholder; every battle now hosts N policy-driven drones whose two
//      one-time abilities swing PvP outcomes. Deliberate regeneration per the M6
//      plan's Integration note — no determinism test was weakened. -------------
const COMMITTED: readonly ReplayOutcome[] = [
  {
    seed: 11,
    winnerId: 5,
    finalRound: 30,
    placements: [3, 2, 4, 5, 6, 1],
    boundaryCount: 96,
    finalStateHash: 'f3e24a916f25edbdcd1fdf9a9ec3063f',
  },
  {
    seed: 2024,
    winnerId: 2,
    finalRound: 26,
    placements: [3, 4, 1, 6, 2, 5],
    boundaryCount: 84,
    finalStateHash: '7027687527a7b3fdaee35376d6ed1448',
  },
  {
    seed: 424242,
    winnerId: 0,
    finalRound: 29,
    placements: [1, 5, 6, 4, 3, 2],
    boundaryCount: 93,
    finalStateHash: 'a588309edd11c4e931d6187ee31650e5',
  },
  {
    seed: 918273,
    winnerId: 0,
    finalRound: 34,
    placements: [1, 3, 5, 2, 4, 6],
    boundaryCount: 108,
    finalStateHash: 'fa451af2100dd0f7808a4a3d2b62900d',
  },
  {
    seed: 12648430,
    winnerId: 4,
    finalRound: 29,
    placements: [2, 5, 4, 3, 1, 6],
    boundaryCount: 93,
    finalStateHash: '45af21400b52741901852ccf51f003d6',
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
