import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Guards the GitHub Pages base path in the built output: every asset reference in
 * dist/index.html must be served from '/battle-matrix/', never a bare '/assets/'.
 * Skips (rather than fails) when dist/ has not been built yet, so a fresh
 * `npm test` stays green before the first `npm run build`.
 */

const distIndex = join(process.cwd(), 'dist', 'index.html');
const distBuilt = existsSync(distIndex);

if (!distBuilt) {
  console.warn(
    '[build-output.spec] dist/index.html not found — skipping base-path assertions. Run `npm run build` first.',
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
