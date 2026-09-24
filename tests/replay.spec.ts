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

// ---- COMMITTED (regenerated 2026-09-03 — M11: balance + HP-loss re-fit) -----
//      M11 re-tuned every per-hero combat stat in heroes.json against the
//      per-hero win-rate gate (heroes of equal baseHealth converge to
//      near-identical combat numbers under that constraint) and re-fitted the
//      DERIVED HP-loss coefficients (divisor 5 -> 9, survivor range [1,6] ->
//      [1,2]; see authored.ts HP_LOSS_* + docs/FIDELITY.md). Combat outcomes,
//      placements, state hashes and match length all move accordingly — the
//      intended consequence of the re-tune, not a regression.
//
//      Match length note: a gate-3-compliant per-round HP loss (mean ≤ 3.5)
//      cannot also eliminate a 50-HP field by ~round 18, so AI matches now run
//      ~36–40 rounds and some resolve at the round-40 cap by highest remaining
//      health (seeds 2024 and 918273 below). Documented in FIDELITY / QA.
//
//      No determinism guarantee was weakened: `tests/determinism.spec.ts`
//      (stub resolver, self-referential) and `combat.spec.ts` / `match.spec.ts`
//      (compute their own ref in-run) stay green. Regenerated via
//      `REGEN_REPLAYS=1` and re-run twice for stability.
const COMMITTED: readonly ReplayOutcome[] = [
  {
    seed: 11,
    winnerId: 1,
    finalRound: 38,
    placements: [6, 1, 3, 2, 4, 5],
    boundaryCount: 120,
    finalStateHash: '8449725d0dfbbd03fb01c85f30829120',
  },
  {
    seed: 2024,
    winnerId: 1,
    finalRound: 40,
    placements: [6, 1, 3, 5, 4, 2],
    boundaryCount: 126,
    finalStateHash: 'b6e575678f0a42ece853e30a1cef5e63',
  },
  {
    seed: 424242,
    winnerId: 2,
    finalRound: 36,
    placements: [6, 3, 1, 2, 4, 5],
    boundaryCount: 114,
    finalStateHash: '7bc1cd5e5c5796b060ce872c498eb941',
  },
  {
    seed: 918273,
    winnerId: 5,
    finalRound: 40,
    placements: [6, 3, 2, 4, 5, 1],
    boundaryCount: 126,
    finalStateHash: 'd436e32e7e0bc0d57ffaa8a9d5a2f437',
  },
  {
    seed: 12648430,
    winnerId: 5,
    finalRound: 39,
    placements: [6, 2, 3, 5, 4, 1],
    boundaryCount: 123,
    finalStateHash: '7a94c6a1bb73495c7cdff3db30e5ace7',
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
