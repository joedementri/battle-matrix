/*
 * M7 PLACEHOLDER DRONE POLICY — this whole file is replaced in M7, not extended.
 *
 * M7 ships five real opponent bundles, each with its own drone policy. This is
 * the minimal stand-in, the same pattern `botPolicy.ts` used for the M2
 * placeholder draft: implement ONLY the plan's literal M7 drone rule and leave
 * every other hook (movement, the Encephalo-Ray beam) inert.
 *
 * Plan (M7): "One-Time Damage when >=3 enemies are below 40% HP; One-Time
 * Healing when >=2 allies are below 40%." The thresholds and the 40% fraction
 * are in `authored.ts` (DRONE_POLICY_*).
 *
 * RNG-FREE by design: a purely reactive function of the battle snapshot, so
 * wiring the placeholder into `match.ts` shifts no substream — the M7 isolation
 * invariant ("adding a policy never moves another's rolls") already holds for it.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import {
  DRONE_POLICY_DAMAGE_ENEMY_THRESHOLD,
  DRONE_POLICY_HEAL_ALLY_THRESHOLD,
} from '../data/authored';

/** The snapshot the placeholder policy reads (built by `combat.ts` each tick). */
export interface DronePolicyView {
  /** Living enemy units below `DRONE_POLICY_LOW_HP_FRACTION` of max health. */
  readonly enemiesBelowLowHp: number;
  /** Living allied units below `DRONE_POLICY_LOW_HP_FRACTION` of max health. */
  readonly alliesBelowLowHp: number;
  readonly oneTimeDamageUsed: boolean;
  readonly oneTimeHealUsed: boolean;
}

/** One tick of drone control. Also the shape recorded input decodes to. */
export interface DroneCommand {
  /** A bounded direction vector (magnitude ≤ 1), or `null` for "hold position". */
  readonly move: { readonly x: number; readonly y: number } | null;
  readonly beam: boolean;
  readonly pressOneTimeDamage: boolean;
  readonly pressOneTimeHeal: boolean;
}

export function placeholderDronePolicy(view: DronePolicyView): DroneCommand {
  return {
    move: null, // M7 owns drone movement
    beam: false, // M7 owns the beam
    pressOneTimeDamage:
      !view.oneTimeDamageUsed && view.enemiesBelowLowHp >= DRONE_POLICY_DAMAGE_ENEMY_THRESHOLD,
    pressOneTimeHeal:
      !view.oneTimeHealUsed && view.alliesBelowLowHp >= DRONE_POLICY_HEAL_ALLY_THRESHOLD,
  };
}
