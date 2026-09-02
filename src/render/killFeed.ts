/*
 * The kill feed — `KILLER ⟶ weapon ⟶ VICTIM`, most recent first, capped.
 *
 * It consumes M5's append-only `KillEvent[]` BY CURSOR: an index into the
 * stream, advanced each frame. Never by diffing state between frames — a diff
 * double-counts when several kills land in one tick and drops events across a
 * skipped frame. `consume()` is idempotent w.r.t. already-seen events.
 *
 * Entry lifetime / fade is authored here (renderer-local ephemeral state, never
 * in sim state) and the executor honours `prefers-reduced-motion` by drawing
 * faded entries at full opacity instead of animating them out.
 */

import * as S from '../data/strings';
import { resolveUnitArt } from '../ui/heroArt';
import type { KillEvent } from '../sim/combat';

/** Ticks an entry stays fully lit before it starts fading, then is culled. */
export const KILL_FEED_HOLD_TICKS = 30 * 4; // ~4 s at 30 Hz
export const KILL_FEED_FADE_TICKS = 30 * 1; // ~1 s fade tail
/** Most recent N entries kept (authored). */
export const KILL_FEED_CAP = 5;

export interface KillFeedRow {
  readonly killerLabel: string;
  readonly weaponLabel: string;
  readonly victimLabel: string;
  readonly killerColorVar: string;
  readonly victimColorVar: string;
  /** 0..1 — 1 while held, ramps to 0 over the fade tail. */
  readonly opacity: number;
  /** The stream index this row came from (stable identity). */
  readonly seq: number;
}

interface Entry {
  readonly seq: number;
  readonly killerLabel: string;
  readonly weaponLabel: string;
  readonly victimLabel: string;
  readonly killerColorVar: string;
  readonly victimColorVar: string;
  readonly addedTick: number;
}

function nameFor(heroId: string | null): string {
  if (heroId === null) return S.KILL_FEED_WEAPON['drone'] ?? 'Ultron Drone';
  return resolveUnitArt(heroId).name.toUpperCase();
}

function colorVarFor(heroId: string | null): string {
  if (heroId === null) return '--bm-accent';
  return resolveUnitArt(heroId).colorVar;
}

export class KillFeed {
  private cursor = 0;
  private readonly entries: Entry[] = [];
  private readonly cap: number;

  constructor(cap: number = KILL_FEED_CAP) {
    this.cap = cap;
  }

  /**
   * Fold every kill event not yet seen into the feed, stamped with `nowTick`.
   * Safe to call every frame with the same growing array.
   */
  consume(kills: readonly KillEvent[], nowTick: number): void {
    for (let i = this.cursor; i < kills.length; i += 1) {
      const k = kills[i]!;
      this.entries.push({
        seq: i,
        killerLabel: nameFor(k.killerHeroId),
        weaponLabel: S.KILL_FEED_WEAPON[k.weapon] ?? k.weapon,
        victimLabel: nameFor(k.victimHeroId),
        killerColorVar: colorVarFor(k.killerHeroId),
        victimColorVar: colorVarFor(k.victimHeroId),
        addedTick: nowTick,
      });
    }
    this.cursor = kills.length;
    // Keep only what could still be visible: the cap, plus anything inside its
    // fade window (older rows can never be shown again).
    while (this.entries.length > this.cap * 3) this.entries.shift();
  }

  /** The rows to draw, newest first, capped, with fade opacity for `nowTick`. */
  rows(nowTick: number, reducedMotion = false): KillFeedRow[] {
    const out: KillFeedRow[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < this.cap; i -= 1) {
      const e = this.entries[i]!;
      const age = nowTick - e.addedTick;
      let opacity = 1;
      if (!reducedMotion && age > KILL_FEED_HOLD_TICKS) {
        const t = (age - KILL_FEED_HOLD_TICKS) / KILL_FEED_FADE_TICKS;
        opacity = t >= 1 ? 0 : 1 - t;
      }
      if (opacity <= 0) continue;
      out.push({
        killerLabel: e.killerLabel,
        weaponLabel: e.weaponLabel,
        victimLabel: e.victimLabel,
        killerColorVar: e.killerColorVar,
        victimColorVar: e.victimColorVar,
        opacity,
        seq: e.seq,
      });
    }
    return out;
  }

  /** Total distinct kill events consumed so far (for the once-only test). */
  get consumedCount(): number {
    return this.cursor;
  }
}
