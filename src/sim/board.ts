/*
 * M7 — the deploy board: the 6×4 grid a player positions their six heroes on
 * before a battle (the `selectPosition` phase), plus the mapping from a grid
 * cell to arena coordinates.
 *
 * ONE SOURCE OF TRUTH for cell → arena: `combat.ts` imports `cellToArena` from
 * here, so a stored `Deployment` resolves to exactly the coordinates the
 * engine's own fallback formation (`assignFormation`) uses for the same cell.
 *
 * ROW CONVENTION — row `FRONT_ROW` (= `BOARD.rows - 1`) is the FRONT line,
 * nearest the enemy; row 0 is the back. This matches `combat.ts`'s pre-M7
 * `placeCell`: `depthFromFront = (rows - 1 - row) × ARENA_CELL_SIZE`, so a
 * higher row index sits closer to the centre line.
 *
 * "Own half" — the board is per-player: a player's six cells all live on their
 * own 6×4 grid, which is their half of the shared arena. `combat.ts` maps side
 * A's grid to negative Y and side B's past `ARENA_TEAM_SEPARATION`; a
 * `Deployment` can never reach the enemy's grid because it only carries
 * `col ∈ [0,5]`, `row ∈ [0,3]` and the side is supplied at resolve time.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { BOARD } from '../data/constants';
import { ARENA_CELL_SIZE, ARENA_TEAM_SEPARATION } from '../data/authored';

// ---------------------------------------------------------------------------
// Grid dimensions (canonical — BOARD is `{ cols: 6, rows: 4 }`)
// ---------------------------------------------------------------------------

export const DEPLOY_COLS = BOARD.cols;
export const DEPLOY_ROWS = BOARD.rows;
/** The front line, nearest the enemy. */
export const FRONT_ROW = DEPLOY_ROWS - 1;
/** The back line. */
export const BACK_ROW = 0;

// ---------------------------------------------------------------------------
// Deployment shape
// ---------------------------------------------------------------------------

/** A single grid cell. `col ∈ [0, DEPLOY_COLS)`, `row ∈ [0, DEPLOY_ROWS)`. */
export interface DeployCell {
  readonly col: number;
  readonly row: number;
}

/**
 * One cell per lineup slot: `deployment[i]` is where lineup hero `i` stands.
 * Length equals the lineup size (6 in a real match). Plain JSON — it rides on
 * `PlayerState` and must serialize with the rest of the state.
 */
export type Deployment = readonly DeployCell[];

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------

export function isCellInBounds(cell: DeployCell): boolean {
  return (
    Number.isInteger(cell.col) &&
    Number.isInteger(cell.row) &&
    cell.col >= 0 &&
    cell.col < DEPLOY_COLS &&
    cell.row >= 0 &&
    cell.row < DEPLOY_ROWS
  );
}

/**
 * A deployment is valid iff it has exactly `size` cells, every cell is on the
 * 6×4 grid, and no two heroes share a cell.
 */
export function isValidDeployment(deployment: Deployment, size: number): boolean {
  if (deployment.length !== size) return false;
  const seen = new Set<string>();
  for (const cell of deployment) {
    if (!isCellInBounds(cell)) return false;
    const key = `${cell.col},${cell.row}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Cell → arena coordinates (identical to combat.ts's formation mapping)
// ---------------------------------------------------------------------------

/**
 * Map grid `(col, row)` to arena `(x, y)` for `side` (0 = side A at negative Y,
 * 1 = side B past `ARENA_TEAM_SEPARATION`). This is exactly `combat.ts`'s
 * pre-M7 `placeCell` arithmetic, lifted here so a `Deployment` and the engine
 * fallback formation agree cell-for-cell.
 */
export function cellToArena(
  col: number,
  row: number,
  side: 0 | 1,
): { readonly x: number; readonly y: number } {
  const x = (col - (DEPLOY_COLS - 1) / 2) * ARENA_CELL_SIZE;
  const depthFromFront = (DEPLOY_ROWS - 1 - row) * ARENA_CELL_SIZE;
  const y = side === 0 ? -depthFromFront : ARENA_TEAM_SEPARATION + depthFromFront;
  return { x, y };
}
