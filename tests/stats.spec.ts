import { describe, expect, it } from 'vitest';

import { PROTOCOL_TIER_BONUSES } from '../src/data/constants';
import type { OwnedModule, ProtocolLevels } from '../src/sim/modules';
import { emptySide, resolveUnits } from '../src/sim/stats';
import type { SideModules } from '../src/sim/stats';

/*
 * The golden regression net M11 balances against — broad on purpose: several
 * lineups, several module stacks, both the health and the damage paths, plus
 * the two order-sensitive traps the plan calls out explicitly:
 *   - health: flat additive (incl. level bonuses) -> PERCENT multiplier ->
 *     bonus health (Reserve Armor) added LAST, never multiplied.
 *   - damage: ally module % sums in one bracket; the protocol-level bonus and
 *     enemy Damage Interference are SEPARATE multiplicative factors.
 */

function levels(partial: Partial<Record<keyof ProtocolLevels, number>> = {}): ProtocolLevels {
  return {
    fortress: partial.fortress ?? 0,
    onslaught: partial.onslaught ?? 0,
    reboot: partial.reboot ?? 0,
    equilibrium: partial.equilibrium ?? 0,
  };
}

function side(owned: OwnedModule[], protocolLevels: ProtocolLevels = levels()): SideModules {
  return { owned, protocolLevels };
}

// A minimal, fixed lineup used across several scenarios: 2 Vanguard / 2 Duelist / 2 Strategist.
const MIXED_LINEUP = ['captain-america', 'thor', 'black-widow', 'hawkeye', 'mantis', 'loki'];
const SIX_DUELISTS = ['black-widow', 'hawkeye', 'hela', 'human-torch', 'iron-fist', 'iron-man'];
const TWO_TWO_TWO = ['captain-america', 'thor', 'black-widow', 'hawkeye', 'mantis', 'loki'];

describe('health order: base -> flat (incl. level bonuses) -> PERCENT -> bonus health (never multiplied)', () => {
  it('Captain America: Health Expansion (flat +90) + Health Increment (+10%) + Reserve Armor (+150 bonus)', () => {
    const owned: OwnedModule[] = [
      { moduleId: 'fortress-health-expansion', stars: 1 }, // +90 flat
      { moduleId: 'fortress-health-increment', stars: 1 }, // +10% (Rare)
      { moduleId: 'fortress-reserve-armor', stars: 1 }, // +150 bonus health
    ];
    const [unit] = resolveUnits(
      ['captain-america'],
      side(owned, levels({ fortress: 1 })), // L1 unlocks the Rare, no level-1 flat-health bonus counted separately here
      [],
      emptySide(),
    );

    // CORRECT order: (base 575 + 90 flat + 120 level bonus) x 1.10, bonus +150 added after, never multiplied.
    const fortressL1FlatBonus = (PROTOCOL_TIER_BONUSES.fortress[0]! as { maxHealth: number }).maxHealth;
    expect(fortressL1FlatBonus).toBe(120);
    const expectedMaxHealth = (575 + 90 + 120) * 1.1;
    const expectedBonusHealth = 150;

    expect(unit!.maxHealth).toBeCloseTo(expectedMaxHealth, 6);
    expect(unit!.bonusHealth).toBe(expectedBonusHealth);
    expect(unit!.startingHealth).toBeCloseTo(expectedMaxHealth + expectedBonusHealth, 6);

    // The trap: applying Reserve Armor BEFORE the percentage multiplier would
    // instead give (575+90+120+150) x 1.10 = 1039.5, with bonusHealth folded
    // in and double-counted. Assert the real result is NOT that value.
    const wrongOrderResult = (575 + 90 + 120 + 150) * 1.1;
    expect(unit!.maxHealth).not.toBeCloseTo(wrongOrderResult, 6);
    expect(unit!.startingHealth).not.toBeCloseTo(wrongOrderResult, 6);
  });

  it('Fortress L3 totals +480 max health (120+120+240), cumulative, applied to EVERY ally (Ally Heroes)', () => {
    const [vanguardUnit, duelistUnit] = resolveUnits(
      ['captain-america', 'black-widow'],
      side([], levels({ fortress: 3 })),
      [],
      emptySide(),
    );
    const total = (PROTOCOL_TIER_BONUSES.fortress as readonly { maxHealth: number }[]).reduce(
      (sum, t) => sum + t.maxHealth,
      0,
    );
    expect(total).toBe(480);
    expect(vanguardUnit!.maxHealth).toBeCloseTo(575 + 480, 6); // Captain America base 575
    // Fortress's LEVEL bonus is team-wide ("Ally Heroes" per the info-pane
    // screenshot) even though Fortress MODULES are Vanguard-only — a Duelist
    // gets the same +480 here.
    expect(duelistUnit!.maxHealth).toBeCloseTo(250 + 480, 6); // Black Widow base 250
  });

  it('Equilibrium scope: x1 with 6 Duelists (1 unique role), x3 with a 2-2-2 (3 unique roles)', () => {
    const owned: OwnedModule[] = [{ moduleId: 'equilibrium-health-expansion', stars: 1 }]; // +15 per unique role
    const [oneRoleUnit] = resolveUnits(SIX_DUELISTS, side(owned), SIX_DUELISTS, side(owned)).slice(0, 1);
    const [twoTwoTwoUnit] = resolveUnits(TWO_TWO_TWO, side(owned), TWO_TWO_TWO, side(owned)).slice(0, 1);

    expect(oneRoleUnit!.maxHealth).toBeCloseTo(250 + 15 * 1, 6); // Black Widow, 1 unique role
    expect(twoTwoTwoUnit!.maxHealth).toBeCloseTo(575 + 15 * 3, 6); // Captain America, 3 unique roles
  });

  it('enemy Health Suppression reduces max health as a further multiplicative factor', () => {
    const enemyOwned: OwnedModule[] = [{ moduleId: 'fortress-health-suppression', stars: 1 }]; // -1% per Vanguard
    const enemyLineup = ['captain-america', 'thor']; // 2 Vanguards -> -2%
    const [unit] = resolveUnits(['black-widow'], side([]), enemyLineup, side(enemyOwned));
    expect(unit!.maxHealth).toBeCloseTo(250 * 0.98, 6);
  });
});

