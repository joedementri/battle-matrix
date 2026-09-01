import { describe, expect, it } from 'vitest';

import {
  RngStream,
  Substream,
  cyrb128,
  deriveSeed,
  hash128Hex,
  mulberry32Step,
} from '../src/sim/rng';

/*
 * M2 RNG contract:
 *   - identical seed  => identical sequence
 *   - substream isolation: a new substream never perturbs an existing one, and
 *     each substream's seed is a pure hash of (masterSeed, key) — NOT drawn from
 *     a parent sequence (the property M7 leans on)
 *   - round-scoping keeps a heavy round from bleeding into the next
 *   - setState(getState()) round-trips at both levels
 *   - shuffle: deterministic per seed, non-mutating, every permutation reachable
 *   - int(): inclusive bounds, unbiased enough (chi-square over 100k draws)
 */

const drawU32 = (sub: Substream, n: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(sub.nextU32());
  return out;
};

describe('mulberry32Step', () => {
  it('is a pure function of state', () => {
    expect(mulberry32Step(0)).toEqual(mulberry32Step(0));
    expect(mulberry32Step(123456789)).toEqual(mulberry32Step(123456789));
  });

  it('returns a uint32 output and a uint32 next-state', () => {
    let state = 42;
    for (let i = 0; i < 1000; i++) {
      const [next, out] = mulberry32Step(state);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(0xffffffff);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(0xffffffff);
      state = next;
    }
  });
});

