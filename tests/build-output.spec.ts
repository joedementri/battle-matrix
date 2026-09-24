import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/*
 * Guards the GitHub Pages build output:
 *  - every asset reference in dist/index.html is served from '/battle-matrix/',
 *    never a bare '/assets/' (M0);
 *  - the whole emitted bundle is under the plan's <500 KB gzipped budget (M11
 *    gate 4) — asserted AND reported, using node:zlib over every file in dist/.
 *
 * Skips (rather than fails) when dist/ has not been built yet, so a fresh
 * `npm test` stays green before the first `npm run build`.
 */

const distDir = join(process.cwd(), 'dist');
const distIndex = join(distDir, 'index.html');
const distBuilt = existsSync(distIndex);

if (!distBuilt) {
  console.warn(
    '[build-output.spec] dist/ not found — skipping base-path + bundle-size assertions. Run `npm run build` first.',
  );
}

describe.skipIf(!distBuilt)('build output base path', () => {
  const html = distBuilt ? readFileSync(distIndex, 'utf8') : '';

  it('never emits a bare /assets/ path', () => {
    const withoutBase = html.split('/battle-matrix/').join('|BASE|');
    expect(withoutBase, 'found an /assets/ path outside the /battle-matrix/ base').not.toMatch(
      /\/assets\//,
    );
  });

  it('prefixes every root-absolute href/src with /battle-matrix/', () => {
    const rootAbsoluteRefs = [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)]
      .map((match) => match[1] ?? '')
      .filter((value) => value.startsWith('/'));

    expect(rootAbsoluteRefs.length, 'expected at least one bundled asset reference').toBeGreaterThan(
      0,
    );
    for (const ref of rootAbsoluteRefs) {
      expect(ref).toMatch(/^\/battle-matrix\//);
    }
  });
});

/** Every file under `dir`, recursively, as absolute paths. */
function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...filesIn(p));
    else out.push(p);
  }
  return out;
}

describe.skipIf(!distBuilt)('bundle size (M11 gate 4 — < 500 KB gzipped)', () => {
  const BUDGET_BYTES = 500 * 1024;

  it('the whole gzipped bundle is under 500 KB — and reports the actual number', () => {
    const files = filesIn(distDir);
    const per = files
      .map((f) => {
        const raw = readFileSync(f);
        return {
          file: f.slice(distDir.length + 1).replace(/\\/g, '/'),
          raw: raw.byteLength,
          gz: gzipSync(raw, { level: 9 }).byteLength,
        };
      })
      .sort((a, b) => b.gz - a.gz);

    const totalGz = per.reduce((n, e) => n + e.gz, 0);
    const totalRaw = per.reduce((n, e) => n + e.raw, 0);

    console.table(
      per.map((e) => ({ file: e.file, 'raw B': e.raw, 'gz B': e.gz })),
    );
    console.log(
      `[bundle] ${per.length} files · raw ${(totalRaw / 1024).toFixed(2)} kB · ` +
        `gzipped ${(totalGz / 1024).toFixed(2)} kB / ${BUDGET_BYTES / 1024} kB budget ` +
        `(${((100 * totalGz) / BUDGET_BYTES).toFixed(1)} % of budget)`,
    );

    expect(totalGz, `gzipped bundle ${(totalGz / 1024).toFixed(1)} kB exceeds the 500 KB budget`).toBeLessThan(
      BUDGET_BYTES,
    );
  });

  it('package.json declares zero runtime dependencies (M0 invariant, re-checked here)', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
