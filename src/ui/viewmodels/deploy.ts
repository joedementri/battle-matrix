/*
 * Select Position view model + the pure drag/drop reducers.
 *
 * READING (documented in docs/QA.md and the M8 report): the 6×4 grid the player
 * edits IS the player's own half of the arena. `UBMP_SELECT_POSITION_PHASE.png`
 * shows a single 6×4 grid on the near half and plain, grid-less ground beyond —
 * there is no second grid for the enemy half. "Nothing on the enemy half" is
 * therefore satisfied by construction: a drop target is always one of the 24
 * own-half cells (`isCellInBounds`), and off-grid drops are rejected.
 *
 * PURE, no DOM. `placeHeroAt` swaps on collision so the result is always a legal
 * `Deployment` — never double-occupied, never more than the six lineup slots.
 */

import * as S from '../../data/strings';
import {
  BACK_ROW,
  DEPLOY_COLS,
  DEPLOY_ROWS,
  FRONT_ROW,
  isCellInBounds,
  isValidDeployment,
} from '../../sim/board';
import type { DeployCell } from '../../sim/board';
import { resolveHeroArt } from '../heroArt';
import type { HeroArt } from '../heroArt';

/** A sensible starting layout: front two of the lineup up front, the rest a row back. */
export function defaultPlacement(lineupSize: number): DeployCell[] {
  const cells: DeployCell[] = [];
  for (let slot = 0; slot < lineupSize; slot += 1) {
    const col = slot % DEPLOY_COLS;
    const row = slot < 3 ? FRONT_ROW : Math.max(BACK_ROW, FRONT_ROW - 1);
    cells.push({ col, row });
  }
  return cells;
}

export interface BoardCellVM {
  readonly col: number;
  readonly row: number;
  readonly front: boolean; // the row nearest the enemy
  readonly occupantSlot: number | null; // lineup index standing here
  readonly art: HeroArt | null;
}

export interface DeployVM {
  readonly title: string; // `Select Position`
  readonly cols: number;
  readonly rows: number;
  /** Row-major, FRONT row first (top of the rendered grid) down to the BACK row. */
  readonly cells: readonly BoardCellVM[];
  readonly legal: boolean;
  readonly deployLabel: string; // `DEPLOY`
  readonly exitLabel: string; // `EXIT EDITING`
}

export function deployVM(lineup: readonly string[], placement: readonly DeployCell[]): DeployVM {
  const cells: BoardCellVM[] = [];
  for (let row = FRONT_ROW; row >= BACK_ROW; row -= 1) {
    for (let col = 0; col < DEPLOY_COLS; col += 1) {
      const occupantSlot = placement.findIndex((cell) => cell.col === col && cell.row === row);
      const heroId = occupantSlot >= 0 ? lineup[occupantSlot] : undefined;
      cells.push({
        col,
        row,
        front: row === FRONT_ROW,
        occupantSlot: occupantSlot >= 0 ? occupantSlot : null,
        art: heroId === undefined ? null : resolveHeroArt(heroId),
      });
    }
  }
  return {
    title: S.SELECT_POSITION,
    cols: DEPLOY_COLS,
    rows: DEPLOY_ROWS,
    cells,
    legal: isValidDeployment(placement, lineup.length),
    deployLabel: S.BTN_DEPLOY,
    exitLabel: S.HINT_EXIT_EDITING,
  };
}

/**
 * Move lineup `slot` to `cell`. Off-grid (the "enemy half") is rejected — the
 * placement is returned unchanged. If another slot already stands on `cell`, the
 * two trade places, so the result never double-occupies a cell and always keeps
 * exactly `placement.length` heroes.
 */
export function placeHeroAt(
  placement: readonly DeployCell[],
  slot: number,
  cell: DeployCell,
): DeployCell[] {
  if (slot < 0 || slot >= placement.length) return placement.map((c) => ({ ...c }));
  if (!isCellInBounds(cell)) return placement.map((c) => ({ ...c }));
  const next = placement.map((c) => ({ ...c }));
  const here = next[slot]!;
  const occupant = next.findIndex((c, i) => i !== slot && c.col === cell.col && c.row === cell.row);
  if (occupant >= 0) next[occupant] = { col: here.col, row: here.row };
  next[slot] = { col: cell.col, row: cell.row };
  return next;
}

export function placementIsLegal(placement: readonly DeployCell[], lineupSize: number): boolean {
  return isValidDeployment(placement, lineupSize);
}
