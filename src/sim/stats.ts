/*
 * M4 — module stack -> resolved per-unit combat stats.
 *
 * `resolveUnits` folds a battle-start-frozen lineup and both sides' owned Base
 * Modules + protocol levels into a `ResolvedUnit[]`. It is called once per
 * battle, on the lineup as it stands when the battle phase begins — purchases
 * and swaps made mid-battle cannot retroactively change a running battle's
 * resolved units (the plan's "effects take effect next round" rule); that
 * freezing is the caller's responsibility (M5/M6), this module only computes.
 *
 * AGGREGATION ORDER — implemented exactly as specified, and tested as such:
 *   health: baseHealth -> flat additive (Health Expansion, Fortress/Equilibrium
 *     LEVEL bonuses) -> percentage multiplier (Health Increment) -> enemy
 *     Health Suppression (a further multiplicative factor) -> round-start
 *     bonus health (Reserve Armor), added last and NEVER multiplied.
 *   damage: baseDps x (1 + sum of ally damage%) x (1 + protocol damage-level%)
 *     x (1 - enemy Damage Interference%) — the ally module sum is one bracket;
 *     the protocol-level bonus and the enemy interference are SEPARATE
 *     multiplicative factors, not folded into that bracket. Healing mirrors it.
 *
 * SCOPE: `flat` = as-is; `perRoleUnit` = x count of the module's protocol role
 * in the OWNING side's lineup (also true for enemy-target Suppression /
 * Interference modules — "per Vanguard" counts the caster's Vanguards);
 * `perUniqueRole` = x unique roles (1..3) in the owning lineup. Role counts are
 * taken once, at battle start, from the frozen lineup passed in — NOT
 * recomputed as units die mid-battle (a documented choice, matching the
 * plan's "resolve once at battle start" architecture).
 *
 * PROTOCOL LEVEL BONUSES ARE TEAM-WIDE. The plan states Fortress's level bonus
 * applies "all allies" (confirmed by the info-pane screenshot's literal "Ally
 * Heroes" wording), even though Fortress's MODULES are Vanguard-only. Read
 * uniformly across all four protocols: every level bonus (Fortress health,
 * Onslaught damage, Reboot healing, Equilibrium health+damage&healing) applies
 * to every unit in the lineup, not just that protocol's role.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { PROTOCOL_TIER_BONUSES } from '../data/constants';
import heroesJson from '../data/heroes.json';
import type { HeroCombat, Protocol, Role, Targeting } from '../data/types';

import { PROTOCOLS, moduleById, ownedValue } from './modules';
import type { OwnedModule, ProtocolLevels } from './modules';

// ---------------------------------------------------------------------------
// Hero lookup
// ---------------------------------------------------------------------------

interface HeroFull {
  readonly id: string;
  readonly role: Role;
  readonly baseHealth: number;
  readonly targeting: Targeting;
  readonly combat: HeroCombat;
}

const HEROES = heroesJson as unknown as readonly HeroFull[];
const HERO_BY_ID = new Map<string, HeroFull>(HEROES.map((h) => [h.id, h]));

function heroById(id: string): HeroFull {
  const h = HERO_BY_ID.get(id);
  if (h === undefined) throw new RangeError(`heroById(): unknown hero id "${id}"`);
  return h;
}

/** Which role a protocol's (non-Equilibrium) modules and `perRoleUnit` scope target. */
const PROTOCOL_ROLE: Readonly<Partial<Record<Protocol, Role>>> = {
  fortress: 'vanguard',
  onslaught: 'duelist',
  reboot: 'strategist',
};

// ---------------------------------------------------------------------------
// ResolvedUnit
// ---------------------------------------------------------------------------

export interface ResolvedUnit {
  readonly heroId: string;
  readonly role: Role;
  readonly targeting: Targeting;

  readonly baseHealth: number;
  /** base + flat additive (Health Expansion, level bonuses), x pct multiplier, x enemy suppression. */
  readonly maxHealth: number;
  /** Reserve Armor etc — granted at round start, added last, NEVER multiplied. */
  readonly bonusHealth: number;
  /** `maxHealth + bonusHealth`, for convenience. */
  readonly startingHealth: number;

