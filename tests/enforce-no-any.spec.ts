import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * ENFORCEMENT (plan, exit criterion): "no `any` outside declared boundaries".
 * Strict TypeScript already forbids implicit `any`; this spec forbids the
 * EXPLICIT kind — `: any`, `as any`, `<any>`, `any[]`, `Array<any>`,
 * `Record<…, any>` — anywhere under `src/`, with a small, documented allowlist
 * of genuine type-system boundaries. Comments and string / template literals are
 * stripped first so prose that merely says "any" is ignored.
 *
 * This is the mechanical backstop to `@typescript-eslint/no-explicit-any` in
 * `eslint.config.js` (the last `it` re-checks that rule ships too). Built in the
 * style of `enforce-strings.spec.ts` / `enforce-no-arith.spec.ts`.
 */

const SRC = join(process.cwd(), 'src');

// exact `relativePath:lineNumber` -> why this `any` is a real, unavoidable
// type-system boundary. Keep it empty; add an entry only with a written reason.
const ALLOWLIST: Readonly<Record<string, string>> = {
  // (intentionally empty)
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Strip block + line comments and single/double/backtick string literals. */
function strip(src: string): string {
  let out = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/`[^`\n]*`/g, '``');
  }
  return out;
}

// `any` used as a type: after `:`, `as`, `<`, or `|`/`&`; or `any[]` / `Array<any>` / `Record<…, any>`.
const ANY_TYPE = /(?<![A-Za-z0-9_$])any(?![A-Za-z0-9_$])/;
const ANY_CONTEXT =
  /(?::\s*any\b|\bas\s+any\b|<\s*any\s*>|\bany\s*\[\s*\]|Array\s*<\s*any\b|Record\s*<[^>]*,\s*any\s*>|\|\s*any\b|&\s*any\b|=>\s*any\b)/;

function offenders(code: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  code.split('\n').forEach((raw, i) => {
    if (!ANY_TYPE.test(raw)) return;
    if (!ANY_CONTEXT.test(raw)) return;
    found.push({ line: i + 1, text: raw.trim() });
  });
  return found;
}

describe('enforcement — no explicit `any` in src/', () => {
  const files = tsFiles(SRC);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('the matcher has teeth (catches an explicit any, ignores identifiers / prose)', () => {
    expect(offenders(strip('const x: any = 1;')).length).toBe(1);
    expect(offenders(strip('foo(bar as any);')).length).toBe(1);
    expect(offenders(strip('type T = string | any;')).length).toBe(1);
    expect(offenders(strip('const xs: any[] = [];')).length).toBe(1);
    expect(offenders(strip('let m: Record<string, any>;')).length).toBe(1);
    expect(offenders(strip('const company = "any company";'))).toEqual([]);
    expect(offenders(strip('// accept any input here'))).toEqual([]);
    expect(offenders(strip('const anyone = pickAnyone();'))).toEqual([]);
  });

  for (const file of files) {
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    it(`${rel} uses no explicit any`, () => {
      const hits = offenders(strip(readFileSync(file, 'utf8')));
      const unexpected = hits.filter((h) => ALLOWLIST[`${rel}:${h.line}`] === undefined);
      expect(
        unexpected,
        `${rel}: explicit \`any\` — give it a real type, or add an allowlist entry with a reason:\n` +
          unexpected.map((h) => `  L${h.line}: ${h.text}`).join('\n'),
      ).toEqual([]);
    });
  }

  it('every allowlist entry still resolves to a real line', () => {
    for (const key of Object.keys(ALLOWLIST)) {
      const [rel, ln] = key.split(':');
      const lines = readFileSync(join(process.cwd(), rel!), 'utf8').split('\n');
      expect(lines[Number(ln) - 1], `stale allowlist entry ${key}`).toBeDefined();
    }
  });

  it('@typescript-eslint/no-explicit-any ships in eslint.config.js too (both, not either)', () => {
    const cfg = readFileSync(join(process.cwd(), 'eslint.config.js'), 'utf8');
    // typescript-eslint's `recommended` set already enables it; assert the
    // preset is wired so the two enforcement paths cannot silently diverge.
    expect(cfg).toMatch(/tseslint\.configs\.recommended/);
  });
});
