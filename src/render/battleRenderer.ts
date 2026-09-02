/*
 * The battle renderer orchestrator: owns the <canvas>, the wall clock, the
 * fixed-timestep loop, the stepped `BattleController`, the kill feed, the
 * floating damage numbers, and live drone-input capture.
 *
 * THE LOOP (plan, M9): the sim advances at exactly 30 Hz integer ticks; this
 * renderer interpolates. `FixedLoop` owns the accumulator, the frame-delta
 * clamp and the spiral-of-death drop. The renderer keeps the previous tick's
 * snapshot and renders at `alpha` between it and the current one. Nothing the
 * renderer computes is ever handed back to the sim — interpolation and input
 * capture are strictly one-directional.
 *
 * LIVE INPUT -> M6's QUANTIZED STREAM: real key/pointer state is latched by the
 * host and read HERE once per sim tick (never per frame — a 144 fps frame loop
 * would otherwise write more input records than there are ticks). It is
 * quantized at capture via `encodeDroneMove`, so a recorded match replays
 * byte-identically. The growing stream is also handed back to `match.ts` as a
 * `driveDrone` action so the sim-of-record replays exactly what was flown.
 */

import { TICK_RATE_HZ } from '../data/constants';
import { encodeDroneMove } from '../sim/drone';
import type { DroneInputStream, DroneMove } from '../sim/drone';
import { BattleController } from '../sim/combat';
import type { BattleFrameState } from '../sim/combat';
import type { CombatContext } from '../sim/types';

import { getArena } from './arena';
import type { ArenaCache } from './arena';
import { buildBattleFrame, CmdList, findCmd } from './frame';
import type { BattleHudView, Layout } from './frame';
import { Executor } from './executor';
import { FixedLoop } from './loop';
import { KillFeed } from './killFeed';
import { DamageNumbers } from './damageNumbers';
import { deepFreeze } from './readonly';
import type { DeepReadonly } from './readonly';

/** What the host latches from real key/pointer state; read once per sim tick. */
export interface RawDroneInput {
  /** Desired move direction, roughly unit length; `{0,0}` = hold. */
  readonly dirX: number;
  readonly dirY: number;
  /** Encephalo-Ray held (LMB). */
  readonly beam: boolean;
  /** LSHIFT down — One-Time Damage. Level-triggered; the first tick it is down is recorded. */
  readonly pressDamage: boolean;
  /** E down — One-Time Healing. */
  readonly pressHeal: boolean;
  /** false while LALT cursor-mode is active (pointer freed for UI). */
  readonly droneControl: boolean;
}

export interface MutableDroneInputStream {
  moves: DroneMove[];
  oneTimeDamageTick: number | null;
  oneTimeHealTick: number | null;
  beamHeldRanges: [number, number][];
}

export interface BattleRendererOptions {
  readonly ctx: CombatContext;
  readonly humanPlayerId: number;
  readonly playerName: string;
  readonly opponentName: string;
  /** Latch of the current raw input; called once per sim tick. */
  readonly sampleInput: () => RawDroneInput;
  /** Called once, when the battle resolves (elimination or tie cap). */
  readonly onEnded?: (trace: NonNullable<BattleController['trace']>) => void;
  readonly reducedMotion?: boolean;
  /** Test seam: drive ticks manually instead of via requestAnimationFrame. */
  readonly manualClock?: boolean;
}

export interface FrameStats {
  readonly frames: number;
  readonly avgBuildMs: number;
  readonly avgDrawMs: number;
  readonly avgFrameMs: number;
  readonly worstFrameMs: number;
  readonly ticks: number;
}