  readonly baseDps: number;
  /** Steady-state resolved damage/second (excludes round-start temp buffs). */
  readonly dps: number;
  /** Extra damage % active only in the first 10s of a round (Initial Damage Enhancement, …). */
  readonly roundStartDamagePct: number;

  readonly baseHealPerSecond: number;
  readonly healPerSecond: number;
  readonly roundStartHealingPct: number;

  readonly attackRange: number;
  readonly attackSpeed: number;
  readonly moveSpeed: number;

  /** Product of (1 - Defensive Shell%) across every such module — multiplicative, not additive. */
  readonly damageTakenMultiplier: number;
  readonly ultChargeRate: number;
  readonly ultEnergyAtRoundStartPct: number;
  readonly lifestealPct: number;
  readonly lostHealthRegenPctPerSecond: number;
  readonly lastStandDamagePctPer200Lost: number;
  /** Vulnerability % this unit's hits apply to the enemy it strikes. */
  readonly vulnerabilityOnHitPct: number;
  /** % of this unit's healing that also deals damage to enemies (Deadly Healing). */
  readonly healingAsDamagePct: number;
  /** % of this unit's overflow healing converted to allies' bonus health (Overflow Recharge). */
  readonly overflowToBonusHealthPct: number;

  /** Sorted, deduplicated Legendary `effectId`s active on this unit. */
  readonly effects: readonly string[];
}

// ---------------------------------------------------------------------------
// Accumulator — the per-unit sums before the final multiplicative assembly
// ---------------------------------------------------------------------------

interface Accumulator {
  flatHealth: number;
  healthPct: number;
  bonusHealth: number;

  dmgPct: number;
  protocolDmgLevelPct: number;
  roundStartDmgPct: number;

  healPct: number;
  protocolHealLevelPct: number;
  roundStartHealPct: number;

  attackSpeedPct: number;
  ultChargePct: number;
  ultEnergyRoundStartPct: number;
  lifestealPct: number;
  lostHealthRegenPct: number;
  lastStandDamagePct: number;
  vulnerabilityPct: number;
  healingAsDamagePct: number;
  overflowToBonusHealthPct: number;

  damageTakenFactors: number[];
  effects: Set<string>;
}

function newAccumulator(): Accumulator {
  return {
    flatHealth: 0,
    healthPct: 0,
    bonusHealth: 0,
    dmgPct: 0,
    protocolDmgLevelPct: 0,
    roundStartDmgPct: 0,
    healPct: 0,
    protocolHealLevelPct: 0,
    roundStartHealPct: 0,
    attackSpeedPct: 0,
    ultChargePct: 0,
    ultEnergyRoundStartPct: 0,
    lifestealPct: 0,
    lostHealthRegenPct: 0,
    lastStandDamagePct: 0,
    vulnerabilityPct: 0,
    healingAsDamagePct: 0,
    overflowToBonusHealthPct: 0,
    damageTakenFactors: [],
    effects: new Set<string>(),
  };
}

function addInto(into: Accumulator, from: Accumulator): void {
  into.flatHealth += from.flatHealth;
  into.healthPct += from.healthPct;
  into.bonusHealth += from.bonusHealth;
  into.dmgPct += from.dmgPct;
  into.protocolDmgLevelPct += from.protocolDmgLevelPct;
  into.roundStartDmgPct += from.roundStartDmgPct;
  into.healPct += from.healPct;
  into.protocolHealLevelPct += from.protocolHealLevelPct;
  into.roundStartHealPct += from.roundStartHealPct;
  into.attackSpeedPct += from.attackSpeedPct;
  into.ultChargePct += from.ultChargePct;
  into.ultEnergyRoundStartPct += from.ultEnergyRoundStartPct;
  into.lifestealPct += from.lifestealPct;
  into.lostHealthRegenPct += from.lostHealthRegenPct;
  into.lastStandDamagePct += from.lastStandDamagePct;
  into.vulnerabilityPct += from.vulnerabilityPct;
  into.healingAsDamagePct += from.healingAsDamagePct;
  into.overflowToBonusHealthPct += from.overflowToBonusHealthPct;
  for (const f of from.damageTakenFactors) into.damageTakenFactors.push(f);
  for (const e of from.effects) into.effects.add(e);
}

