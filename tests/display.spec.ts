import { describe, expect, it } from 'vitest';

import modulesJson from '../src/data/modules.json';
import type { BaseModule } from '../src/data/types';
import { formatModuleValue, moduleById, ownedValue, shopCardValue } from '../src/sim/modules';

/*
 * The two value-display rules, kept deliberately separate from modules.spec.ts
 * because the shop and the info pane genuinely differ:
 *   - shopCardValue(module)   -> ALWAYS values[0] (the level-1 base value).
 *   - ownedValue(module, lvl) -> values[level - 1] (the CUMULATIVE table entry
 *     AT that level) — a table lookup, never a sum of the table.
 *
 * Every assertion below reproduces an exact screenshot string.
 */

const modules = modulesJson as unknown as readonly BaseModule[];

describe('shopCardValue — always the level-1 base value, regardless of owned stars', () => {
  it('Fortress Health Expansion shop card reads 90.0 (flat, no %)', () => {
    const m = moduleById('fortress-health-expansion');
    const display = shopCardValue(m);
    expect(display).toEqual({ value: 90, isPercent: false });
    expect(formatModuleValue(display)).toBe('90.0');
  });

  it('Onslaught Charge Acceleration shop card reads 20.0 % — even at several owned stars', () => {
    const m = moduleById('onslaught-charge-acceleration');
    // The screenshot shows this card mid-owned (button reads UPGRADE) and it
    // STILL shows the level-1 value. shopCardValue must not know or care about
    // ownership — it is a pure function of the module alone.
    const display = shopCardValue(m);
    expect(display).toEqual({ value: 20, isPercent: true });
    expect(formatModuleValue(display)).toBe('20.0 %');
  });

  it('never varies with a hypothetical "owned level" argument — the function takes only the module', () => {
    // shopCardValue has no level parameter at all; this is a compile-time
    // guarantee, re-asserted here as a behavioural one: two calls on the same
    // module are always equal.
    const m = moduleById('reboot-health-expansion');
    expect(shopCardValue(m)).toEqual(shopCardValue(m));
    expect(shopCardValue(m)).toEqual({ value: 30, isPercent: false });
  });

  it('is values[0] for every module in the data set, mechanically', () => {
    for (const m of modules) {
      const expectedValue = m.values[0];
      expect(expectedValue, `${m.id} has no values[0]`).toBeDefined();
      expect(shopCardValue(m).value, m.id).toBe(expectedValue);
    }
  });
});

