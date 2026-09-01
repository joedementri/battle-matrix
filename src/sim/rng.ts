/*
 * Deterministic RNG for the pure simulation layer.
 *
 * `RngStream` is the match-wide generator. It never draws values from a shared
 * parent sequence: every named substream's seed is a pure hash of
 * `(masterSeed, key)` via a local cyrb128. That is the property M7 leans on —
 * adding a sixth consumer (a fifth bot, say) cannot shift the shop's or the
 * player's rolls by a single value, because those substreams' seeds do not
 * depend on how many other substreams exist or how much they drew.
 *
 * Substreams are also scoped by round (`stream('shop', round)`), so a round in
 * which one consumer happens to draw more values cannot contaminate the next.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no imports from
 * `ui/` or `render/`. mulberry32 core + cyrb128 seed derivation, both local.
 */

// ---------------------------------------------------------------------------
// mulberry32 core
// ---------------------------------------------------------------------------

/**
 * One mulberry32 step. State is a single uint32 (`a` in the canonical form).
 * Returns `[nextState, u32Output]`. Kept as a free function so snapshot/replay
 * is just "store the uint32, restore the uint32".
 */
export function mulberry32Step(state: number): readonly [number, number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const out = (t ^ (t >>> 14)) >>> 0;
  return [a >>> 0, out];
}

// ---------------------------------------------------------------------------
// cyrb128 — seed derivation and the non-crypto state hash
// ---------------------------------------------------------------------------

/** cyrb128 string hash → four well-mixed uint32 words. Local, no dependencies. */
export function cyrb128(str: string): readonly [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 = (h1 ^ h2 ^ h3 ^ h4) >>> 0;
  return [h1, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** 128-bit non-crypto digest of a string, as 32 lowercase hex chars. */
export function hash128Hex(str: string): string {
  const words = cyrb128(str);
  let out = '';
  for (const w of words) out += (w >>> 0).toString(16).padStart(8, '0');
  return out;
}

/**
 * Derive a substream's 32-bit mulberry32 seed from `(masterSeed, key)`. Pure —
 * never consumes the parent. Two different keys land on unrelated seeds; the
 * same `(masterSeed, key)` always lands on the same seed.
 */
export function deriveSeed(masterSeed: number, key: string): number {
  return cyrb128(`${masterSeed >>> 0}::${key}`)[0] >>> 0;
}

// ---------------------------------------------------------------------------
// Weighted-pick entry
// ---------------------------------------------------------------------------

export interface WeightedEntry<T> {
  readonly value: T;
  /** Finite, `>= 0`. At least one entry in a call must be `> 0`. */
  readonly weight: number;
}

// ---------------------------------------------------------------------------
// Substream
// ---------------------------------------------------------------------------

const U32 = 0x1_0000_0000;

/**
 * A single independent generator. Obtained from `RngStream.stream(name, round)`;
 * never constructed directly by sim code. State is one uint32.
 */
export class Substream {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /** Raw uint32 in `[0, 2^32)`. */
  nextU32(): number {
    const [next, out] = mulberry32Step(this.#state);
    this.#state = next;
    return out;
  }

  /** Float in `[0, 1)` with 32 bits of entropy. */
  next(): number {
    return this.nextU32() / U32;
  }

  /** Integer in `[minInclusive, maxInclusive]`, unbiased (rejection sampling). */
  int(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new RangeError('Substream.int(): bounds must be integers');
    }
    if (maxInclusive < minInclusive) {
      throw new RangeError(`Substream.int(): max ${maxInclusive} < min ${minInclusive}`);
    }
    const range = maxInclusive - minInclusive + 1;
    if (range === 1) return minInclusive;
    const limit = U32 - (U32 % range);
    let u = this.nextU32();
    while (u >= limit) u = this.nextU32();
    return minInclusive + (u % range);
  }

  /** Uniform element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError('Substream.pick(): empty array');
    return arr[this.int(0, arr.length - 1)] as T;
  }

  /**
   * Fisher–Yates shuffle on a **copy**. The caller's array is never touched.
   * Deterministic per substream state; every permutation is reachable.
   */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Weighted pick. Supports fractional weights (e.g. rarity odds like 86.5). */
  weighted<T>(entries: readonly WeightedEntry<T>[]): T {
    if (entries.length === 0) throw new RangeError('Substream.weighted(): no entries');
    let total = 0;
    for (const e of entries) {
      if (!Number.isFinite(e.weight) || e.weight < 0) {
        throw new RangeError('Substream.weighted(): weights must be finite and >= 0');
      }
      total += e.weight;
    }
    if (total <= 0) throw new RangeError('Substream.weighted(): total weight must be > 0');
    let r = this.next() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r < 0) return e.value;
    }
    return entries[entries.length - 1]!.value; // float-slop guard
  }

  /** Snapshot this substream's cursor (a uint32). */
  getState(): number {
    return this.#state;
  }

  /** Restore a cursor previously returned by `getState()`. */
  setState(state: number): void {
    this.#state = state >>> 0;
  }
}

// ---------------------------------------------------------------------------
// RngStream
// ---------------------------------------------------------------------------

/** Plain, JSON-serializable snapshot of an entire `RngStream`. */
export interface RngSnapshot {
  readonly masterSeed: number;
  /** substream key -> mulberry32 cursor (uint32). Keys are emitted sorted. */
  readonly substreams: Readonly<Record<string, number>>;
}

/**
 * The match-wide generator. `stream(name, round?)` returns a lazily-created,
 * independently-seeded `Substream`; the same key always returns the same live
 * object within one `RngStream`.
 */
export class RngStream {
  readonly #masterSeed: number;
  readonly #streams = new Map<string, Substream>();

  constructor(masterSeed: number) {
    this.#masterSeed = masterSeed >>> 0;
  }

  get masterSeed(): number {
    return this.#masterSeed;
  }

  /**
   * Named substream, optionally scoped to a round. The key is `name` or
   * `name#round`; its seed is `deriveSeed(masterSeed, key)` — never drawn from
   * a parent sequence.
   */
  stream(name: string, round?: number): Substream {
    const key = round === undefined ? name : `${name}#${round}`;
    let sub = this.#streams.get(key);
    if (sub === undefined) {
      sub = new Substream(deriveSeed(this.#masterSeed, key));
      this.#streams.set(key, sub);
    }
    return sub;
  }

  /** Snapshot every touched substream. Keys are sorted for canonical output. */
  getState(): RngSnapshot {
    const substreams: Record<string, number> = {};
    for (const key of [...this.#streams.keys()].sort()) {
      substreams[key] = this.#streams.get(key)!.getState();
    }
    return { masterSeed: this.#masterSeed, substreams };
  }

  /**
   * Restore from a snapshot. Only the substreams present in the snapshot are
   * seeded to the stored cursor; any not listed will be re-derived from the key
   * on next `stream()` (their cursor was at the derived-seed start anyway).
   */
  setState(snapshot: RngSnapshot): void {
    this.#streams.clear();
    for (const [key, state] of Object.entries(snapshot.substreams)) {
      const sub = new Substream(0);
      sub.setState(state);
      this.#streams.set(key, sub);
    }
  }
}
