import { describe, expect, it } from 'vitest';

import { isValidDeployment } from '../src/sim/board';
import { runMatch } from '../src/sim/match';
import { RngStream } from '../src/sim/rng';
import { changeHeroOfferIds, humanRewardOffers } from '../src/sim/selectors';
import { createStubCombatResolver } from '../src/sim/stubCombat';
import { hashState } from '../src/sim/types';
import type { Action } from '../src/sim/types';

import { buildAction } from '../src/ui/intents';
import { defaultPlacement, placeHeroAt, placementIsLegal } from '../src/ui/viewmodels/deploy';

/*
 * M8 `tests/ui-actions.spec.ts`:
 *   - every UI action builder produces a legal member of the sim `Action` union,
 *     and `runMatch` consumes a full scripted session of them without a throw
 *     and with a valid finished standing;
 *   - drag-and-drop can never double-occupy a cell, exceed six heroes, or place
 *     on the enemy half (off the 6×4 own-half grid).
 */

const KNOWN_ACTION_TYPES = new Set([
  'selectLineup',
  'confirmPhase',
  'advanceTimer',
  'buyModule',
  'sellModule',
  'refreshShop',
  'lockShop',
  'deploy',
  'swapHero',
  'selectReward',
  'refreshReward',
]);

describe('every UI action builder produces a legal sim Action', () => {
  it('each builder returns an object with a recognised discriminant', () => {
    const samples: Action[] = [
      buildAction.selectLineup(['a', 'b']),
      buildAction.confirmPhase(),
      buildAction.advanceTimer(),
      buildAction.buyModule(2),
      buildAction.sellModule('x'),
      buildAction.refreshShop(),
      buildAction.lockShop(),
      buildAction.deploy([{ col: 1, row: 2 }]),
      buildAction.swapHero('in', 'out'),
      buildAction.selectReward('loki-s1'),
      buildAction.refreshReward(),
    ];
    for (const action of samples) {
      expect(KNOWN_ACTION_TYPES.has(action.type), `unknown action type ${action.type}`).toBe(true);
    }
  });

  it('deploy() deep-copies its cells (no shared references into UI state)', () => {
    const cells = [{ col: 0, row: 0 }];
    const action = buildAction.deploy(cells);
    expect(action.type).toBe('deploy');
    if (action.type === 'deploy') expect(action.cells[0]).not.toBe(cells[0]);
  });

  it('a full scripted UI session drives runMatch to a valid finished standing', () => {
    const seed = 20250606;
    // read the real seed-dependent bits the UI would read
    const probe = runMatch(seed, [], createStubCombatResolver());
    const draft = probe.boundaries[0]!.state.players.find((p) => p.isHuman)!;
    const lineup = draft.pool.slice(0, 6);
    const incoming = changeHeroOfferIds(seed, 1, 1, 'duelist', lineup)[0]!;
    const outgoing = lineup.find(
      (id) => (draft.pool.indexOf(id) >= 0 ? true : false) && id !== incoming,
    )!;
    const reward = humanRewardOffers(seed, 1, draft.id, lineup, draft.strengthen, false).offers;

    const actions: Action[] = [
      buildAction.selectLineup(lineup),
      buildAction.confirmPhase(), // draft
      // round 1 — Module Draw
      buildAction.buyModule(0),
      buildAction.refreshShop(),
      buildAction.lockShop(),
      buildAction.swapHero(incoming, outgoing),
      buildAction.confirmPhase(),
      // round 1 — Select Position
      buildAction.deploy(defaultPlacement(6)),
      buildAction.confirmPhase(),
      // round 1 — Battle
      buildAction.advanceTimer(),
      // round 1 — Reward
      buildAction.refreshReward(),
      ...(reward.length > 0 ? [buildAction.selectReward(reward[0]!)] : []),
      buildAction.confirmPhase(),
    ];

    const res = runMatch(seed, actions, createStubCombatResolver());
    // it ran, and every boundary is plain hashable JSON
    expect(res.boundaries.length).toBeGreaterThan(3);
    for (const b of res.boundaries) expect(typeof hashState(b.state)).toBe('string');
    // match still terminates with a valid standing
    const placements = res.finalState.players.map((p) => p.placement).filter((p) => p !== null);
    expect(new Set(placements).size).toBe(placements.length);
    expect(res.finalState.status).toBe('complete');
  });

  it('swapHero performed by runMatch actually swaps the lineup when legal', () => {
    const seed = 424242;
    const probe = runMatch(seed, [], createStubCombatResolver());
    const draft = probe.boundaries[0]!.state.players.find((p) => p.isHuman)!;
    const lineup = draft.pool.slice(0, 6);
    const incoming = changeHeroOfferIds(seed, 1, 1, 'vanguard', lineup)[0]!;
    const outgoing = lineup[0]!;

    const res = runMatch(
      seed,
      [
        buildAction.selectLineup(lineup),
        buildAction.confirmPhase(),
        buildAction.swapHero(incoming, outgoing),
        buildAction.confirmPhase(),
      ],
      createStubCombatResolver(),
    );
    const after = res.boundaries.find((b) => b.label === '1-1')!.state.players.find((p) => p.isHuman)!;
    expect(after.lineup).toContain(incoming);
    expect(after.lineup).not.toContain(outgoing);
    expect(after.lineup.length).toBe(6);
    expect(after.reserve).toContain(outgoing);
  });
});

