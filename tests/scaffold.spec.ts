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
});
