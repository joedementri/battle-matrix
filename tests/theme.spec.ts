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
