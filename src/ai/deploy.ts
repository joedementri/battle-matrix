/*
 * M7 — deploy heuristics: build a 6×4 board `Deployment` for a lineup.
 *
 * The plan's base heuristic (M7): "Vanguards front row, ranged Duelists back,
 * melee Duelists flanking, Strategists back-centre." `roleFormation` implements
 * exactly that; the archetype variants apply one mild transform on top:
 *   standard     — the base heuristic (Greedy Banker, Equilibrium Purist).
 *   frontLoad    — every hero one row closer to the front (Streak Rider's
 *                  "aggressive front-load").
 *   roleStack    — the rushed role is forced onto the front row (Protocol
 *                  Rusher "stacks that role").
 *   counter      — pull back a row vs a melee-heavy last opponent, push forward
 *                  a row vs a ranged-heavy one (Adaptive "counters the last
 *                  opponent seen"); the base heuristic otherwise.
 *
 * Every result is a valid `Deployment` (exactly `lineup.length` cells, all on
 * the 6×4 grid, no two heroes sharing a cell): the grid holds 24 cells and a
 * lineup at most 6, so the priority fill never has to spill, and a Set guards
 * against a double-book regardless.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { DEPLOY_MELEE_DUELIST_RANGE_MAX } from '../data/authored';
import heroesJson from '../data/heroes.json';
import type { Role } from '../data/types';
import {
  BACK_ROW,
  DEPLOY_COLS,
  DEPLOY_ROWS,
  FRONT_ROW,
} from '../sim/board';
import type { DeployCell, Deployment } from '../sim/board';
import type { DeployInput } from './types';

const HERO_RANGE: ReadonlyMap<string, number> = new Map(
  (heroesJson as unknown as readonly { id: string; combat: { attackRange: number } }[]).map((h) => [
    h.id,
    h.combat.attackRange,
  ]),
);

/** Columns filled centre-out (Vanguards, Strategists, the rushed role). */
const CENTRE_OUT: readonly number[] = [2, 3, 1, 4, 0, 5];
/** Columns filled outer-in (melee Duelist flankers). */
const OUTER_IN: readonly number[] = [0, 5, 1, 4, 2, 3];

function clampRow(row: number): number {
  return Math.max(0, Math.min(DEPLOY_ROWS - 1, row));
}

interface Slotted {
  readonly slot: number;
  readonly row: number;
  /** true = fill this hero's row centre-out, false = outer-in. */
  readonly centreOut: boolean;
}

/** The plan's base row for a hero, before any archetype transform. */
function baseRow(heroId: string, role: Role): { row: number; centreOut: boolean } {
  if (role === 'vanguard') return { row: FRONT_ROW, centreOut: true };
  if (role === 'strategist') return { row: BACK_ROW, centreOut: true };
  // duelist: melee flanks a row behind the front, ranged sits at the back + 1
  const melee = (HERO_RANGE.get(heroId) ?? Number.POSITIVE_INFINITY) <= DEPLOY_MELEE_DUELIST_RANGE_MAX;
  return melee ? { row: FRONT_ROW - 1, centreOut: false } : { row: BACK_ROW + 1, centreOut: true };
}

/** Rows to try for a hero, nearest the preferred first, then alternating out. */
function rowsByDistance(preferred: number): number[] {
  const rows: number[] = [];
  for (let d = 0; d < DEPLOY_ROWS; d++) {
    if (preferred - d >= 0) rows.push(preferred - d);
    if (d > 0 && preferred + d < DEPLOY_ROWS) rows.push(preferred + d);
  }
  return rows;
}

/** Place each slotted hero into the first free cell of its preferred row / priority. */
function placeIntoGrid(slotted: readonly Slotted[]): DeployCell[] {
  const used = new Set<string>();
  const cells: DeployCell[] = new Array<DeployCell>(slotted.length);
  // Process by preferred row (front rows first) so role clusters form; tiebreak by slot.
  const order = [...slotted].sort((a, b) => b.row - a.row || a.slot - b.slot);
  for (const s of order) {
    const priority = s.centreOut ? CENTRE_OUT : OUTER_IN;
    let placed = false;
    for (const row of rowsByDistance(s.row)) {
      for (const col of priority) {
        const key = `${col},${row}`;
        if (used.has(key)) continue;
        used.add(key);
        cells[s.slot] = { col, row };
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      // Unreachable for ≤ 6 heroes on a 24-cell grid, but keep validity total.
      for (let row = 0; row < DEPLOY_ROWS && !placed; row++) {
        for (let col = 0; col < DEPLOY_COLS && !placed; col++) {
          const key = `${col},${row}`;
          if (used.has(key)) continue;
          used.add(key);
          cells[s.slot] = { col, row };
          placed = true;
        }
      }
    }
  }
  return cells;
}

export interface FormationOptions {
  /** Shift every hero this many rows toward the front (negative = toward the back). */
  readonly rowShift?: number;
  /** Force heroes of this role onto the front row (Protocol Rusher). */
  readonly forceFrontRole?: Role | null;
}

/** The plan's base heuristic, with an optional archetype transform. */
export function roleFormation(
  lineup: readonly string[],
  roleOf: Readonly<Record<string, Role>>,
  opts: FormationOptions = {},
): Deployment {
  const rowShift = opts.rowShift ?? 0;
  const forceFront = opts.forceFrontRole ?? null;
  const slotted: Slotted[] = lineup.map((heroId, slot) => {
    const role = roleOf[heroId] ?? 'duelist';
    const base = baseRow(heroId, role);
    const row =
      forceFront !== null && role === forceFront ? FRONT_ROW : clampRow(base.row + rowShift);
    return { slot, row, centreOut: base.centreOut };
  });
  return placeIntoGrid(slotted);
}

/** How short-ranged a lineup is — units at or below the melee cutoff. */
function shortRangeCount(lineup: readonly string[]): number {
  let n = 0;
  for (const id of lineup) {
    if ((HERO_RANGE.get(id) ?? Number.POSITIVE_INFINITY) <= DEPLOY_MELEE_DUELIST_RANGE_MAX) n++;
  }
  return n;
}

/** Adaptive: read the last opponent's range profile and pick a counter-shift. */
export function counterFormation(input: DeployInput): Deployment {
  const last = input.lastOpponentLineup;
  if (last === null || last.length === 0) {
    return roleFormation(input.lineup, input.roleOf);
  }
  const short = shortRangeCount(last);
  // Melee-heavy enemy → hold back and let them cross open ground (rowShift -1).
  // Ranged-heavy enemy → close the distance fast (rowShift +1).
  const rowShift = short >= last.length / 2 ? -1 : 1;
  return roleFormation(input.lineup, input.roleOf, { rowShift });
}