// ---------------------------------------------------------------------------
// Role counts + scope
// ---------------------------------------------------------------------------

function roleCountsOf(lineup: readonly string[]): Record<Role, number> {
  const counts: Record<Role, number> = { vanguard: 0, duelist: 0, strategist: 0 };
  for (const id of lineup) counts[heroById(id).role]++;
  return counts;
}

function uniqueRoleCountOf(roleCounts: Readonly<Record<Role, number>>): number {
  return (Object.values(roleCounts) as number[]).filter((n) => n > 0).length;
}

function scopeMultiplier(
  module: { readonly scope: 'flat' | 'perRoleUnit' | 'perUniqueRole'; readonly protocol: Protocol },
  roleCounts: Readonly<Record<Role, number>>,
  uniqueRoleCount: number,
): number {
  if (module.scope === 'flat') return 1;
  if (module.scope === 'perUniqueRole') return uniqueRoleCount;
  const role = PROTOCOL_ROLE[module.protocol];
  if (role === undefined) {
    throw new RangeError(`scopeMultiplier(): protocol "${module.protocol}" has no perRoleUnit role`);
  }
  return roleCounts[role];
}

// ---------------------------------------------------------------------------
// Folding a single owned Base Module into an accumulator
// ---------------------------------------------------------------------------

function accumulateModule(
  acc: Accumulator,
  owned: OwnedModule,
  roleCounts: Readonly<Record<Role, number>>,
  uniqueRoleCount: number,
): void {
  const module = moduleById(owned.moduleId);
  const disp = ownedValue(module, owned.stars); // {value, isPercent} — table lookup, never a sum
  const v = disp.value * scopeMultiplier(module, roleCounts, uniqueRoleCount);
  const roundStart =
    module.effect.includes('at round start') &&
    (module.stat === 'damage' || module.stat === 'healing' || module.stat === 'damageAndHealing');

  switch (module.stat) {
    case 'maxHealth':
      if (disp.isPercent) acc.healthPct += v;
      else acc.flatHealth += v;
      return;
    case 'bonusHealthAtRoundStart':
      acc.bonusHealth += v;
      return;
    case 'damage':
      if (roundStart) acc.roundStartDmgPct += v;
      else acc.dmgPct += v;
      return;
    case 'healing':
      if (roundStart) acc.roundStartHealPct += v;
      else acc.healPct += v;
      return;
    case 'damageAndHealing':
      if (roundStart) {
        acc.roundStartDmgPct += v;
        acc.roundStartHealPct += v;
      } else {
        acc.dmgPct += v;
        acc.healPct += v;
      }
      return;
    case 'attackSpeed':
      acc.attackSpeedPct += v;
      return;
    case 'ultCharge':
      acc.ultChargePct += v;
      return;
    case 'ultEnergyAtRoundStart':
      acc.ultEnergyRoundStartPct += v;
      return;
    case 'lifesteal':
      acc.lifestealPct += v;
      return;
    case 'lostHealthRegen':
      acc.lostHealthRegenPct += v;
      return;
    case 'lastStandDamage':
      acc.lastStandDamagePct += v;
      return;
    case 'vulnerability':
      acc.vulnerabilityPct += v;
      return;
    case 'healingAsDamage':
      acc.healingAsDamagePct += v;
      return;
    case 'overflowToBonusHealth':
      acc.overflowToBonusHealthPct += v;
      return;
    case 'damageTaken':
      acc.damageTakenFactors.push(1 - v / 100);
      return;
    case 'behavioural':
      if (module.effectId !== undefined) acc.effects.add(module.effectId);
      return;
    // enemyMaxHealth / enemyDamageOutput / enemyHealing are `target: 'enemy'` —
    // resolved separately, against the OPPOSING side's units. See `enemyDebuffTotals`.
    case 'enemyMaxHealth':
    case 'enemyDamageOutput':
    case 'enemyHealing':
      return;
  }
}

// ---------------------------------------------------------------------------
// Team-wide (protocol level bonuses + Equilibrium modules) and role-scoped
// (Fortress/Onslaught/Reboot modules) accumulators
// ---------------------------------------------------------------------------

