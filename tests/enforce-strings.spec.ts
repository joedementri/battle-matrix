import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as S from '../src/data/strings';

/*
 * ENFORCEMENT (plan, M8; M9 extends the scan to `src/render/**`): "every visible
 * string comes from strings.ts". This scans every `src/ui/**\/*.ts` and
 * `src/render/**\/*.ts`, strips comments, and flags a multi-word quoted literal
 * (two or more letter-words separated by whitespace) that is NOT:
 *   - on an `import` / `export … from` line,
 *   - a value already exported from `src/data/strings`,
 *   - a lowercase kebab class list (`bm-card bm-card--vanguard`),
 *   - a CSS `calc(...)` fragment,
 *   - on the small documented allowlist below.
 *
 * If a screen / the renderer needs a string that is missing, it was ADDED to
 * strings.ts (see the M8 / M9 report), never allowlisted.
 */

const SCAN_DIRS = [join(process.cwd(), 'src', 'ui'), join(process.cwd(), 'src', 'render')];

const STRING_VALUES = new Set(
  Object.values(S)
    .flatMap((v) => (Array.isArray(v) ? (v as unknown[]) : typeof v === 'object' && v !== null ? Object.values(v) : [v]))
    .filter((v): v is string => typeof v === 'string'),
);

// exact literal -> why it is not user-facing copy that belongs in strings.ts
const ALLOWLIST: Readonly<Record<string, string>> = {
  'text/plain': 'DataTransfer MIME type for drag-and-drop — a Web API constant, not UI copy.',
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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
}

const MULTIWORD = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;
const KEBAB_LIST = /^[a-z][\w-]*(?:\s+[a-z][\w-]*)*$/; // class lists
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$\\]*)`/g; // template: static-only (no ${})

function offenders(code: string): { line: number; value: string }[] {
  const out: { line: number; value: string }[] = [];
  code.split('\n').forEach((raw, i) => {
    if (/^\s*(import|export)\b.*\bfrom\b/.test(raw)) return;
    let m: RegExpExecArray | null;
    LITERAL.lastIndex = 0;
    while ((m = LITERAL.exec(raw)) !== null) {
      const value = m[1] ?? m[2] ?? m[3] ?? '';
      if (!MULTIWORD.test(value)) continue;
      if (KEBAB_LIST.test(value)) continue;
      if (/^calc\(/.test(value)) continue;
      if (STRING_VALUES.has(value)) continue;
      if (ALLOWLIST[value] !== undefined) continue;
      out.push({ line: i + 1, value });
    }
  });
  return out;
}

describe('enforcement — every visible string in src/ui + src/render comes from strings.ts', () => {
  const files = SCAN_DIRS.flatMap(tsFiles);

  it('finds ui + render source files to scan', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.replace(/\\/g, '/').includes('/src/render/'))).toBe(true);
  });

  it('the matcher has teeth (catches orphan prose, ignores class lists / strings.ts values)', () => {
    expect(offenders(`h('h1', { text: 'Assemble the squad now' })`).length).toBe(1);
    expect(offenders(`const t = "Waiting for my friends";`).length).toBe(1);
    expect(offenders(`el.className = 'bm-card bm-card--vanguard is-open';`)).toEqual([]);
    expect(offenders(`h('span', { text: S.SELECT_POSITION })`)).toEqual([]);
    // a literal equal to a real strings.ts value is fine (same text)
    expect(offenders(`const x = 'Select Position';`)).toEqual([]);
  });

  for (const file of files) {
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    it(`${rel} has no orphan multi-word literal`, () => {
      const hits = offenders(stripComments(readFileSync(file, 'utf8')));
      expect(
        hits,
        `${rel}: multi-word string literal(s) not sourced from src/data/strings — add them there:\n` +
          hits.map((hit) => `  L${hit.line}: ${JSON.stringify(hit.value)}`).join('\n'),
      ).toEqual([]);
    });
  }
});