describe('ownedValue — the cumulative table value AT the owned level (never a sum)', () => {
  it('Initial Healing Boost ★★ (level 2 of 15/30/60) reads 30.0 % — not 15+30=45', () => {
    const m = moduleById('reboot-initial-healing-boost');
    expect(m.values).toEqual([15, 30, 60]);
    const display = ownedValue(m, 2);
    expect(display).toEqual({ value: 30, isPercent: true });
    expect(formatModuleValue(display)).toBe('30.0 %');
  });

  it('Healing Enhancement ★★★★ (level 4 of 8/16/24/32/40/56) reads 32.0 % — not 8+16+24+32=80', () => {
    const m = moduleById('reboot-healing-enhancement');
    expect(m.values).toEqual([8, 16, 24, 32, 40, 56]);
    const display = ownedValue(m, 4);
    expect(display).toEqual({ value: 32, isPercent: true });
    expect(formatModuleValue(display)).toBe('32.0 %');
  });

  it('Health Expansion ★★ reads 60.0 — the Onslaught/Reboot line (30/60/90/…), not Fortress (90/180/…)', () => {
    // The plan flags this explicitly: picking the wrong Health Expansion module
    // (Fortress instead of Onslaught/Reboot) would silently pass a similarly-
    // shaped assertion at the wrong value. Assert both, so a swap is caught.
    const onslaught = moduleById('onslaught-health-expansion');
    const reboot = moduleById('reboot-health-expansion');
    expect(onslaught.values).toEqual([30, 60, 90, 120, 150, 210]);
    expect(reboot.values).toEqual([30, 60, 90, 120, 150, 210]);

    expect(formatModuleValue(ownedValue(onslaught, 2))).toBe('60.0');
    expect(formatModuleValue(ownedValue(reboot, 2))).toBe('60.0');

    // The Fortress line is a DIFFERENT table (90/180/…) — its level-2 value is
    // 180, not 60. Guards against silently testing the wrong module.
    const fortress = moduleById('fortress-health-expansion');
    expect(fortress.values).toEqual([90, 180, 270, 360, 450, 630]);
    expect(formatModuleValue(ownedValue(fortress, 2))).not.toBe('60.0');
  });

  it('level 1 of ownedValue always equals shopCardValue (both are values[0] there)', () => {
    for (const m of modules) {
      expect(ownedValue(m, 1)).toEqual(shopCardValue(m));
    }
  });

  it('is values[level - 1] for every module at every valid level, mechanically — never a running sum', () => {
    for (const m of modules) {
      for (let level = 1; level <= m.values.length; level++) {
        const expectedValue = m.values[level - 1];
        expect(expectedValue, `${m.id} @${level}`).toBeDefined();
        expect(ownedValue(m, level).value, `${m.id} @${level}`).toBe(expectedValue);

        // The trap this file exists to catch: a naive `.reduce(sum)` over the
        // slice would equal the running total only when every prior value is 0,
        // which is never true here (all tables are strictly positive) — so if
        // ownedValue ever summed instead of indexed, this would fail as soon
        // as level > 1 for any module with more than one level.
        if (level > 1) {
          const wrongSum = m.values.slice(0, level).reduce((a, b) => a + b, 0);
          expect(ownedValue(m, level).value, `${m.id} @${level} must not be the running sum`).not.toBe(
            wrongSum,
          );
        }
      }
    }
  });

  it('rejects a non-positive or non-integer level', () => {
    const m = moduleById('fortress-health-expansion');
    expect(() => ownedValue(m, 0)).toThrow(RangeError);
    expect(() => ownedValue(m, -1)).toThrow(RangeError);
    expect(() => ownedValue(m, 1.5)).toThrow(RangeError);
  });
});

describe('formatModuleValue — one decimal place, space before a trailing %', () => {
  it('reproduces all five screenshot strings exactly', () => {
    expect(formatModuleValue(shopCardValue(moduleById('fortress-health-expansion')))).toBe('90.0');
    expect(formatModuleValue(shopCardValue(moduleById('onslaught-charge-acceleration')))).toBe('20.0 %');
    expect(formatModuleValue(ownedValue(moduleById('reboot-initial-healing-boost'), 2))).toBe('30.0 %');
    expect(formatModuleValue(ownedValue(moduleById('reboot-healing-enhancement'), 4))).toBe('32.0 %');
    expect(formatModuleValue(ownedValue(moduleById('reboot-health-expansion'), 2))).toBe('60.0');
  });

  it('always renders exactly one decimal place, including on whole numbers and fractional tables', () => {
    expect(formatModuleValue({ value: 5, isPercent: false })).toBe('5.0');
    expect(formatModuleValue({ value: 1.5, isPercent: true })).toBe('1.5 %');
    // Fortress Steady Recovery: 1.5/3/6 — a fractional table, still one decimal.
    const steadyRecovery = moduleById('fortress-steady-recovery');
    expect(formatModuleValue(ownedValue(steadyRecovery, 1))).toBe('1.5 %');
    expect(formatModuleValue(ownedValue(steadyRecovery, 2))).toBe('3.0 %');
    // Equilibrium Health Increment: 2.5/5/10
    const healthIncrement = moduleById('equilibrium-health-increment');
    expect(formatModuleValue(ownedValue(healthIncrement, 1))).toBe('2.5 %');
  });

  it('a flat (non-percent) value never carries a % sign', () => {
    const display = shopCardValue(moduleById('fortress-reserve-armor'));
    expect(display.isPercent).toBe(false);
    expect(formatModuleValue(display)).not.toMatch(/%/);
  });
});
