/*
 * The static arena, pre-rendered ONCE to an offscreen canvas per (size, dpr)
 * and blitted each frame. Nothing here depends on tick state, so it never
 * re-renders inside the frame loop — the plan's "pre-render the static arena to
 * an offscreen canvas".
 *
 * It draws the floor, the two team halves, and both 6×4 deploy grids in the
 * exact projection the frame builder uses, so tokens land on their cells.
 */

import { BOARD } from '../data/constants';
import { cellToArena } from '../sim/board';
import type { BattleFrameState } from '../sim/combat';
import { makeProjector } from './frame';
import type { Layout } from './frame';

function resolveColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}

export interface ArenaCache {
  readonly canvas: HTMLCanvasElement;
  readonly key: string;
}

function keyOf(layout: Layout): string {
  return `${Math.round(layout.width)}x${Math.round(layout.height)}@${layout.dpr}`;
}

/**
 * Return a cached offscreen canvas of the static arena for this layout, drawing
 * it only when the layout key changed. Returns `null` when there is no 2D
 * context (jsdom/happy-dom) — the executor then simply skips the blit.
 */
export function getArena(
  layout: Layout,
  bounds: BattleFrameState['bounds'],
  prev: ArenaCache | null,
): ArenaCache | null {
  const key = keyOf(layout);
  if (prev !== null && prev.key === key) return prev;
  if (typeof document === 'undefined') return null;

  const canvas = prev?.canvas ?? document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width * layout.dpr));
  canvas.height = Math.max(1, Math.round(layout.height * layout.dpr));
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;

  ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);

  const proj = makeProjector(bounds, layout);
  const floor = resolveColor('--bm-arena-floor', '#2a3350');
  const line = resolveColor('--bm-arena-line', '#3a4468');
  const sideA = resolveColor('--bm-fortress', '#4a6bd8');
  const sideB = resolveColor('--bm-onslaught', '#c8383c');

  // Arena slab.
  const x0 = proj.px(bounds.minX);
  const y0 = proj.py(bounds.minY);
  const x1 = proj.px(bounds.maxX);
  const y1 = proj.py(bounds.maxY);
  ctx.fillStyle = floor;
  ctx.globalAlpha = 0.82;
  roundRect(ctx, x0 - 14, y0 - 14, x1 - x0 + 28, y1 - y0 + 28, 14);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Centre line.
  const midY = proj.py((bounds.minY + bounds.maxY) / 2);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x0 - 8, midY);
  ctx.lineTo(x1 + 8, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Both 6x4 deploy grids.
  for (const side of [0, 1] as const) {
    ctx.strokeStyle = side === 0 ? sideA : sideB;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    for (let col = 0; col < BOARD.cols; col += 1) {
      for (let row = 0; row < BOARD.rows; row += 1) {
        const c = cellToArena(col, row, side);
        const cx = proj.px(c.x);
        const cy = proj.py(c.y);
        const half = (proj.scale * 6) / 2 - 1;
        ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      }
    }
  }
  ctx.globalAlpha = 1;

  return { canvas, key };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
