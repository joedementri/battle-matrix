/*
 * The fixed-timestep loop. The sim runs at exactly 30 Hz integer ticks
 * regardless of frame rate; the renderer interpolates between the previous and
 * current tick by `alpha = accumulator / dt`.
 *
 * Three failure modes handled explicitly (plan, M9):
 *  1. CLAMP the frame delta. A tab switch / breakpoint / slow first frame hands
 *     `advance()` a huge delta. It is clamped to `maxFrameMs` before it enters
 *     the accumulator, and if the accumulator STILL holds more than
 *     `maxCatchUpTicks` worth of work after stepping that many times, the excess
 *     simulated time is DROPPED (`accumulator %= dt`) rather than chased — the
 *     classic spiral of death.
 *  2. The caller keeps the previous tick's snapshot for interpolation; this loop
 *     only decides HOW MANY ticks to run and exposes `alpha`.
 *  3. Nothing here feeds back into the sim. `step` is the only sim contact and
 *     it takes no argument from the loop.
 *
 * The tick count returned by `advance()` over a given elapsed time is a function
 * of that elapsed time ALONE — never of how it was chunked into frames — until a
 * clamp or drop fires. `tests/render.spec.ts` drives the same elapsed time as
 * 30 / 60 / 144 fps deltas and asserts identical total tick counts.
 */

export interface FixedLoopOptions {
  /** Simulated seconds per tick. Defaults to 1/30 (the sim's 30 Hz). */
  readonly tickHz?: number;
  /**
   * Largest single frame delta (ms) allowed into the accumulator. A longer real
   * gap is treated as exactly this much simulated time. Default 250 ms.
   */
  readonly maxFrameMs?: number;
  /**
   * Most ticks `advance()` will run in one call. If the accumulator still holds
   * `>= dt` after this many steps, the remainder is dropped. Default 8.
   */
  readonly maxCatchUpTicks?: number;
}

export interface AdvanceResult {
  /** Ticks actually executed this call. */
  readonly ticks: number;
  /** True when the spiral-of-death drop fired this call (simulated time was discarded). */
  readonly dropped: boolean;
}

export class FixedLoop {
  private readonly step: () => void;
  private readonly dtMs: number;
  private readonly maxFrameMs: number;
  private readonly maxCatchUpTicks: number;
  private acc = 0;
  private totalTicks = 0;

  constructor(step: () => void, options: FixedLoopOptions = {}) {
    this.step = step;
    const hz = options.tickHz ?? 30;
    this.dtMs = 1000 / hz;
    this.maxFrameMs = options.maxFrameMs ?? 250;
    this.maxCatchUpTicks = options.maxCatchUpTicks ?? 8;
  }

  /** Interpolation factor between the previous and current tick, 0..1. */
  get alpha(): number {
    return this.acc / this.dtMs;
  }

  /** Simulated milliseconds per tick. */
  get dt(): number {
    return this.dtMs;
  }

  /** Total ticks executed across the loop's lifetime. */
  get ticksRun(): number {
    return this.totalTicks;
  }

  /**
   * Feed one real frame delta (ms). Runs whole ticks while the accumulator has
   * room, clamping the delta and dropping runaway backlog. The `step` callback
   * is invoked once per tick.
   *
   * The `>= dt - EPS` comparison absorbs floating-point drift so the tick count
   * over a given elapsed time is identical however that time was chunked into
   * frames — `4 s` is `120` ticks whether fed as 30, 60 or 144 fps deltas, even
   * though `576 × (1000/144)` does not land on `4000` exactly in IEEE-754.
   */
  advance(frameDeltaMs: number): AdvanceResult {
    const raw = frameDeltaMs < 0 ? 0 : frameDeltaMs;
    const clamped = raw > this.maxFrameMs ? this.maxFrameMs : raw;
    const clampedAway = clamped < raw; // sim time was discarded at the clamp
    this.acc += clamped;

    const eps = this.dtMs * 1e-6;
    let ticks = 0;
    while (this.acc >= this.dtMs - eps && ticks < this.maxCatchUpTicks) {
      this.step();
      this.acc -= this.dtMs;
      ticks += 1;
    }
    if (this.acc < 0) this.acc = 0; // an eps-early tick can nudge it just under 0

    let overflowed = false;
    if (this.acc >= this.dtMs - eps) {
      // Still behind after the catch-up cap — discard the surplus simulated time
      // so the next frame starts fresh instead of compounding (spiral of death).
      this.acc = 0;
      overflowed = true;
    }

    this.totalTicks += ticks;
    return { ticks, dropped: clampedAway || overflowed };
  }

  /** Discard any partial-tick accumulation (e.g. on resume from a pause). */
  reset(): void {
    this.acc = 0;
  }
}
