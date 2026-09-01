/*
 * M2 stub combat resolver.
 *
 * Combat is *injected* into `runMatch`, never imported by `match.ts`. This stub
 * satisfies the `CombatResolver` contract with a deterministic coin-flip driven
 * entirely by the per-matchup substream handed to it in `ctx.rng`. M5 replaces
 * it with the real 30 Hz tick sim; `match.ts` does not change.
 *
 * PURE: the only entropy is `ctx.rng`.
 */

import { HP_LOSS_SURVIVOR_RANGE } from '../data/authored';
import type { CombatContext, CombatOutcome, CombatResolver } from './types';

/**
 * A stub resolver.
 *
 * - PvE (Practice) leans decisively toward a player win; it is health-neutral in
 *   `match.ts` regardless, so the bias only keeps Practice rounds unremarkable.
 * - PvP / mirror / phantom split roughly win / loss / tie ~ 45 / 45 / 10.
 * - `survivingUnits` is a uniform draw across the canonical 1..6 range.
 */
export function createStubCombatResolver(): CombatResolver {
  const [minSurvivors, maxSurvivors] = HP_LOSS_SURVIVOR_RANGE;

  return {
    resolve(ctx: CombatContext): CombatOutcome {
      const roll = ctx.rng.next();

      let result: CombatOutcome['result'];
      if (ctx.matchupKind === 'pve') {
        result = roll < 0.8 ? 'win' : roll < 0.9 ? 'tie' : 'loss';
      } else {
        result = roll < 0.45 ? 'win' : roll < 0.9 ? 'loss' : 'tie';
      }

      return { result, survivingUnits: ctx.rng.int(minSurvivors, maxSurvivors) };
    },
  };
}
