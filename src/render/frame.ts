/*
 * The FRAME BUILDER — pure. `(readonly frame view, layout) -> draw command list`.
 *
 * No `ctx`, no DOM. Positions, bar segment counts, colours and text only. The
 * executor (`executor.ts`) walks the list issuing Canvas2D calls. Tests assert
 * on the list, which also makes "the renderer only READS sim state" a checkable
 * property: the input is `DeepReadonly<BattleFrameState>` and nothing here can
 * write to it.
 *
 * CAMERA (deliberate deviation from the screenshots — see docs/QA.md and the M9
 * report): the real mode shows a 3D third-person view behind the drone. Our
 * arena is a 2D canvas, so this renders the WHOLE arena in a fixed top-down
 * view with the drone as one more token — the 6×4 placement is the point of the
 * mode and a chase cam would hide most of it.
 *
 * Health / xp / token arithmetic is NOT done here — segment counts come from
 * `sim/selectors.healthBarModel`, ult fill from `ultChargeFraction`, position
 * tweening from `lerp`. `tests/enforce-no-arith.spec.ts` now also scans this dir.
 */

import * as S from '../data/strings';
import { healthBarModel, lerp, ultChargeFraction } from '../sim/selectors';
import type { BattleFrameState, FrameUnit } from '../sim/combat';
import { resolveDroneArt, resolveUnitArt } from '../ui/heroArt';
import type { UnitShape } from '../ui/heroArt';
import type { DeepReadonly } from './readonly';
import type { KillFeedRow } from './killFeed';
import type { FloatingDamage } from './damageNumbers';

export interface Layout {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Draw optional target lines from each unit to its current target. */
  readonly targetLines?: boolean;
  /** prefers-reduced-motion — the executor also reads this; the builder skips pulse alpha. */
  readonly reducedMotion?: boolean;
}

export interface BattleHudView {
  readonly playerName: string;
  readonly opponentName: string;
  /** LSHIFT — greyed exactly when the sim marks it spent. */
  readonly oneTimeDamageSpent: boolean;
  /** E. */
  readonly oneTimeHealSpent: boolean;
  readonly killFeed: readonly KillFeedRow[];
  readonly damageNumbers: readonly FloatingDamage[];
  /** true while pointer drives the drone; false = LALT cursor-mode (pointer free for UI). */
  readonly droneControl: boolean;
}

export interface BattleView {
  readonly cur: DeepReadonly<BattleFrameState>;
  /** The previous tick's frame, for interpolation. Same object as `cur` on tick 1. */
  readonly prev: DeepReadonly<BattleFrameState>;
  /** 0..1 between `prev` and `cur`. */
  readonly alpha: number;
  readonly hud: BattleHudView;
}

// ---------------------------------------------------------------------------
// Draw command — one flat struct so the executor can pool it (no per-frame
// object churn once the buffer is warm). `k` selects the shape; unused fields
// are simply ignored.
// ---------------------------------------------------------------------------

export type CmdKind =
  | 'arena'
  | 'rect'
  | 'circle'
  | 'line'
  | 'text'
  | 'token'
  | 'healthbar'
  | 'ultbar'
  | 'banner'
  | 'hudButton'
  | 'killRow'
  | 'dmg';

export interface DrawCmd {
  k: CmdKind;
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  x2: number;
  y2: number;
  fill: string;
  stroke: string;
  lineWidth: number;
  alpha: number;
  dash: number;
  text: string;
  font: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  shape: UnitShape | 'drone';
  colorVar: string;
  initials: string;
  dim: boolean;
  segments: number;
  filled: number;
  bonus: number;
  frac: number;
  label: string;
  key: string;
  disabled: boolean;
  killer: string;
  weapon: string;
  victim: string;
  killerColor: string;
  victimColor: string;
}

function blankCmd(): DrawCmd {
  return {
    k: 'rect',
    id: '',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    r: 0,
    x2: 0,
    y2: 0,
    fill: '',
    stroke: '',
    lineWidth: 0,
    alpha: 1,
    dash: 0,
    text: '',
    font: '',
    align: 'left',
    baseline: 'alphabetic',
    shape: 'blade',
    colorVar: '',
    initials: '',
    dim: false,
    segments: 0,
    filled: 0,
    bonus: 0,
    frac: 0,
    label: '',
    key: '',
    disabled: false,
    killer: '',
    weapon: '',
    victim: '',
    killerColor: '',
    victimColor: '',
  };
}