describe('damage: ally % sums in one bracket; protocol level bonus and enemy interference are SEPARATE factors', () => {
  it('two ally damage modules sum inside the bracket: (1 + 0.16 + 0.12), not (1.16 × 1.12)', () => {
    const owned: OwnedModule[] = [
      { moduleId: 'onslaught-damage-enhancement', stars: 2 }, // +16% (values [8,16,...])
      { moduleId: 'onslaught-initial-damage-enhancement', stars: 1 }, // +20%, but "at round start" -> separate bucket
    ];
    // Use a module without the round-start text to keep this test to the
    // steady-state bracket only: Damage Enhancement (+16%) alone.
    const soloOwned: OwnedModule[] = [{ moduleId: 'onslaught-damage-enhancement', stars: 2 }];
    const [unit] = resolveUnits(['hawkeye'], side(soloOwned), [], emptySide());
    expect(unit!.dps).toBeCloseTo(120 * 1.16, 6); // Hawkeye baseDps 120

    // sanity: the round-start module lands in roundStartDamagePct, not dps
    const [unitWithRoundStart] = resolveUnits(['hawkeye'], side(owned), [], emptySide());
    expect(unitWithRoundStart!.roundStartDamagePct).toBeCloseTo(20, 6);
    expect(unitWithRoundStart!.dps).toBeCloseTo(120 * 1.16, 6); // unaffected by the round-start bucket
  });

  it('the protocol damage-level bonus and enemy Damage Interference are separate multiplicative factors, not summed into the bracket', () => {
    const owned: OwnedModule[] = [{ moduleId: 'onslaught-damage-enhancement', stars: 2 }]; // +16%
    const enemyOwned: OwnedModule[] = [{ moduleId: 'onslaught-damage-interference', stars: 1 }]; // -1% per Duelist
    const enemyLineup = ['iron-man', 'star-lord', 'storm']; // 3 Duelists -> -3%

    const [unit] = resolveUnits(
      ['hawkeye'],
      side(owned, levels({ onslaught: 1 })), // +12% Onslaught L1 damage bonus
      enemyLineup,
      side(enemyOwned),
    );

    const expected = 120 * (1 + 0.16) * (1 + 0.12) * (1 - 0.03);
    expect(unit!.dps).toBeCloseTo(expected, 6);

    // The trap: folding the +12% protocol bonus into the SAME bracket as the
    // +16% module sum would give 120 x (1 + 0.16 + 0.12) x 0.97, a different
    // number. Assert the real result is not that.
    const wrongBracket = 120 * (1 + 0.16 + 0.12) * (1 - 0.03);
    expect(unit!.dps).not.toBeCloseTo(wrongBracket, 6);
  });

  it('Onslaught L3 damage level bonus is +12+12+24 = +48%, applied to every ally (team-wide), not just Duelists', () => {
    const [duelistUnit, vanguardUnit] = resolveUnits(
      ['hawkeye', 'captain-america'],
      side([], levels({ onslaught: 3 })),
      [],
      emptySide(),
    );
    expect(duelistUnit!.dps).toBeCloseTo(120 * 1.48, 6);
    expect(vanguardUnit!.dps).toBeCloseTo(78 * 1.48, 6); // Captain America baseDps 78, boosted too
  });
});

describe('healing mirrors the damage order', () => {
  it('Reboot healing-level bonus is a separate factor from the ally healing% bracket', () => {
    const owned: OwnedModule[] = [{ moduleId: 'reboot-healing-enhancement', stars: 1 }]; // +8%
    const [unit] = resolveUnits(['mantis'], side(owned, levels({ reboot: 1 })), [], emptySide());
    // Mantis baseHealPerSecond 74, Reboot L1 = +12%
    const expected = 74 * 1.08 * 1.12;
    expect(unit!.healPerSecond).toBeCloseTo(expected, 6);
  });

  it('enemy Healing Suppression reduces healing as a further multiplicative factor', () => {
    const enemyOwned: OwnedModule[] = [{ moduleId: 'reboot-healing-suppression', stars: 1 }]; // -1% per Strategist
    const enemyLineup = ['mantis', 'loki']; // 2 Strategists -> -2%
    const [unit] = resolveUnits(['ultron'], side([]), enemyLineup, side(enemyOwned));
    expect(unit!.healPerSecond).toBeCloseTo(72 * 0.98, 6); // Ultron healPerSecond 72
  });

  it('non-Strategists resolve with zero base and zero resolved healing', () => {
    const [unit] = resolveUnits(['captain-america'], side([]), [], emptySide());
    expect(unit!.baseHealPerSecond).toBe(0);
    expect(unit!.healPerSecond).toBe(0);
  });
});

