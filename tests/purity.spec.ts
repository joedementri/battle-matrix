import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The one architectural rule, enforced as a backstop to the ESLint override:
 * `src/sim/` is pure and headless. This test greps every sim source file for
 * DOM/BOM globals, the wall clock, the platform RNG, crypto, and any import that
 * reaches into `ui/` or `render/`. Comments are stripped first so the sim's own
 * doc prose may name the things it forbids.
 *
 * Lint config drifts; this test does not.
 */

const ROOT = process.cwd();
const SIM_DIR = join(ROOT, 'src', 'sim');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Strip block and line comments. `src/sim/` has no `//` inside string or regex
 * literals (asserted by the "no surprising //" check below), so a blunt strip is
 * safe here and keeps the grep honest about *code*.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

interface Rule {
  readonly name: string;
  readonly re: RegExp;
}

const FORBIDDEN: readonly Rule[] = [
  { name: 'window', re: /\bwindow\b/ },
  { name: 'document', re: /\bdocument\b/ },
  { name: 'navigator', re: /\bnavigator\b/ },
  { name: 'localStorage', re: /\blocalStorage\b/ },
  { name: 'sessionStorage', re: /\bsessionStorage\b/ },
  { name: 'indexedDB', re: /\bindexedDB\b/ },
  { name: 'Math.random', re: /\bMath\s*\.\s*random\b/ },
  { name: 'Date (constructor / statics)', re: /\bnew\s+Date\b|\bDate\s*\.\s*(now|parse|UTC)\b/ },
  { name: 'Date type / identifier', re: /\bDate\b/ },
  { name: 'performance.now', re: /\bperformance\s*\.\s*now\b/ },
  { name: 'crypto', re: /\bcrypto\b/ },
  { name: 'requestAnimationFrame', re: /\brequestAnimationFrame\b/ },
  { name: 'fetch(', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: "import from ui/", re: /\bfrom\s+['"][^'"]*\/ui(\/|['"])/ },
  { name: "import from render/", re: /\bfrom\s+['"][^'"]*\/render(\/|['"])/ },
  { name: 'dynamic import of ui/ or render/', re: /\bimport\s*\(\s*['"][^'"]*\/(ui|render)\// },
];

describe('src/sim purity — grep backstop', () => {
  const files = tsFiles(SIM_DIR);

  it('finds sim source files to inspect', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const raw = readFileSync(file, 'utf8');
    const code = stripComments(raw);

    it(`${rel} has no surprising // outside comments`, () => {
      // guards the blunt comment stripper: no `//` survives inside a string/regex
      expect(code).not.toMatch(/["'`][^"'`\n]*\/\//);
    });

    it(`${rel} touches no forbidden global or forbidden layer`, () => {
      for (const rule of FORBIDDEN) {
        expect(code, `${rel}: forbidden "${rule.name}"`).not.toMatch(rule.re);
      }
    });
  }
});

describe('src/sim purity — the ESLint override ships too (both, not either)', () => {
  const cfg = readFileSync(join(ROOT, 'eslint.config.js'), 'utf8');

  it('scopes an override to src/sim/**', () => {
    expect(cfg).toMatch(/files:\s*\[\s*['"]src\/sim\/\*\*\/\*\.ts['"]/);
  });

  it('restricts globals, properties, syntax, and imports for the sim layer', () => {
    expect(cfg).toMatch(/no-restricted-globals/);
    expect(cfg).toMatch(/no-restricted-properties/);
    expect(cfg).toMatch(/no-restricted-syntax/);
    expect(cfg).toMatch(/no-restricted-imports/);
    expect(cfg).toMatch(/Math['"]?\s*,\s*property:\s*['"]random['"]/);
    expect(cfg).toMatch(/ui\/\*\*/);
    expect(cfg).toMatch(/render\/\*\*/);
  });
});
