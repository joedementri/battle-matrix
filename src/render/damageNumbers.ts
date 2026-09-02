/*
 * Floating damage / heal numbers — RENDERER-LOCAL ephemeral state. It never
 * lives in sim state (the plan is explicit), and it is fed by M5's append-only
 * per-hit damage stream (`BattleTrace.damageLog` / `BattleController.damageLog`,
 * enabled with `trace: true`) consumed BY CURSOR — never by diffing unit health
 * between frames, which breaks under interpolation and dropped frames.
 *
 * Each entry spawns at its victim's tick position, drifts up, and fades. The
 * position is captured once at spawn (arena coords) so a later camera/interp
 * change cannot move an old number.
 */

import type { BattleFrameState } from '../sim/combat';
import type { DamageLogEntry } from '../sim/combat';
import type { DeepReadonly } from './readonly';

export const DMG_RISE_PX = 26;
export const DMG_LIFE_TICKS = 30; // ~1 s at 30 Hz
/** Below this, a hit is not worth a number (chip damage, drone beam). */
export const DMG_MIN_SHOWN = 1;
export const DMG_MAX_LIVE = 40;

export interface FloatingDamage {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly heal: boolean;
  readonly crit: boolean;
  /** px risen so far (0..DMG_RISE_PX). */
  readonly rise: number;
  /** 1..0 fade. */
  readonly opacity: number;
}

interface Live {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly heal: boolean;
  readonly crit: boolean;
  readonly bornTick: number;
}

export class DamageNumbers {
  private cursor = 0;
  private live: Live[] = [];

  /**
   * Fold new damage-log entries into the floating set, positioned from `frame`
   * (the tick the hits landed on). Safe to call every frame with the growing log.
   */
  consume(
    log: readonly DamageLogEntry[] | null,
    frame: DeepReadonly<BattleFrameState>,
    nowTick: number,
  ): void {
    if (log === null) return;
    for (let i = this.cursor; i < log.length; i += 1) {
      const e = log[i]!;
      const rounded = Math.round(e.amount);
      if (rounded < DMG_MIN_SHOWN) continue;
      const unit = frame.units[e.tgtUnitId];
      if (unit === undefined) continue;
      this.live.push({
        seq: i,
        x: unit.x,
        y: unit.y,
        text: String(rounded),
        heal: e.convertedToHeal,
        crit: e.source === 'ultimate',
        bornTick: nowTick,
      });
    }
    this.cursor = log.length;
    if (this.live.length > DMG_MAX_LIVE) this.live = this.live.slice(-DMG_MAX_LIVE);
  }

  /** The numbers to draw at `nowTick`, oldest first, with rise + fade applied. */
  active(nowTick: number): FloatingDamage[] {
    const out: FloatingDamage[] = [];
    for (const l of this.live) {
      const age = nowTick - l.bornTick;
      if (age < 0 || age >= DMG_LIFE_TICKS) continue;
      const t = age / DMG_LIFE_TICKS;
      out.push({
        seq: l.seq,
        x: l.x,
        y: l.y,
        text: l.text,
        heal: l.heal,
        crit: l.crit,
        rise: t * DMG_RISE_PX,
        opacity: 1 - t,
      });
    }
    return out;
  }

  /** Distinct damage-log entries consumed so far. */
  get consumedCount(): number {
    return this.cursor;
  }
}
