/*
 * M6 — the Ultron Drone: the entity the player flies over the battle.
 *
 * THE DRONE IS INPUT, NOT A UNIT.
 *  - It never appears in `field.units`, so no targeting code can acquire it and
 *    no damage path can reach it. Its "HP" is a frozen copy of the owning
 *    player's 50-based health, read-only for the whole battle; it changes only
 *    BETWEEN rounds, in `match.ts`, through round results.
 *  - Its per-tick control is a DETERMINISTIC, QUANTIZED input stream carried in
 *    the action list — the `drones` / `externalActors` seam M5 left. M9 owns
 *    live capture; its job is to PRODUCE a `DroneInputStream` of exactly this
 *    shape from raw mouse/keyboard so a replay reproduces bit-for-bit across
 *    machines.
 *
 * QUANTIZATION (why every field here is an integer or a tick index):
 *  - movement: a normalised direction stored as fixed-point — integer components
 *    in [−DRONE_MOVE_QUANT, DRONE_MOVE_QUANT], divided by DRONE_MOVE_QUANT and
 *    (only if the magnitude exceeds 1) sqrt-normalised at read time. A raw
 *    mouse-derived float would desync a replay between JS engines.
 *  - ability presses: absolute tick indices (`oneTimeDamageTick`, …).
 *  - the Encephalo-Ray hold: inclusive [startTick, endTick] ranges.
 *
 * `combat.ts` owns the per-tick integration (it holds `field.queue`); this file
 * is pure decoding + the match-level "which drones does this matchup host" call.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { DRONE_COLOURS } from '../data/constants';
import {
  DRONE_MOVE_QUANT,
  MIRROR_MATCHUP_HAS_OPPONENT_DRONE,
  PHANTOM_MATCHUP_HAS_OPPONENT_DRONE,
} from '../data/authored';

import type { Substream } from './rng';
import type { MatchupKind } from './types';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** One of the canonical six drone colours (drawn once per match, per player). */
export type DroneColour = (typeof DRONE_COLOURS)[number];

/**
 * Assign a colour to each of `count` players from ONE named substream, once per
 * match. With `count <= 6` this is a shuffle of the six canonical colours, so
 * every player gets a distinct one; beyond six it cycles. Rendering is M9 — this
 * is state only.
 */
export function assignDroneColours(rng: Substream, count: number): DroneColour[] {
  const shuffled = rng.shuffle(DRONE_COLOURS);
  const out: DroneColour[] = [];
  for (let i = 0; i < count; i++) out.push(shuffled[i % shuffled.length] as DroneColour);
  return out;
}

// ---------------------------------------------------------------------------
// Quantized input stream
// ---------------------------------------------------------------------------

/** Fixed-point movement for one tick: integer components in ±DRONE_MOVE_QUANT. */
export interface DroneMove {
  readonly qx: number;
  readonly qy: number;
}

export interface DroneInputStream {
  /** `moves[i]` applies on tick `i + 1`; a missing / out-of-range entry = no move. */
  readonly moves: readonly DroneMove[];
  /** Tick index the player pressed `LSHIFT` (One-Time Damage); `null` = never. */
  readonly oneTimeDamageTick: number | null;
  /** Tick index the player pressed `E` (One-Time Healing); `null` = never. */
  readonly oneTimeHealTick: number | null;
  /** Inclusive `[startTick, endTick]` ranges the Encephalo-Ray beam is held. */
  readonly beamHeldRanges: readonly (readonly [number, number])[];
}

/** A drone that hovers and does nothing — the default when no input is recorded. */
export const IDLE_DRONE_INPUT: DroneInputStream = {
  moves: [],
  oneTimeDamageTick: null,
  oneTimeHealTick: null,
  beamHeldRanges: [],
};

/**
 * Quantize a raw (already roughly unit-length) direction for storage. M9 calls
 * this at capture time so nothing downstream ever sees a raw float.
 */
export function encodeDroneMove(x: number, y: number): DroneMove {
  const q = (v: number): number =>
    Math.max(-DRONE_MOVE_QUANT, Math.min(DRONE_MOVE_QUANT, Math.round(v * DRONE_MOVE_QUANT)));
  return { qx: q(x), qy: q(y) };
}

/**
 * Decode the quantized move for `tick` (1-based) into a bounded direction vector
 * (magnitude ≤ 1), or `null` for "no movement this tick". sqrt only — no angles.
 */
export function decodeDroneMove(stream: DroneInputStream, tick: number): { x: number; y: number } | null {
  const m = stream.moves[tick - 1];
  if (m === undefined) return null;
  let x = m.qx / DRONE_MOVE_QUANT;
  let y = m.qy / DRONE_MOVE_QUANT;
  if (x === 0 && y === 0) return null;
  const mag2 = x * x + y * y;
  if (mag2 > 1) {
    const mag = Math.sqrt(mag2);
    x /= mag;
    y /= mag;
  }
  return { x, y };
}

/** Is the Encephalo-Ray beam held on `tick` (1-based)? */
export function beamHeldAt(stream: DroneInputStream, tick: number): boolean {
  for (const [s, e] of stream.beamHeldRanges) {
    if (tick >= s && tick <= e) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Drone spec — what `match.ts` hands the combat resolver
// ---------------------------------------------------------------------------

export interface DroneSpec {
  /** The side this drone flies for (0 = side A, 1 = side B). */
  readonly side: 0 | 1;
  readonly playerId: number;
  readonly colour: DroneColour;
  /** = the owning player's current health (50-based). Read-only inside a battle. */
  readonly health: number;
  /**
   * A recorded quantized input stream, or `null` to be driven by the placeholder
   * drone policy (`dronePolicy.ts`; replaced in M7). In a headless `runMatch`
   * there is no recorded stream yet — live capture is M9 — so every drone runs
   * on the placeholder, exactly as `botPolicy.ts` covers both bots and the human
   * draft in M2.
   */
  readonly input: DroneInputStream | null;
}

/**
 * Which drones a matchup hosts. Side A is always the living player whose result
 * is reported. The two solo-matchup calls are AUTHORED (`authored.ts`):
 *  - `pvp`     → both players' drones.
 *  - `mirror`  → the player's drone + a policy drone for the mirrored opponent
 *                (`MIRROR_MATCHUP_HAS_OPPONENT_DRONE = true`).
 *  - `phantom` → only the player's drone; a phantom is eliminated and "beating
 *                one gives you nothing" (`PHANTOM_MATCHUP_HAS_OPPONENT_DRONE = false`).
 *  - `pve`     → only the player's drone; Galacta Bots have none (`b` is `null`).
 */
export function planMatchupDrones(input: {
  readonly matchupKind: MatchupKind;
  readonly a: { readonly playerId: number; readonly colour: DroneColour; readonly health: number };
  readonly b: { readonly playerId: number; readonly colour: DroneColour; readonly health: number } | null;
}): DroneSpec[] {
  const drones: DroneSpec[] = [
    { side: 0, playerId: input.a.playerId, colour: input.a.colour, health: input.a.health, input: null },
  ];

  const wantB =
    input.matchupKind === 'pvp' ||
    (input.matchupKind === 'mirror' && MIRROR_MATCHUP_HAS_OPPONENT_DRONE) ||
    (input.matchupKind === 'phantom' && PHANTOM_MATCHUP_HAS_OPPONENT_DRONE);

  if (wantB && input.b !== null) {
    drones.push({
      side: 1,
      playerId: input.b.playerId,
      colour: input.b.colour,
      health: input.b.health,
      input: null,
    });
  }
  return drones;
}
