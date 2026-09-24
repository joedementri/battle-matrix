import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The colour tokens are defined ONCE, in src/ui/theme.css. This test reads that
 * file and asserts every hex from the plan's "Colour tokens" table is present as
 * a custom-property value, so an accidental edit to a token fails loudly instead
 * of silently drifting the palette. (No TS module mirrors these — that would be
 * the thing that drifts.)
 */

const CSS = readFileSync(join(process.cwd(), 'src', 'ui', 'theme.css'), 'utf8');

/** token name shown in the report -> the exact hex the plan specifies */
const PLAN_HEXES: Readonly<Record<string, string>> = {
  'panel navy': '#161B2B',
  'accent gold': '#FFC800',
  Fortress: '#4A6BD8',
  Onslaught: '#C8383C',
  Reboot: '#2E9E5B',
  Equilibrium: '#8B44C4',
  'Common star': '#6E8BE8',
  'Rare star': '#E040C0',
  'Legendary star': '#FFD400',
  'Strengthen gold': '#E8A020',
  'Change-Hero lavender': '#9A8FD8',
};

describe('src/ui/theme.css — colour tokens', () => {
  for (const [label, hex] of Object.entries(PLAN_HEXES)) {
    it(`carries the ${label} hex ${hex}`, () => {
      // custom-property assignment: `--something: #rrggbb;` (case-insensitive)
      const re = new RegExp(`--[\\w-]+\\s*:\\s*${hex}\\s*;`, 'i');
      expect(CSS, `${label} (${hex}) not found as a --custom-property value in theme.css`).toMatch(re);
    });
  }

  it('authors win/loss streak green & red as custom properties (the plan leaves them unspecified)', () => {
    expect(CSS).toMatch(/--bm-streak-win\s*:\s*#[0-9a-f]{6}\s*;/i);
    expect(CSS).toMatch(/--bm-streak-loss\s*:\s*#[0-9a-f]{6}\s*;/i);
  });

  it('defines the tokens on a bare :root (single source, not inside a media/theme block)', () => {
    const rootBlock = CSS.slice(CSS.indexOf(':root'), CSS.indexOf('}', CSS.indexOf(':root')) + 1);
    expect(rootBlock).toMatch(/--bm-ground\s*:\s*#161b2b/i);
    expect(rootBlock).toMatch(/--bm-accent\s*:\s*#ffc800/i);
  });
});

describe('M11 accessibility — colour-blind assist is an override layer, not a recolour', () => {
  // The whole CB section: from its banner comment to the toggle-widget rule.
  const start = CSS.indexOf('Colour-blind assist (M11)');
  const end = CSS.indexOf('.bm-cb-toggle');
  const block = start >= 0 && end > start ? CSS.slice(start, end) : '';

  it('ships a :root[data-cb="1"] override layer', () => {
    expect(block).not.toBe('');
    expect((block.match(/\[data-cb='1'\]/g) ?? []).length).toBeGreaterThan(6);
  });

  it('reinforces role / protocol with SHAPE, PATTERN and TEXT — never a new colour', () => {
    // shape / pattern / text reinforcement is present …
    expect(block).toMatch(/border-style:\s*(dashed|dotted|double)/);
    expect(block).toMatch(/clip-path:/);
    expect(block).toMatch(/content:\s*attr\(data-role\)/);
    expect(block).toMatch(/stroke-width:/);
    // … and NO hex colour is introduced inside the CB layer (canonical tokens
    // stay the single source of truth; the layer only ever reads var(--bm-*)).
    expect(block, 'the CB override layer must not introduce a hex colour').not.toMatch(
      /#[0-9a-f]{3,8}\b/i,
    );
  });

  it('the hero token carries a non-colour role cue (data-role) for the CB chip', () => {
    const token = readFileSync(join(process.cwd(), 'src', 'ui', 'heroToken.ts'), 'utf8');
    expect(token).toMatch(/'data-role':\s*art\.displayRole/);
  });
});