describe('cyrb128 / deriveSeed / hash128Hex', () => {
  it('cyrb128 is deterministic and well-spread', () => {
    expect(cyrb128('abc')).toEqual(cyrb128('abc'));
    expect(cyrb128('abc')).not.toEqual(cyrb128('abd'));
    for (const w of cyrb128('the quick brown fox')) {
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('deriveSeed depends on BOTH master seed and key, and never collides trivially', () => {
    const seen = new Set<number>();
    for (let master = 0; master < 50; master++) {
      for (const key of ['shop#1', 'shop#2', 'ai:1#1', 'ai:2#1', 'pairing#3', 'human']) {
        seen.add(deriveSeed(master, key));
      }
    }
    // 300 (master,key) pairs -> essentially all distinct 32-bit seeds.
    expect(seen.size).toBeGreaterThan(295);
    expect(deriveSeed(7, 'shop#1')).toBe(deriveSeed(7, 'shop#1'));
    expect(deriveSeed(7, 'shop#1')).not.toBe(deriveSeed(8, 'shop#1'));
    expect(deriveSeed(7, 'shop#1')).not.toBe(deriveSeed(7, 'shop#2'));
  });

  it('hash128Hex is 32 lowercase hex chars, collision-resistant across many strings', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 20000; i++) hashes.add(hash128Hex(`state-${i}`));
    expect(hashes.size).toBe(20000);
    expect(hash128Hex('x')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('RngStream — determinism', () => {
  it('identical seed => identical sequence for the same substream', () => {
    const a = new RngStream(0xdecafbad);
    const b = new RngStream(0xdecafbad);
    expect(drawU32(a.stream('shop', 4), 64)).toEqual(drawU32(b.stream('shop', 4), 64));
  });

  it('different seeds => different sequences', () => {
    const a = drawU32(new RngStream(1).stream('shop', 4), 32);
    const b = drawU32(new RngStream(2).stream('shop', 4), 32);
    expect(a).not.toEqual(b);
  });

  it('the same key returns the same live substream object', () => {
    const rng = new RngStream(99);
    expect(rng.stream('ai:3', 2)).toBe(rng.stream('ai:3', 2));
    expect(rng.stream('ai:3', 2)).not.toBe(rng.stream('ai:3', 3));
  });
});

describe('RngStream — substream isolation (the M7 add-a-consumer invariant)', () => {
  it('a new / heavier substream never shifts an existing one', () => {
    for (const seed of [1, 42, 7777, 0xabcdef]) {
      const base = new RngStream(seed);
      const shopRef = drawU32(base.stream('shop', 5), 40);
      const humanRef = drawU32(base.stream('human', 5), 40);
      const aiRef = drawU32(base.stream('ai:2', 5), 40);

      const perturbed = new RngStream(seed);
      // A whole extra bot draws heavily, interleaved, on several rounds.
      drawU32(perturbed.stream('ai:5', 5), 500);
      const shopAfter = drawU32(perturbed.stream('shop', 5), 40);
      drawU32(perturbed.stream('ai:5', 6), 300);
      const aiAfter = drawU32(perturbed.stream('ai:2', 5), 40);
      drawU32(perturbed.stream('ai:5', 7), 200);
      const humanAfter = drawU32(perturbed.stream('human', 5), 40);

      expect(shopAfter).toEqual(shopRef);
      expect(humanAfter).toEqual(humanRef);
      expect(aiAfter).toEqual(aiRef);
    }
  });

  it('round-scoping: a heavy round does not bleed into the next', () => {
    const a = new RngStream(555);
    const shopRound2Ref = drawU32(a.stream('shop', 2), 32);

    const b = new RngStream(555);
    drawU32(b.stream('shop', 1), 999); // round 1 drew a lot
    const shopRound2After = drawU32(b.stream('shop', 2), 32);

    expect(shopRound2After).toEqual(shopRound2Ref);
    // ...and round 1 vs round 2 are independent streams
    expect(drawU32(new RngStream(555).stream('shop', 1), 32)).not.toEqual(shopRound2Ref);
  });
});

describe('RngStream — snapshot / replay', () => {
  it('Substream.setState(getState()) round-trips', () => {
    const sub = new RngStream(7).stream('x', 1);
    drawU32(sub, 10);
    const saved = sub.getState();
    const seq1 = drawU32(sub, 25);
    sub.setState(saved);
    const seq2 = drawU32(sub, 25);
    expect(seq2).toEqual(seq1);
  });

  it('RngStream.setState(getState()) round-trips across all touched substreams', () => {
    const rng = new RngStream(0x1234);
    drawU32(rng.stream('shop', 1), 12);
    drawU32(rng.stream('ai:1', 1), 7);
    drawU32(rng.stream('pairing', 1), 3);

    const snap = rng.getState();
    const seq1 = [
      ...drawU32(rng.stream('shop', 1), 10),
      ...drawU32(rng.stream('ai:1', 1), 10),
      ...drawU32(rng.stream('pairing', 1), 10),
    ];

    rng.setState(snap);
    const seq2 = [
      ...drawU32(rng.stream('shop', 1), 10),
      ...drawU32(rng.stream('ai:1', 1), 10),
      ...drawU32(rng.stream('pairing', 1), 10),
    ];
    expect(seq2).toEqual(seq1);
  });

  it('the snapshot is plain JSON with sorted keys', () => {
    const rng = new RngStream(3);
    drawU32(rng.stream('shop', 2), 1);
    drawU32(rng.stream('ai:1', 1), 1);
    drawU32(rng.stream('pairing', 1), 1);
    const snap = rng.getState();

    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    const keys = Object.keys(snap.substreams);
    expect(keys).toEqual([...keys].sort());

    // A fresh stream + setState reproduces the sequence.
    const restored = new RngStream(snap.masterSeed);
    restored.setState(snap);
    expect(restored.stream('shop', 2).nextU32()).toBe(rng.stream('shop', 2).nextU32());
  });
});

describe('Substream.shuffle', () => {
  it('never mutates the caller array and returns a permutation', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const frozen = [...src];
    const out = new RngStream(1).stream('s').shuffle(src);
    expect(src).toEqual(frozen);
    expect([...out].sort((a, b) => a - b)).toEqual(frozen);
  });

  it('is deterministic per seed', () => {
    const a = new RngStream(42).stream('s', 1).shuffle([0, 1, 2, 3, 4, 5, 6]);
    const b = new RngStream(42).stream('s', 1).shuffle([0, 1, 2, 3, 4, 5, 6]);
    expect(a).toEqual(b);
  });

  it('every permutation of a 4-element array is reachable across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 20000; seed++) {
      seen.add(new RngStream(seed).stream('s').shuffle([0, 1, 2, 3]).join(''));
    }
    expect(seen.size).toBe(24);
  });
});

describe('Substream.int', () => {
  it('bounds are inclusive on both ends', () => {
    const sub = new RngStream(2024).stream('s', 1);
    const histogram = new Map<number, number>();
    for (let i = 0; i < 40000; i++) {
      const v = sub.int(3, 7);
      histogram.set(v, (histogram.get(v) ?? 0) + 1);
    }
    // Only 3..7, all five present, nothing outside.
    expect([...histogram.keys()].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7]);
    for (const [k, count] of histogram) {
      expect(Number.isInteger(k)).toBe(true);
      expect(count).toBeGreaterThan(0);
    }
  });

  it('single-value range returns the value without consuming entropy oddly', () => {
    const sub = new RngStream(1).stream('s');
    expect(sub.int(5, 5)).toBe(5);
  });

  it('rejects an inverted or non-integer range', () => {
    const sub = new RngStream(1).stream('s');
    expect(() => sub.int(7, 3)).toThrow(RangeError);
    expect(() => sub.int(0.5, 3)).toThrow(RangeError);
  });

  it('is unbiased enough — chi-square over 100k draws into 6 bins', () => {
    const bins = 6;
    const draws = 100_000;
    const counts = new Array<number>(bins).fill(0);
    const sub = new RngStream(0xc0ffee).stream('s', 1);
    for (let i = 0; i < draws; i++) counts[sub.int(0, bins - 1)]!++;

    const expected = draws / bins;
    const chiSq = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    // df = 5; the p=0.001 critical value is ~20.5. 30 is a comfortable ceiling
    // for a known-good PRNG and a fixed seed.
    expect(chiSq).toBeLessThan(30);
    for (const c of counts) {
      expect(Math.abs(c - expected) / expected).toBeLessThan(0.05);
    }
  });
});

describe('Substream.pick / weighted', () => {
  it('pick throws on an empty array and is in-range otherwise', () => {
    const sub = new RngStream(1).stream('s');
    expect(() => sub.pick([])).toThrow(RangeError);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 1000; i++) expect(arr).toContain(sub.pick(arr));
  });

  it('weighted respects the ratios and is deterministic', () => {
    const entries = [
      { value: 'a', weight: 1 },
      { value: 'b', weight: 3 },
    ];
    const sub = new RngStream(9).stream('s', 1);
    let b = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (sub.weighted(entries) === 'b') b++;
    expect(b / n).toBeGreaterThan(0.72);
    expect(b / n).toBeLessThan(0.78);

    const s1 = new RngStream(3).stream('s', 1);
    const s2 = new RngStream(3).stream('s', 1);
    const seq1 = Array.from({ length: 50 }, () => s1.weighted(entries));
    const seq2 = Array.from({ length: 50 }, () => s2.weighted(entries));
    expect(seq1).toEqual(seq2);
  });

  it('weighted supports fractional weights (rarity-odds shaped) and rejects all-zero', () => {
    const sub = new RngStream(1).stream('s');
    const entries = [
      { value: 'common', weight: 86.5 },
      { value: 'rare', weight: 12.0 },
      { value: 'legendary', weight: 1.5 },
    ];
    const counts: Record<string, number> = { common: 0, rare: 0, legendary: 0 };
    const n = 200000;
    for (let i = 0; i < n; i++) counts[sub.weighted(entries)]!++;
    expect(counts.common! / n).toBeCloseTo(0.865, 1);
    expect(counts.rare! / n).toBeCloseTo(0.12, 1);
    expect(counts.legendary! / n).toBeGreaterThan(0.01);

    expect(() => sub.weighted([{ value: 'x', weight: 0 }])).toThrow(RangeError);
    expect(() => sub.weighted([])).toThrow(RangeError);
  });
});