export interface SideModules {
  readonly owned: readonly OwnedModule[];
  readonly protocolLevels: ProtocolLevels;
}

/** No modules, every protocol at level 0 — a convenience baseline for callers/tests. */
export function emptySide(): SideModules {
  return {
    owned: [],
    protocolLevels: { fortress: 0, onslaught: 0, reboot: 0, equilibrium: 0 },
  };
}

function teamWideAccumulator(
  side: SideModules,
  roleCounts: Readonly<Record<Role, number>>,
  uniqueRoleCount: number,
): Accumulator {
  const acc = newAccumulator();

  for (const protocol of PROTOCOLS) {
    const level = side.protocolLevels[protocol];
    for (let tierIndex = 0; tierIndex < level; tierIndex++) {
      const tier = PROTOCOL_TIER_BONUSES[protocol][tierIndex];
      if (tier === undefined) continue; // level exceeds the canonical 3 tiers — nothing further
      if (protocol === 'fortress') {
        acc.flatHealth += (tier as { maxHealth: number }).maxHealth;
      } else if (protocol === 'onslaught') {
        acc.protocolDmgLevelPct += (tier as { damagePct: number }).damagePct;
      } else if (protocol === 'reboot') {
        acc.protocolHealLevelPct += (tier as { healingPct: number }).healingPct;
      } else {
        const t = tier as { maxHealthPerUniqueRole: number; damageAndHealingPctPerUniqueRole: number };
        acc.flatHealth += t.maxHealthPerUniqueRole * uniqueRoleCount;
        acc.protocolDmgLevelPct += t.damageAndHealingPctPerUniqueRole * uniqueRoleCount;
        acc.protocolHealLevelPct += t.damageAndHealingPctPerUniqueRole * uniqueRoleCount;
      }
    }
  }

  for (const owned of side.owned) {
    const module = moduleById(owned.moduleId);
    if (module.protocol !== 'equilibrium' || module.target !== 'ally') continue;
    accumulateModule(acc, owned, roleCounts, uniqueRoleCount);
  }

  return acc;
}

function roleAccumulator(
  side: SideModules,
  role: Role,
  roleCounts: Readonly<Record<Role, number>>,
  uniqueRoleCount: number,
): Accumulator {
  const acc = newAccumulator();
  for (const owned of side.owned) {
    const module = moduleById(owned.moduleId);
    if (module.target !== 'ally' || module.protocol === 'equilibrium') continue;
    if (PROTOCOL_ROLE[module.protocol] !== role) continue;
    accumulateModule(acc, owned, roleCounts, uniqueRoleCount);
  }
  return acc;
}

interface EnemyDebuffTotals {
  readonly healthSuppressionPct: number;
  readonly damageInterferencePct: number;
  readonly healingSuppressionPct: number;
}

/** "Per Vanguard, enemy X" scales by the OWNING (caster) side's role counts, not the victim's. */
function enemyDebuffTotals(
  enemySide: SideModules,
  enemyRoleCounts: Readonly<Record<Role, number>>,
  enemyUniqueRoleCount: number,
): EnemyDebuffTotals {
  let healthSuppressionPct = 0;
  let damageInterferencePct = 0;
  let healingSuppressionPct = 0;
  for (const owned of enemySide.owned) {
    const module = moduleById(owned.moduleId);
    if (module.target !== 'enemy') continue;
    const v =
      ownedValue(module, owned.stars).value *
      scopeMultiplier(module, enemyRoleCounts, enemyUniqueRoleCount);
    if (module.stat === 'enemyMaxHealth') healthSuppressionPct += v;
    else if (module.stat === 'enemyDamageOutput') damageInterferencePct += v;
    else if (module.stat === 'enemyHealing') healingSuppressionPct += v;
  }
  return { healthSuppressionPct, damageInterferencePct, healingSuppressionPct };
}

// ---------------------------------------------------------------------------
// Final per-unit assembly
// ---------------------------------------------------------------------------

