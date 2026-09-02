import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * ENFORCEMENT (plan, M8; M9 extends the scan to `src/render/**`): "no arithmetic
 * on tokens / health / XP outside src/sim/". The UI and renderer layers dispatch
 * actions and render state; every numeric derivation must come from a `src/sim`
 * export (`economy.previewIncome`, `modules.rarityOdds`, `modules.shopCardValue`
 * / `ownedValue`, the `sim/selectors` helpers — `healthBarModel`,
 * `ultChargeFraction`, `lerp`). The UI / renderer may only FORMAT.
 *
 * This scans every `src/ui/**\/*.ts` and `src/render/**\/*.ts`, strips comments
 * and single/double-quoted strings (template literals are kept so `${a / b}` is
 * still checked), and flags an arithmetic operator ( + - * / % ++ -- += … )
 * adjacent to an identifier whose name is "about" tokens / health / hp / xp /
 * price / threshold.
 *
 * ALLOWLIST: exact `relativePath:lineNumber` entries, each justified in the M8 /
 * M9 report. Keep it minimal.
 */

const SCAN_DIRS = [join(process.cwd(), 'src', 'ui'), join(process.cwd(), 'src', 'render')];

// path:line -> why it is pure display formatting and not a game rule
const ALLOWLIST: Readonly<Record<string, string>> = {
  // (intentionally empty — bar fills use CSS calc() over custom properties, so
  //  no JS arithmetic touches a health/xp value anywhere in src/ui.)
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

/**
 * Strip block + line comments, single/double-quoted string literals, and
 * backtick template literals (CSS class lists like `bm-token ${x}` live there —
 * their hyphens are not arithmetic). Real arithmetic on a tracked quantity would
 * be an EXPRESSION (`const w = health / max`), never buried in a template.
 */
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

// identifier core "about" one of the tracked quantities (camelCase-aware; avoids
// false hits on words like "example" / "expand" that merely contain "xp")
const TRACKED_CORE =
  '(?:(?<![A-Za-z])(?:tokens?|health|prices?|thresholds?|xp|hp)|(?<=[a-z0-9])(?:Tokens?|Health|Prices?|Thresholds?|Xp|Hp|XP|HP))';
const MEMBER_TAIL = '(?:\\s*(?:\\.\\s*[A-Za-z_$][\\w$]*|\\[[^\\]\\n]*\\]))*';
const TRACKED_EXPR = `${TRACKED_CORE}[A-Za-z0-9_$]*${MEMBER_TAIL}`;
// arithmetic ops, excluding => and ** and comparison/equality and //, /* , /=
const ARITH = '(?:\\+\\+|--|\\+=|-=|\\*=|%=|[+\\-*%](?![=>])|/(?![/*=]))';

const AFTER = new RegExp(`${TRACKED_EXPR}\\s*${ARITH}`, 'g');
const BEFORE = new RegExp(`${ARITH}\\s*${TRACKED_EXPR}`, 'g');

function offenders(code: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  code.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || /^(import|export)\b.*\bfrom\b/.test(line)) return;
    for (const re of [AFTER, BEFORE]) {
      re.lastIndex = 0;
      if (re.test(raw)) found.push({ line: i + 1, text: line });
    }
  });
  return found;
}

describe('enforcement — no arithmetic on tokens / health / xp outside src/sim/', () => {
  const files = SCAN_DIRS.flatMap(tsFiles);

  it('finds ui + render source files to scan', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.replace(/\\/g, '/').includes('/src/render/'))).toBe(true);
  });

  for (const file of files) {
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    it(`${rel} does no arithmetic on a tracked quantity`, () => {
      const hits = offenders(strip(readFileSync(file, 'utf8')));
      const unexpected = hits.filter((h) => ALLOWLIST[`${rel}:${h.line}`] === undefined);
      expect(
        unexpected,
        `${rel}: arithmetic on a token/health/xp value — move the derivation into src/sim/ or allowlist with justification:\n` +
          unexpected.map((h) => `  L${h.line}: ${h.text}`).join('\n'),
      ).toEqual([]);
    });
  }

  it('the matcher actually catches arithmetic on a tracked quantity (not toothless)', () => {
    expect(offenders(strip('const w = player.health / maxHealth;')).length).toBeGreaterThan(0);
    expect(offenders(strip('const t = tokens - price;')).length).toBeGreaterThan(0);
    expect(offenders(strip('meter.xp += gained;')).length).toBeGreaterThan(0);
    expect(offenders(strip('const p = 100 * healthFraction;')).length).toBeGreaterThan(0);
    // …and does NOT fire on legitimate formatting / kebab class names
    expect(offenders(strip('const s = `${vm.health}/${vm.max}`;'))).toEqual([]);
    expect(offenders(strip("el.className = 'bm-price bm-price--red';"))).toEqual([]);
    expect(offenders(strip('const label = S.xpMeter(meter.xp, meter.nextThreshold);'))).toEqual([]);
  });

  it('every allowlist entry still resolves to a real line', () => {
    for (const key of Object.keys(ALLOWLIST)) {
      const [rel, ln] = key.split(':');
      const abs = join(process.cwd(), rel!);
      const lines = readFileSync(abs, 'utf8').split('\n');
      expect(lines[Number(ln) - 1], `stale allowlist entry ${key}`).toBeDefined();
    }
  });
});
