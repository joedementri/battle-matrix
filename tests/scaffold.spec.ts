import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Encodes M0's asserted invariants by reading the real project files from disk,
 * so drift in the scaffold fails the suite loudly.
 */

const root = process.cwd();
const read = (relativePath: string): string =>
  readFileSync(join(root, relativePath), 'utf8');

describe('scaffold invariants', () => {
  it('tsconfig turns on the strict flags M0 requires', () => {
    const tsconfig = JSON.parse(read('tsconfig.json')) as {
      compilerOptions?: Record<string, unknown>;
    };
    const options = tsconfig.compilerOptions ?? {};

    expect(options['strict']).toBe(true);
    expect(options['noUncheckedIndexedAccess']).toBe(true);
    expect(options['noImplicitOverride']).toBe(true);
  });

  it('package.json declares an empty dependencies map (zero runtime deps)', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
    };

    expect(pkg.dependencies).toBeDefined();
    expect(Object.keys(pkg.dependencies ?? { placeholder: '1' })).toHaveLength(0);
  });

  it('vite.config.ts pins the GitHub Pages base path', () => {
    expect(read('vite.config.ts')).toMatch(/base:\s*['"]\/battle-matrix\/['"]/);
  });

  it('the deploy workflow uploads and deploys a Pages artifact', () => {
    const workflowPath = '.github/workflows/deploy.yml';
    expect(existsSync(join(root, workflowPath))).toBe(true);

    const workflow = read(workflowPath);
    expect(workflow).toContain('actions/upload-pages-artifact');
    expect(workflow).toContain('actions/deploy-pages');
  });

  it('the fan-project disclaimer is visible (M11) — not hidden, styled, verbatim naming', () => {
    const html = read('index.html');
    // The <footer id="fan-disclaimer"> tag exists and is NOT hidden.
    const tag = html.match(/<footer id="fan-disclaimer"([^>]*)>/);
    expect(tag, 'index.html must carry <footer id="fan-disclaimer">').not.toBeNull();
    expect(tag![1], 'the disclaimer footer must not be hidden').not.toMatch(/\bhidden\b/);
    // Names every party the plan requires, and the non-commercial / no-assets claims.
    const flat = html.replace(/\s+/g, ' ');
    for (const phrase of [
      'Unofficial, non-commercial fan project',
      'Not affiliated with, endorsed by, or associated with',
      'NetEase Games, Marvel, or The Walt Disney Company',
      'No game assets are redistributed',
    ]) {
      expect(flat, `disclaimer must state "${phrase}"`).toContain(phrase);
    }
    // theme.css gives it a real, always-on layout (a fixed bottom strip).
    const css = read('src/ui/theme.css');
    expect(css).toMatch(/#fan-disclaimer\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/--bm-disclaimer-h/);
  });
});
