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

// ---- COMMITTED (regenerated 2026-09-02 — M7: AI opponents) ------------------
//      M7 wires the module economy + a 6×4 board-deployment model into the
//      match loop and replaces the placeholder bot / drone policies with the
//      five real archetypes and the shared drone policy. These `runMatch(seed,
//      [], resolver)` replays give the human seat NO actions, so it now sits
//      passive (no purchases, engine formation) while all five bots draft,
//      spend, deploy and fly a tracking drone — the human loses in every seed
//      here, which is the point of the change, not a regression. Matches also
//      end a few rounds sooner: bots with modules kill faster.
//
//      Verified in two steps before this table was blessed: (1) the state-shape
//      + shop-open change alone left every seed's winner / round / placements /
//      boundary count identical to M6 (only `finalStateHash` moved, from the new
//      PlayerState fields); (2) the archetypes actually playing produced the
//      values below. No determinism guarantee was weakened —
//      `tests/determinism.spec.ts` is untouched and green.
const COMMITTED: readonly ReplayOutcome[] = [
  {
    seed: 11,
    winnerId: 1,
    finalRound: 24,
    placements: [6, 1, 3, 5, 4, 2],
    boundaryCount: 78,
    finalStateHash: '06cbb81b66b5f399d66fc8e42fdc16a2',
  },
  {
    seed: 2024,
    winnerId: 1,
    finalRound: 28,
    placements: [5, 1, 3, 6, 4, 2],
    boundaryCount: 90,
    finalStateHash: 'e08b859142dee2f1e72519bb95e5318c',
  },
  {
    seed: 424242,
    winnerId: 2,
    finalRound: 29,
    placements: [6, 2, 1, 4, 5, 3],
    boundaryCount: 93,
    finalStateHash: '477a76e9c496ff9471e9d0f52c184cb7',
  },
  {
    seed: 918273,
    winnerId: 1,
    finalRound: 27,
    placements: [6, 1, 5, 2, 3, 4],
    boundaryCount: 87,
    finalStateHash: '42a0634361d36ceb9675e0f7e5d374e6',
  },
  {
    seed: 12648430,
    winnerId: 1,
    finalRound: 26,
    placements: [6, 1, 3, 4, 5, 2],
    boundaryCount: 84,
    finalStateHash: 'b0693dc7f2fa475014eb80525d65782f',
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