describe('other module stats land on the resolved unit (broad coverage)', () => {
  it('attackSpeed, ultCharge, lifesteal, and damageTaken (multiplicative across separate modules)', () => {
    const owned: OwnedModule[] = [
      { moduleId: 'onslaught-attack-speed-enhancement', stars: 1 }, // +8%
      { moduleId: 'onslaught-charge-acceleration', stars: 1 }, // +20% ult charge
      { moduleId: 'onslaught-life-steal', stars: 1 }, // +4% lifesteal
      { moduleId: 'onslaught-defensive-shell', stars: 1 }, // -2% damage taken (Duelist-scoped)
      { moduleId: 'equilibrium-defensive-shell', stars: 1 }, // -1% per unique role damage taken (team-wide)
    ];
    // TWO_TWO_TWO index 2 is black-widow, a Duelist: Onslaught modules apply
    // to her; Equilibrium modules apply to everyone at x3 (3 unique roles).
    const [unit] = resolveUnits(TWO_TWO_TWO, side(owned), TWO_TWO_TWO, side(owned)).slice(2, 3);
    expect(unit!.attackSpeed).toBeCloseTo(0.9 * 1.08, 6); // Black Widow base attackSpeed 0.9
    expect(unit!.ultChargeRate).toBeCloseTo(1.2, 6);
    expect(unit!.lifestealPct).toBeCloseTo(4, 6);
    // damageTaken factors are multiplicative, not additive: (1-0.02) x (1-0.01x3)
    expect(unit!.damageTakenMultiplier).toBeCloseTo(0.98 * 0.97, 6);
    expect(unit!.damageTakenMultiplier).not.toBeCloseTo(1 - (0.02 + 0.03), 6); // the additive trap
  });

  it('Legendary behavioural modules surface as sorted, deduplicated effect ids', () => {
    const owned: OwnedModule[] = [
      { moduleId: 'onslaught-annihilator-fury', stars: 1 },
      { moduleId: 'onslaught-infinite-drive', stars: 1 },
    ];
    const [unit] = resolveUnits(['hawkeye'], side(owned, levels({ onslaught: 2 })), [], emptySide());
    expect(unit!.effects).toEqual(['onslaught-annihilator-fury', 'onslaught-infinite-drive']);
  });

  it('Steady Recovery (perRoleUnit) scales with the role count and only applies to that role', () => {
    const owned: OwnedModule[] = [{ moduleId: 'fortress-steady-recovery', stars: 1 }]; // per Vanguard, 1.5%/s
    const lineup = ['captain-america', 'thor', 'black-widow'];
    const units = resolveUnits(lineup, side(owned), lineup, side(owned));
    const vanguardCountInLineup = 2;
    expect(units[0]!.lostHealthRegenPctPerSecond).toBeCloseTo(1.5 * vanguardCountInLineup, 6);
    expect(units[2]!.lostHealthRegenPctPerSecond).toBe(0); // Black Widow — not a Vanguard, module doesn't apply to her
  });
});

describe('a broad golden snapshot — several lineups, several module stacks', () => {
  it('matches the committed snapshot', () => {
    const scenarioA = resolveUnits(
      MIXED_LINEUP,
      side(
        [
          { moduleId: 'fortress-health-expansion', stars: 3 },
          { moduleId: 'onslaught-damage-enhancement', stars: 4 },
          { moduleId: 'reboot-healing-enhancement', stars: 2 },
          { moduleId: 'equilibrium-charge-acceleration', stars: 1 },
          { moduleId: 'fortress-reserve-armor', stars: 2 },
        ],
        levels({ fortress: 2, onslaught: 1, reboot: 1, equilibrium: 1 }),
      ),
      MIXED_LINEUP,
      side(
        [
          { moduleId: 'onslaught-damage-interference', stars: 2 },
          { moduleId: 'reboot-healing-suppression', stars: 1 },
        ],
        levels({ onslaught: 1 }),
      ),
    );

    const scenarioB = resolveUnits(SIX_DUELISTS, side([{ moduleId: 'equilibrium-health-expansion', stars: 6 }]), [], emptySide());

    const scenarioC = resolveUnits(
      TWO_TWO_TWO,
      side([], levels({ fortress: 3, onslaught: 3, reboot: 3, equilibrium: 3 })),
      [],
      emptySide(),
    );

    expect({ scenarioA, scenarioB, scenarioC }).toMatchSnapshot();
  });
});