// ---------------------------------------------------------------------------
// Drag-and-drop legality
// ---------------------------------------------------------------------------

describe('drag-and-drop cannot double-occupy, exceed 6, or cross into the enemy half', () => {
  it('placeHeroAt keeps every placement legal over 5000 random drops (incl. off-grid attempts)', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = new RngStream(seed).stream('dnd');
      let placement = defaultPlacement(6);
      expect(placementIsLegal(placement, 6)).toBe(true);

      for (let step = 0; step < 125; step += 1) {
        const slot = rng.int(0, 5);
        // deliberately try the enemy half / off-grid roughly half the time
        const col = rng.int(-3, 8);
        const row = rng.int(-3, 6);
        const next = placeHeroAt(placement, slot, { col, row });

        expect(next.length, 'always exactly 6 heroes').toBe(6);
        const keys = next.map((c) => `${c.col},${c.row}`);
        expect(new Set(keys).size, 'no cell double-occupied').toBe(6);
        for (const c of next) {
          expect(c.col, 'col on the 6-wide own half').toBeGreaterThanOrEqual(0);
          expect(c.col).toBeLessThan(6);
          expect(c.row, 'row on the 4-deep own half — never the enemy half').toBeGreaterThanOrEqual(0);
          expect(c.row).toBeLessThan(4);
        }
        expect(placementIsLegal(next, 6)).toBe(true);
        placement = next;
      }
    }
  });

  it('a legal drop onto an occupied cell swaps the two heroes (no duplication, no loss)', () => {
    const placement = defaultPlacement(6); // slots 0..5 on distinct cells
    const target = { col: placement[1]!.col, row: placement[1]!.row }; // slot 1's cell
    const next = placeHeroAt(placement, 0, target);
    expect(next[0]).toEqual(target);
    expect(next[1]).toEqual({ col: placement[0]!.col, row: placement[0]!.row });
    expect(new Set(next.map((c) => `${c.col},${c.row}`)).size).toBe(6);
  });

  it('a deploy action built from an off-grid (enemy-half) cell is ignored by runMatch', () => {
    const seed = 20250606;
    const probe = runMatch(seed, [], createStubCombatResolver());
    const lineup = probe.boundaries[0]!.state.players.find((p) => p.isHuman)!.pool.slice(0, 6);
    const illegal = defaultPlacement(6).map((c, i) => (i === 0 ? { col: 0, row: 4 } : c)); // row 4 = off-grid
    expect(isValidDeployment(illegal, 6)).toBe(false);

    const res = runMatch(
      seed,
      [
        buildAction.selectLineup(lineup),
        buildAction.confirmPhase(),
        buildAction.confirmPhase(), // module draw
        buildAction.deploy(illegal),
        buildAction.confirmPhase(), // select position
      ],
      createStubCombatResolver(),
    );
    const human = res.boundaries.find((b) => b.label === '1-2')!.state.players.find((p) => p.isHuman)!;
    // illegal deployment ignored -> the engine formation (null) stands
    expect(human.deployment).toBeNull();
  });
});