/** Cosmetic rounding only (6 dp) so golden snapshots don't carry float noise; no precision loss at game scale. */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function resolveOneUnit(hero: HeroFull, acc: Accumulator, enemy: EnemyDebuffTotals): ResolvedUnit {
  const healthSuppressionFactor = Math.max(0, 1 - enemy.healthSuppressionPct / 100);
  const maxHealth = round6(
    (hero.baseHealth + acc.flatHealth) * (1 + acc.healthPct / 100) * healthSuppressionFactor,
  );
  const bonusHealth = round6(acc.bonusHealth);

  const damageInterferenceFactor = Math.max(0, 1 - enemy.damageInterferencePct / 100);
  const dps = round6(
    hero.combat.dps * (1 + acc.dmgPct / 100) * (1 + acc.protocolDmgLevelPct / 100) * damageInterferenceFactor,
  );

  const healingSuppressionFactor = Math.max(0, 1 - enemy.healingSuppressionPct / 100);
  const baseHeal = hero.combat.healPerSecond ?? 0;
  const healPerSecond = round6(
    baseHeal * (1 + acc.healPct / 100) * (1 + acc.protocolHealLevelPct / 100) * healingSuppressionFactor,
  );

  const damageTakenMultiplier = round6(
    acc.damageTakenFactors.reduce((product, factor) => product * Math.max(0, factor), 1),
  );

  return {
    heroId: hero.id,
    role: hero.role,
    targeting: hero.targeting,
    baseHealth: hero.baseHealth,
    maxHealth,
    bonusHealth,
    startingHealth: round6(maxHealth + bonusHealth),
    baseDps: hero.combat.dps,
    dps,
    roundStartDamagePct: round6(acc.roundStartDmgPct),
    baseHealPerSecond: baseHeal,
    healPerSecond,
    roundStartHealingPct: round6(acc.roundStartHealPct),
    attackRange: hero.combat.attackRange,
    attackSpeed: round6(hero.combat.attackSpeed * (1 + acc.attackSpeedPct / 100)),
    moveSpeed: hero.combat.moveSpeed,
    damageTakenMultiplier,
    ultChargeRate: round6(1 + acc.ultChargePct / 100),
    ultEnergyAtRoundStartPct: round6(acc.ultEnergyRoundStartPct),
    lifestealPct: round6(acc.lifestealPct),
    lostHealthRegenPctPerSecond: round6(acc.lostHealthRegenPct),
    lastStandDamagePctPer200Lost: round6(acc.lastStandDamagePct),
    vulnerabilityOnHitPct: round6(acc.vulnerabilityPct),
    healingAsDamagePct: round6(acc.healingAsDamagePct),
    overflowToBonusHealthPct: round6(acc.overflowToBonusHealthPct),
    effects: [...acc.effects].sort(),
  };
}

/**
 * Resolve a frozen 6-hero lineup against its own owned modules/protocol levels
 * and the opposing side's (for Suppression / Interference / Healing-Suppression).
 * Role counts (for `perRoleUnit` / `perUniqueRole` scope) are taken once from
 * `lineup` / `enemyLineup` as passed — battle-start snapshots, not recomputed
 * as units die.
 */
export function resolveUnits(
  lineup: readonly string[],
  side: SideModules,
  enemyLineup: readonly string[],
  enemy: SideModules,
): ResolvedUnit[] {
  const roleCounts = roleCountsOf(lineup);
  const uniqueRoleCount = uniqueRoleCountOf(roleCounts);
  const teamAcc = teamWideAccumulator(side, roleCounts, uniqueRoleCount);

  const enemyRoleCounts = roleCountsOf(enemyLineup);
  const enemyUniqueRoleCount = uniqueRoleCountOf(enemyRoleCounts);
  const enemyDebuffs = enemyDebuffTotals(enemy, enemyRoleCounts, enemyUniqueRoleCount);

  const roleAccCache = new Map<Role, Accumulator>();
  const accForRole = (role: Role): Accumulator => {
    let a = roleAccCache.get(role);
    if (a === undefined) {
      a = roleAccumulator(side, role, roleCounts, uniqueRoleCount);
      roleAccCache.set(role, a);
    }
    return a;
  };

  return lineup.map((heroId) => {
    const hero = heroById(heroId);
    const acc = newAccumulator();
    addInto(acc, teamAcc);
    addInto(acc, accForRole(hero.role));
    return resolveOneUnit(hero, acc, enemyDebuffs);
  });
}
