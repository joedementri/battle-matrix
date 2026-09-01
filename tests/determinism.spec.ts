import { describe, expect, it } from 'vitest';

import { runMatch } from '../src/sim/match';
import { createStubCombatResolver } from '../src/sim/stubCombat';
import { hashState } from '../src/sim/types';
import type { Action } from '../src/sim/types';

/*
 * `npm run test:determinism` — 100x same-seed replay hashing.
 *
 * A match is a pure function of (seed, action list, combat resolver). This spec
 * replays one seeded match 100 times and asserts a single hash at every phase
 * boundary and at the end, then checks that neighbouring seeds actually diverge
 * (so the hash is not accidentally constant).
 */

const REPLAYS = 100;
const SEED = 0xc0ffee;

function actionsFor(seed: number): Action[] {
  // A valid lineup needs ids from this seed's pool — probe once to get them.
  const probe = runMatch(seed, [], createStubCombatResolver());
  const pool = probe.boundaries[0]!.state.players[0]!.pool;
  return [
    { type: 'selectLineup', heroes: pool.slice(3, 9) },
    { type: 'confirmPhase' }, // draft
    { type: 'confirmPhase' }, // 1-1
    { type: 'advanceTimer' }, // 1-2
    { type: 'confirmPhase' }, // 1-3
    { type: 'advanceTimer' }, // 1-4 (reward)
    { type: 'confirmPhase' }, // 2-1
    { type: 'confirmPhase' }, // 2-2
    { type: 'advanceTimer' }, // 2-3
    // then the list runs out and every later phase auto-advances
  ];
}

describe('determinism (100x replay)', () => {
  it(`replays seed ${SEED} ${REPLAYS} times to a single boundary-hash sequence`, () => {
    const actions = actionsFor(SEED);
    const ref = runMatch(SEED, actions, createStubCombatResolver());
    const refBoundaryHashes = ref.boundaries.map((b) => b.hash);
    const refLabels = ref.boundaries.map((b) => b.label);
    const refFinal = hashState(ref.finalState);

    expect(refBoundaryHashes.length).toBeGreaterThan(10);

    for (let i = 0; i < REPLAYS; i++) {
      const r = runMatch(SEED, actions, createStubCombatResolver());
      expect(r.boundaries.map((b) => b.label), `replay ${i} labels`).toEqual(refLabels);
      expect(r.boundaries.map((b) => b.hash), `replay ${i} boundary hashes`).toEqual(
        refBoundaryHashes,
      );
      expect(hashState(r.finalState), `replay ${i} final hash`).toBe(refFinal);
    }
  });

  it('replays with an empty action list are just as stable', () => {
    const ref = runMatch(SEED, [], createStubCombatResolver());
    const refHashes = ref.boundaries.map((b) => b.hash);
    for (let i = 0; i < REPLAYS; i++) {
      const r = runMatch(SEED, [], createStubCombatResolver());
      expect(r.boundaries.map((b) => b.hash)).toEqual(refHashes);
    }
  });

  it('neighbouring seeds produce different final hashes (the hash is not constant)', () => {
    const hashes = new Set<string>();
    for (let seed = 1000; seed < 1050; seed++) {
      hashes.add(hashState(runMatch(seed, [], createStubCombatResolver()).finalState));
    }
    expect(hashes.size).toBe(50);
  });
});