/**
 * A growable, reusable command buffer. `begin()` rewinds it; `add(k)` returns a
 * cleared struct to fill. Warm, it allocates nothing. Tests pass a fresh one.
 */
export class CmdList {
  private readonly pool: DrawCmd[] = [];
  private n = 0;

  begin(): void {
    this.n = 0;
  }

  add(k: CmdKind): DrawCmd {
    let c = this.pool[this.n];
    if (c === undefined) {
      c = blankCmd();
      this.pool.push(c);
    } else {
      Object.assign(c, blankCmd());
    }
    c.k = k;
    this.n += 1;
    return c;
  }

  get length(): number {
    return this.n;
  }

  at(i: number): DrawCmd {
    const c = this.pool[i];
    if (c === undefined) throw new RangeError(`CmdList.at(${i}) out of range (${this.n})`);
    return c;
  }

  toArray(): DrawCmd[] {
    return this.pool.slice(0, this.n);
  }

  *[Symbol.iterator](): Iterator<DrawCmd> {
    for (let i = 0; i < this.n; i += 1) yield this.pool[i]!;
  }
}

// ---------------------------------------------------------------------------
// Arena projection — fixed top-down, aspect-preserving, HUD margins
// ---------------------------------------------------------------------------

const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 72;
const MARGIN_X = 96;
const UNIT_RADIUS_PX = 13;
const DRONE_RADIUS_PX = 16;

export interface Projector {
  readonly ox: number;
  readonly oy: number;
  readonly scale: number;
  px(x: number): number;
  py(y: number): number;
}

export function makeProjector(bounds: BattleFrameState['bounds'], layout: Layout): Projector {
  const aw = bounds.maxX - bounds.minX;
  const ah = bounds.maxY - bounds.minY;
  const availW = Math.max(1, layout.width - MARGIN_X * 2);
  const availH = Math.max(1, layout.height - MARGIN_TOP - MARGIN_BOTTOM);
  const scale = Math.min(availW / aw, availH / ah);
  const drawnW = aw * scale;
  const drawnH = ah * scale;
  const ox = (layout.width - drawnW) / 2 - bounds.minX * scale;
  const oy = MARGIN_TOP + (availH - drawnH) / 2 - bounds.minY * scale;
  return {
    ox,
    oy,
    scale,
    px: (x: number) => ox + x * scale,
    py: (y: number) => oy + y * scale,
  };
}

// ---------------------------------------------------------------------------
// Frame builder
// ---------------------------------------------------------------------------

const FONT_HUD = S.battleFont('800 italic 16px');
const FONT_SMALL = S.battleFont('700 12px');
const FONT_DMG = S.battleFont('800 italic 15px');
const FONT_BANNER = S.battleFont('800 italic 22px');

function interpUnit(prev: DeepReadonly<FrameUnit> | undefined, cur: DeepReadonly<FrameUnit>, alpha: number): {
  x: number;
  y: number;
} {
  if (prev === undefined) return { x: cur.x, y: cur.y };
  return { x: lerp(prev.x, cur.x, alpha), y: lerp(prev.y, cur.y, alpha) };
}

/**
 * Build the whole battle frame. `out` is reused across frames when supplied
 * (the render loop passes its persistent buffer); tests pass a fresh `CmdList`
 * or omit it for a plain array via `toArray()`.
 */
