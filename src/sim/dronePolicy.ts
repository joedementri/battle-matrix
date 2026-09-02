/*
 * M7 — the Ultron-Drone AI policy. One rule for every seat (the plan gives no
 * per-archetype drone), so this lives in `src/sim/` and is shared, not in
 * `src/ai/`. It drives any drone whose input stream is `null` — every drone in
 * a headless `runMatch`, since live capture is M9.
 *
 * BEHAVIOUR (`authored.ts` → `DRONE_POLICY`, RNG-free):
 *   - movement: drift toward the nearest living enemy unit (`combat.ts` clamps
 *     to the arena bounds and scales by `DRONE_MOVE_SPEED`). The drone flies
 *     over the fight; it is never a `Unit` and never collides.
 *   - beam: hold the Encephalo-Ray whenever an enemy is alive. Its whole-battle
 *     damage is bounded by an ASSERTION (`tests/drone.spec.ts`), not by policy —
 *     it stays sub-1 % of a Duelist's output and never flips an outcome.
 *   - One-Time Damage once ≥ `DRONE_POLICY_DAMAGE_ENEMY_THRESHOLD` enemy units
 *     are below `DRONE_POLICY_LOW_HP_FRACTION`; One-Time Healing once
 *     ≥ `DRONE_POLICY_HEAL_ALLY_THRESHOLD` allies are. Each fires at most once
 *     per Battle Phase (`combat.ts` holds the `used` guard) and resets next round.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 * `Math.sqrt` only — direction is normalised vector math, never angles.
 */

import {
  DRONE_POLICY,
  DRONE_POLICY_DAMAGE_ENEMY_THRESHOLD,
  DRONE_POLICY_HEAL_ALLY_THRESHOLD,
} from '../data/authored';

/** The snapshot `combat.ts` builds for the policy each tick. */
export interface DronePolicyView {
  /** Living enemy units below `DRONE_POLICY_LOW_HP_FRACTION` of max health. */
  readonly enemiesBelowLowHp: number;
  /** Living allied units below `DRONE_POLICY_LOW_HP_FRACTION` of max health. */
  readonly alliesBelowLowHp: number;
  readonly oneTimeDamageUsed: boolean;
  readonly oneTimeHealUsed: boolean;
  /** The drone's current position. */
  readonly x: number;
  readonly y: number;
  /** The nearest living enemy unit's position, or `null` if none remain. */
  readonly targetX: number | null;
  readonly targetY: number | null;
}

/** One tick of drone control. Also the shape recorded input decodes to. */
export interface DroneCommand {
  /** A bounded direction vector (magnitude ≤ 1), or `null` for "hold position". */
  readonly move: { readonly x: number; readonly y: number } | null;
  readonly beam: boolean;
  readonly pressOneTimeDamage: boolean;
  readonly pressOneTimeHeal: boolean;
}

/** Unit vector from the drone toward `(targetX, targetY)`, or `null` if already there. */
function steerToward(view: DronePolicyView): DroneCommand['move'] {
  if (view.targetX === null || view.targetY === null) return null;
  const dx = view.targetX - view.x;
  const dy = view.targetY - view.y;
  const distSq = dx * dx + dy * dy;
  if (distSq <= 1e-9) return null;
  const dist = Math.sqrt(distSq);
  return { x: dx / dist, y: dy / dist };
}

export function dronePolicy(view: DronePolicyView): DroneCommand {
  const enemyAlive = view.targetX !== null;
  return {
    move: DRONE_POLICY.movement === 'trackNearestEnemyUnit' ? steerToward(view) : null,
    beam: DRONE_POLICY.holdBeamWhileEnemyAlive && enemyAlive,
    pressOneTimeDamage:
      !view.oneTimeDamageUsed && view.enemiesBelowLowHp >= DRONE_POLICY_DAMAGE_ENEMY_THRESHOLD,
    pressOneTimeHeal:
      !view.oneTimeHealUsed && view.alliesBelowLowHp >= DRONE_POLICY_HEAL_ALLY_THRESHOLD,
  };
}
