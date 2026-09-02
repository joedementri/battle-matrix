/*
 * Pure display formatting for the UI layer. FORMAT ONLY — every number here
 * arrives already derived by a `src/sim` export; this file just turns it into
 * the exact glyphs and decimal places the screenshots show. No game rule, no
 * arithmetic on tokens / health / xp / price / threshold values.
 */

/** One decimal place, matching every observed shop-card / owned-module value (`90.0`, `20.0`, `32.0`). */
export function oneDecimal(value: number): string {
  return value.toFixed(1);
}

/**
 * Fill a Base Module's `effect` template (`Vanguard max health +{value}`,
 * `Duelist ult energy gain +{value}%`) with a one-decimal number. The caller
 * supplies the already-resolved value — level-1 for a shop card, cumulative at
 * the owned level for the info pane — so this stays FORMAT ONLY.
 */
export function renderModuleEffect(effectTemplate: string, value: number, isPercent: boolean): string {
  const num = value.toFixed(1);
  return isPercent
    ? effectTemplate.replace('{value}%', `${num}%`)
    : effectTemplate.replace('{value}', num);
}

/**
 * Rarity-odds percentage, reproducing BOTH observed odds rows: exact `0` and
 * `100` render with no decimal (`100%`, `0%`); everything else carries one
 * (`86.5%`, `12.0%`, `1.5%`).
 */
export function oddsPercent(value: number): string {
  return value === 0 || value === 100 ? `${value}%` : `${value.toFixed(1)}%`;
}

export const STAR = '★'; // ★

export type StarState = 'filled' | 'next' | 'empty';

export interface StarCell {
  readonly index: number;
  readonly state: StarState;
}

/**
 * The star row model for a shop card: `filled` up to the OWNED level, the very
 * next star `next`-highlighted (the "what an UPGRADE/PURCHASE buys you" cue from
 * the zoomed shop screenshot), the rest `empty`. Length is the module's max
 * stars (6 / 3 / 1).
 */
export function starRow(filledCount: number, totalStars: number): StarCell[] {
  const cells: StarCell[] = [];
  for (let index = 0; index < totalStars; index += 1) {
    let state: StarState = 'empty';
    if (index < filledCount) state = 'filled';
    else if (index === filledCount) state = 'next';
    cells.push({ index, state });
  }
  return cells;
}

/** `MM:SS` for a whole-second countdown (top-bar timer). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