export function buildBattleFrame(view: BattleView, layout: Layout, out: CmdList = new CmdList()): CmdList {
  out.begin();
  const { cur, prev, alpha, hud } = view;
  const proj = makeProjector(cur.bounds, layout);

  // --- static arena (executor blits a pre-rendered offscreen canvas) ---
  const arena = out.add('arena');
  arena.id = 'arena';
  arena.x = 0;
  arena.y = 0;
  arena.w = layout.width;
  arena.h = layout.height;

  const prevById = new Map<number, DeepReadonly<FrameUnit>>();
  for (const u of prev.units) prevById.set(u.id, u);

  // --- optional target lines (under the tokens) ---
  if (layout.targetLines === true) {
    for (const u of cur.units) {
      if (!u.alive || u.targetId < 0) continue;
      const tgt = cur.units[u.targetId];
      if (tgt === undefined || !tgt.alive) continue;
      const a = interpUnit(prevById.get(u.id), u, alpha);
      const b = interpUnit(prevById.get(tgt.id), tgt, alpha);
      const line = out.add('line');
      line.id = `target-${u.id}`;
      line.x = proj.px(a.x);
      line.y = proj.py(a.y);
      line.x2 = proj.px(b.x);
      line.y2 = proj.py(b.y);
      line.stroke = u.side === 0 ? '--bm-fortress' : '--bm-onslaught';
      line.lineWidth = 1;
      line.alpha = 0.28;
      line.dash = 4;
    }
  }

  // --- unit tokens + segmented health bar + ult-charge bar ---
  for (const u of cur.units) {
    const art = resolveUnitArt(u.heroId);
    const pos = interpUnit(prevById.get(u.id), u, alpha);
    const sx = proj.px(pos.x);
    const sy = proj.py(pos.y);

    const token = out.add('token');
    token.id = `unit-${u.id}`;
    token.x = sx;
    token.y = sy;
    token.r = UNIT_RADIUS_PX;
    token.shape = art.shape;
    token.colorVar = art.colorVar;
    token.initials = art.initials;
    token.dim = !u.alive;
    token.stroke = u.side === 0 ? '--bm-fortress' : '--bm-onslaught';
    if (!u.alive) continue;

    const bar = healthBarModel(u.health, u.overhealth, u.maxHealth);
    const hb = out.add('healthbar');
    hb.id = `hp-${u.id}`;
    hb.x = sx;
    hb.y = sy - UNIT_RADIUS_PX - 12;
    hb.w = 58;
    hb.h = 5;
    hb.segments = bar.segments;
    hb.filled = bar.filled;
    hb.bonus = bar.bonus;
    hb.fill = u.side === 0 ? '--bm-streak-win' : '--bm-onslaught';

    const uf = ultChargeFraction(u.ultEnergy);
    if (uf > 0) {
      const ub = out.add('ultbar');
      ub.id = `ult-${u.id}`;
      ub.x = sx;
      ub.y = sy - UNIT_RADIUS_PX - 6;
      ub.w = 58;
      ub.h = 3;
      ub.frac = uf;
      ub.fill = '--bm-accent';
    }
  }

  // --- floating damage numbers (renderer-local ephemeral, from the damage stream) ---
  for (let i = 0; i < hud.damageNumbers.length; i += 1) {
    const d = hud.damageNumbers[i]!;
    const c = out.add('dmg');
    c.id = `dmg-${d.seq}`;
    c.x = proj.px(d.x);
    c.y = proj.py(d.y) - d.rise;
    c.text = d.text;
    c.font = FONT_DMG;
    c.align = 'center';
    c.baseline = 'middle';
    c.fill = d.heal ? '--bm-heal' : d.crit ? '--bm-accent' : '--bm-hit';
    c.alpha = d.opacity;
  }

  // --- the Ultron Drone(s) + the Encephalo-Ray beam ---
  for (const d of cur.drones) {
    const pd = prev.drones.find((p) => p.playerId === d.playerId);
    const dx = pd ? lerp(pd.x, d.x, alpha) : d.x;
    const dy = pd ? lerp(pd.y, d.y, alpha) : d.y;
    const sdx = proj.px(dx);
    const sdy = proj.py(dy);

    if (d.beamHeld) {
      // Draw the beam to the nearest living enemy unit (endpoint choice only —
      // the sim owns who actually takes the tiny beam damage).
      let bx = 0;
      let by = 0;
      let best = -1;
      for (const u of cur.units) {
        if (!u.alive || u.side === d.side) continue;
        const ex = u.x - dx;
        const ey = u.y - dy;
        const dd = ex * ex + ey * ey;
        if (best < 0 || dd < best) {
          best = dd;
          bx = u.x;
          by = u.y;
        }
      }
      if (best >= 0) {
        const beam = out.add('line');
        beam.id = `beam-${d.playerId}`;
        beam.x = sdx;
        beam.y = sdy;
        beam.x2 = proj.px(bx);
        beam.y2 = proj.py(by);
        beam.stroke = '--bm-cyan';
        beam.lineWidth = 2;
        beam.alpha = 0.7;
      }
    }

    const art = resolveDroneArt(d.colour);
    const c = out.add('token');
    c.id = `drone-${d.playerId}`;
    c.x = sdx;
    c.y = sdy;
    c.r = DRONE_RADIUS_PX;
    c.shape = 'drone';
    c.fill = art.colorHex;
    c.stroke = d.side === 0 ? '--bm-fortress' : '--bm-onslaught';
  }

  // --- Speed Up Protocol announcement ---
  if (cur.speedUpActive) {
    const b = out.add('banner');
    b.id = 'speedup';
    b.x = layout.width / 2;
    b.y = 100;
    b.text = S.SPEED_UP_PROTOCOL;
    b.font = FONT_BANNER;
    b.align = 'center';
    b.baseline = 'middle';
    b.fill = '--bm-accent';
    b.stroke = '--bm-onslaught';
  }

  // --- HUD text: your name top-left, opponent name top-right ---
  const nameL = out.add('text');
  nameL.id = 'player-name';
  nameL.x = 16;
  nameL.y = 24;
  nameL.text = hud.playerName;
  nameL.font = FONT_HUD;
  nameL.align = 'left';
  nameL.baseline = 'middle';
  nameL.fill = '--bm-ink';

  const nameR = out.add('text');
  nameR.id = 'opponent-name';
  nameR.x = layout.width - 16;
  nameR.y = 24;
  nameR.text = hud.opponentName;
  nameR.font = FONT_HUD;
  nameR.align = 'right';
  nameR.baseline = 'middle';
  nameR.fill = '--bm-ink';

  // --- kill feed, top-right, newest first ---
  for (let i = 0; i < hud.killFeed.length; i += 1) {
    const row = hud.killFeed[i]!;
    const c = out.add('killRow');
    c.id = `kill-${row.seq}`;
    c.x = layout.width - 16;
    c.y = 44 + i * 20;
    c.killer = row.killerLabel;
    c.weapon = row.weaponLabel;
    c.victim = row.victimLabel;
    c.killerColor = row.killerColorVar;
    c.victimColor = row.victimColorVar;
    c.alpha = row.opacity;
    c.font = FONT_SMALL;
    c.align = 'right';
  }

  // --- ability buttons, bottom-right: LSHIFT (damage) / E (heal) ---
  const btnDamage = out.add('hudButton');
  btnDamage.id = 'ability-damage';
  btnDamage.x = layout.width - 150;
  btnDamage.y = layout.height - 96;
  btnDamage.w = 134;
  btnDamage.h = 30;
  btnDamage.key = S.KEY_LSHIFT;
  btnDamage.label = S.DRONE_ABILITY_ONE_TIME_DAMAGE;
  btnDamage.disabled = hud.oneTimeDamageSpent;
  btnDamage.fill = '--bm-onslaught';

  const btnHeal = out.add('hudButton');
  btnHeal.id = 'ability-heal';
  btnHeal.x = layout.width - 150;
  btnHeal.y = layout.height - 60;
  btnHeal.w = 134;
  btnHeal.h = 30;
  btnHeal.key = S.KEY_E;
  btnHeal.label = S.DRONE_ABILITY_ONE_TIME_HEALING;
  btnHeal.disabled = hud.oneTimeHealSpent;
  btnHeal.fill = '--bm-reboot';

  // --- Encephalo-Ray infinite-ammo readout, bottom-left ---
  const ammo = out.add('text');
  ammo.id = 'beam-ammo';
  ammo.x = 16;
  ammo.y = layout.height - 60;
  ammo.text = `${S.DRONE_ABILITY_ENCEPHALO_RAY} ${S.INFINITE_AMMO}`;
  ammo.font = FONT_SMALL;
  ammo.align = 'left';
  ammo.baseline = 'middle';
  ammo.fill = '--bm-ink-dim';

  // --- centred hint under the health bar ---
  const hint = out.add('text');
  hint.id = 'hint';
  hint.x = layout.width / 2;
  hint.y = layout.height - 14;
  hint.text = S.battleHint();
  hint.font = FONT_SMALL;
  hint.align = 'center';
  hint.baseline = 'middle';
  hint.fill = '--bm-ink-dim';

  // --- LALT cursor-mode indicator ---
  const cursor = out.add('text');
  cursor.id = 'cursor-mode';
  cursor.x = 16;
  cursor.y = layout.height - 32;
  cursor.text = hud.droneControl ? S.CURSOR_MODE_OFF : S.CURSOR_MODE_ON;
  cursor.font = FONT_SMALL;
  cursor.align = 'left';
  cursor.baseline = 'middle';
  cursor.fill = hud.droneControl ? '--bm-ink-faint' : '--bm-accent';

  return out;
}

/** Find a command by its `id` — for tests and for canvas click hit-testing. */
export function findCmd(list: CmdList, id: string): DrawCmd | undefined {
  for (const c of list) if (c.id === id) return c;
  return undefined;
}