export class BattleRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly opts: BattleRendererOptions;
  private readonly controller: BattleController;
  private readonly loop: FixedLoop;
  private readonly killFeed = new KillFeed();
  private readonly dmg = new DamageNumbers();
  private readonly cmdBuffer = new CmdList();
  private executor: Executor | null = null;
  private arena: ArenaCache | null = null;

  private readonly liveStream: MutableDroneInputStream = {
    moves: [],
    oneTimeDamageTick: null,
    oneTimeHealTick: null,
    beamHeldRanges: [],
  };

  private prevSnap: DeepReadonly<BattleFrameState>;
  private curSnap: DeepReadonly<BattleFrameState>;
  private droneControl = true;
  private layout: Layout = { width: 960, height: 540, dpr: 1 };

  private rafId = 0;
  private lastMs = 0;
  private running = false;
  private ended = false;

  // perf counters
  private frames = 0;
  private sumBuild = 0;
  private sumDraw = 0;
  private sumFrame = 0;
  private worstFrame = 0;

  constructor(host: HTMLElement, options: BattleRendererOptions) {
    this.host = host;
    this.opts = options;

    const drones = options.ctx.drones ?? [];
    const withLive = drones.map((d) =>
      d.playerId === options.humanPlayerId
        ? { ...d, input: this.liveStream as unknown as DroneInputStream }
        : d,
    );
    this.controller = new BattleController(options.ctx, { trace: true, drones: withLive });

    this.loop = new FixedLoop(() => this.tick(), { tickHz: TICK_RATE_HZ });

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bm-arena';
    host.appendChild(this.canvas);

    this.prevSnap = deepFreezeSample(this.controller.sample());
    this.curSnap = this.prevSnap;
  }

  /** The <canvas> element, so the host can attach pointer/click listeners. */
  get element(): HTMLCanvasElement {
    return this.canvas;
  }

  /** The growing recorded stream — handed to `match.ts` as a `driveDrone` action when the phase ends. */
  get recordedInput(): DroneInputStream {
    return {
      moves: this.liveStream.moves.slice(),
      oneTimeDamageTick: this.liveStream.oneTimeDamageTick,
      oneTimeHealTick: this.liveStream.oneTimeHealTick,
      beamHeldRanges: this.liveStream.beamHeldRanges.map((r) => [r[0], r[1]] as const),
    };
  }

  get done(): boolean {
    return this.controller.done;
  }

  get controllerRef(): BattleController {
    return this.controller;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    if (this.opts.manualClock === true) return;
    this.lastMs = now();
    const frame = (): void => {
      if (!this.running) return;
      const t = now();
      this.advance(t - this.lastMs);
      this.lastMs = t;
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  dispose(): void {
    this.stop();
    if (this.canvas.parentNode === this.host) this.host.removeChild(this.canvas);
  }

  /** One real frame: advance the loop by `frameDeltaMs`, then draw once. Public for tests. */
  advance(frameDeltaMs: number): void {
    const fStart = now();
    this.loop.advance(frameDeltaMs);
    const bStart = now();
    const list = this.buildFrame(this.loop.alpha);
    const bEnd = now();
    this.draw(list);
    const fEnd = now();

    this.frames += 1;
    this.sumBuild += bEnd - bStart;
    this.sumDraw += fEnd - bEnd;
    const frameMs = fEnd - fStart;
    this.sumFrame += frameMs;
    if (frameMs > this.worstFrame) this.worstFrame = frameMs;

    if (this.controller.done && !this.ended) {
      this.ended = true;
      const trace = this.controller.trace;
      if (trace !== null) this.opts.onEnded?.(trace);
    }
  }

  /** Build the current frame's command list (public for tests). */
  buildFrame(alpha: number): CmdList {
    return buildBattleFrame(this.view(alpha), this.layout, this.cmdBuffer);
  }

  view(alpha: number): { cur: DeepReadonly<BattleFrameState>; prev: DeepReadonly<BattleFrameState>; alpha: number; hud: BattleHudView } {
    return { cur: this.curSnap, prev: this.prevSnap, alpha, hud: this.hud() };
  }

  hud(): BattleHudView {
    const drone = this.curSnap.drones.find((d) => d.playerId === this.opts.humanPlayerId);
    return {
      playerName: this.opts.playerName,
      opponentName: this.opts.opponentName,
      oneTimeDamageSpent: drone?.oneTimeDamageUsed ?? false,
      oneTimeHealSpent: drone?.oneTimeHealUsed ?? false,
      killFeed: this.killFeed.rows(this.controller.tick, this.opts.reducedMotion === true),
      damageNumbers: this.dmg.active(this.controller.tick),
      droneControl: this.droneControl,
    };
  }

  /** Resize/dpr-change handler — call on ResizeObserver / matchMedia change. */
  resize(): void {
    const rect = this.host.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || this.host.clientWidth || 960));
    const cssH = Math.max(1, Math.round(rect.height || this.host.clientHeight || 540));
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.layout = {
      width: cssW,
      height: cssH,
      dpr,
      targetLines: true,
      reducedMotion: this.opts.reducedMotion === true,
    };
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.arena = getArena(this.layout, this.curSnap.bounds, this.arena);
  }

  stats(): FrameStats {
    const n = this.frames || 1;
    return {
      frames: this.frames,
      avgBuildMs: this.sumBuild / n,
      avgDrawMs: this.sumDraw / n,
      avgFrameMs: this.sumFrame / n,
      worstFrameMs: this.worstFrame,
      ticks: this.loop.ticksRun,
    };
  }

  /** Canvas click → the id of the hit HUD button, or null. */
  hitTest(cssX: number, cssY: number): string | null {
    for (const c of this.cmdBuffer) {
      if (c.k !== 'hudButton') continue;
      if (cssX >= c.x && cssX <= c.x + c.w && cssY >= c.y && cssY <= c.y + c.h) return c.id;
    }
    return null;
  }

  findCommand(id: string): ReturnType<typeof findCmd> {
    return findCmd(this.cmdBuffer, id);
  }

  // -------------------------------------------------------------------------

  /** One 30 Hz sim tick — driven by the fixed-timestep loop, never per frame. */
  private tick(): void {
    if (this.controller.done) return;
    this.captureInput(this.controller.tick + 1);
    this.prevSnap = this.curSnap;
    this.controller.step();
    this.curSnap = deepFreezeSample(this.controller.sample());
    this.killFeed.consume(this.controller.kills, this.controller.tick);
    this.dmg.consume(this.controller.damageLog, this.curSnap, this.controller.tick);
  }

  /** Latch raw input and fold it into the quantized stream for `forTick` (1-based). */
  private captureInput(forTick: number): void {
    const raw = this.opts.sampleInput();
    this.droneControl = raw.droneControl;

    const move = raw.droneControl ? encodeDroneMove(raw.dirX, raw.dirY) : encodeDroneMove(0, 0);
    this.liveStream.moves[forTick - 1] = move;

    if (raw.pressDamage && this.liveStream.oneTimeDamageTick === null) {
      this.liveStream.oneTimeDamageTick = forTick;
    }
    if (raw.pressHeal && this.liveStream.oneTimeHealTick === null) {
      this.liveStream.oneTimeHealTick = forTick;
    }

    if (raw.beam) {
      const ranges = this.liveStream.beamHeldRanges;
      const last = ranges[ranges.length - 1];
      if (last !== undefined && last[1] === forTick - 1) last[1] = forTick;
      else ranges.push([forTick, forTick]);
    }
  }

  private draw(list: CmdList): void {
    const ctx2d = this.canvas.getContext('2d');
    if (ctx2d === null) return; // jsdom/happy-dom — frame builder still ran and is testable
    if (this.executor === null) this.executor = new Executor(ctx2d);
    if (this.arena === null) this.arena = getArena(this.layout, this.curSnap.bounds, this.arena);
    this.executor.render(list, {
      dpr: this.layout.dpr,
      width: this.layout.width,
      height: this.layout.height,
      arenaImage: this.arena?.canvas ?? null,
      reducedMotion: this.opts.reducedMotion === true,
    });
  }
}

function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function deepFreezeSample(s: BattleFrameState): DeepReadonly<BattleFrameState> {
  // The frame builder is typed against DeepReadonly; freezing makes an accidental
  // write throw loudly at runtime too. Cheap: ~12 small objects per tick.
  return deepFreeze(s);
}
