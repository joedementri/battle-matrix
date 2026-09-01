/*
 * M5 — behavioural Base Module hooks: the Rare and Legendary lines that need a
 * *combat* effect, not just a resolved number.
 *
 * Two kinds of module land here:
 *  - NUMERIC lines already folded into `ResolvedUnit` by M4's `stats.ts`
 *    (Last Stand, Steady Recovery, Initial windows, Vulnerability Mark, Life
 *    Steal, Overflow Recharge, Deadly Healing). This file turns those numbers
 *    into per-tick / per-hit behaviour; `combat.ts` calls the helpers below.
 *  - BEHAVIOURAL Legendary lines dispatched by `effectId` (Critical Damage
 *    Shell, Backup Rebirth ×3, Infinite Drive ×4, Annihilator Fury, Double Heal,
 *    Critical Counter, Cumulative Dual Enhancement). `BEHAVIOURAL_HANDLERS`
 *    registers every one; `missingBehaviouralHandlers()` is the completeness net.
 *
 * Where the underlying Rivals mechanic is deeper than this 2D sim models, the
 * closest faithful analogue is implemented and annotated in the handler's
 * `approximation` field (same discipline M10 asks for).
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 * Every function here is a deterministic function of its inputs; the only RNG in
 * combat (Infinite Drive / Double Heal rolls) is drawn from `ctx.rng` by
 * `combat.ts`, using the chances this module reports.
 */

import {
  BACKUP_REBIRTH_REVIVE_FRACTION,
  CRITICAL_COUNTER_DURATION_SECONDS,
  CRITICAL_DAMAGE_SHELL,
  CUMULATIVE_DUAL_PCT_PER_SECOND_PER_ROLE,
  INFINITE_DRIVE_KEEP_CHANCE,
  TICK_DT_SECONDS,
  TICK_RATE_HZ,
} from '../data/constants';
import {
  CRITICAL_COUNTER_NEAR_DEATH_FRACTION,
  VULNERABILITY_DURATION_TICKS,
  VULNERABILITY_MAX_STACKS,
} from '../data/authored';
import modulesJson from '../data/modules.json';
import type { BaseModule } from '../data/types';

import type { BattleField, BattleUnit } from './combat';

// ---------------------------------------------------------------------------
// Effect membership
// ---------------------------------------------------------------------------

/** True when this unit carries the given Legendary `effectId` (from `ResolvedUnit.effects`). */
export function hasEffect(u: BattleUnit, effectId: string): boolean {
  return u.resolved.effects.includes(effectId);
}

// ---------------------------------------------------------------------------
// Numeric-line behaviour (values already resolved by stats.ts)
// ---------------------------------------------------------------------------

/** Health actually lost = (max + starting bonus) − current total, floored at 0. */
function healthLost(u: BattleUnit): number {
  return Math.max(0, u.startTotalHealth - (u.health + u.overhealth));
}

/**
 * Last Stand Damage Enhancement — "+X% damage per 200 health lost".
 * APPROXIMATED as a continuous ramp (`healthLost / 200` rather than
 * `floor(healthLost / 200)`) for a smoother sim; the module text reads as steps.
 */
export function lastStandMultiplier(u: BattleUnit): number {
  const pctPer200 = u.resolved.lastStandDamagePctPer200Lost;
  if (pctPer200 <= 0) return 1;
  return 1 + (healthLost(u) / 200) * (pctPer200 / 100);
}

/** Steady Recovery — "restore X% of lost health per second", as a per-tick heal amount. */
export function steadyRecoveryHealPerTick(u: BattleUnit): number {
  const pct = u.resolved.lostHealthRegenPctPerSecond;
  if (pct <= 0) return 0;
  const lost = healthLost(u);
  if (lost <= 0) return 0;
  return lost * (pct / 100) * TICK_DT_SECONDS;
}

/**
 * Cumulative Dual Enhancement — "+1% damage & healing every second" per unique
 * role. APPROXIMATED as a continuous ramp: elapsed seconds × unique roles × 1%.
 */
export function cumulativeDualMultiplier(field: BattleField, u: BattleUnit): number {
  if (!hasEffect(u, 'equilibrium-cumulative-dual-enhancement')) return 1;
  const seconds = field.tick * TICK_DT_SECONDS;
  const roles = field.sideUniqueRoles[u.side];
  return 1 + (seconds * roles * CUMULATIVE_DUAL_PCT_PER_SECOND_PER_ROLE) / 100;
}

/**
 * Vulnerability Mark — a marking primary hit adds one stack (capped) and
 * refreshes the whole set's decay timer. Total added damage-taken % is
 * `stacks × perStackPct`; the applying module's per-stack value wins.
 */
export function applyVulnStack(target: BattleUnit, perStackPct: number): void {
  target.vulnStacks = Math.min(VULNERABILITY_MAX_STACKS, target.vulnStacks + 1);
  target.vulnPerStackPct = perStackPct;
  target.vulnTicks = VULNERABILITY_DURATION_TICKS;
}

// ---------------------------------------------------------------------------
// Behavioural Legendary triggers (checked from combat.ts after a hit lands)
// ---------------------------------------------------------------------------

/**
 * Critical Damage Shell — the FIRST time a Vanguard's health drops below 30%,
 * grant 80% damage reduction for 3s. The triggering hit lands at full damage;
 * the shield covers subsequent hits.
 */
export function maybeTriggerCriticalDamageShell(u: BattleUnit): void {
  if (u.criticalDamageShellUsed || !hasEffect(u, 'fortress-critical-damage-shell')) return;
  if (u.health > 0 && u.health < CRITICAL_DAMAGE_SHELL.healthFraction * u.maxHealth) {
    u.criticalDamageShellUsed = true;
    u.criticalDamageShellTicks = CRITICAL_DAMAGE_SHELL.durationSeconds * TICK_RATE_HZ;
  }
}

/**
 * Critical Counter — the FIRST time a Strategist enters "near-death", damage
 * taken over the next 3s converts to healing. APPROXIMATED: "near-death" is
 * undefined in the text, so it mirrors Critical Damage Shell's 30%; the
 * converted damage heals 1:1.
 */
export function maybeTriggerCriticalCounter(u: BattleUnit): void {
  if (u.criticalCounterUsed || !hasEffect(u, 'reboot-critical-counter')) return;
  if (u.health > 0 && u.health < CRITICAL_COUNTER_NEAR_DEATH_FRACTION * u.maxHealth) {
    u.criticalCounterUsed = true;
    u.criticalCounterTicks = CRITICAL_COUNTER_DURATION_SECONDS * TICK_RATE_HZ;
  }
}

/**
 * Backup Rebirth revive fraction for this unit (0 = no such module). Fortress
 * 30%, Onslaught 40%, Equilibrium 10% per unique role (capped at 100%). If a
 * unit somehow carries two variants, the most generous wins — still one revive.
 */
export function backupRebirthFraction(u: BattleUnit, sideUniqueRoles: number): number {
  let f = 0;
  if (hasEffect(u, 'fortress-backup-rebirth')) {
    f = Math.max(f, BACKUP_REBIRTH_REVIVE_FRACTION.fortress);
  }
  if (hasEffect(u, 'onslaught-backup-rebirth')) {
    f = Math.max(f, BACKUP_REBIRTH_REVIVE_FRACTION.onslaught);
  }
  if (hasEffect(u, 'equilibrium-backup-rebirth')) {
    f = Math.max(
      f,
      Math.min(1, BACKUP_REBIRTH_REVIVE_FRACTION.equilibriumPerUniqueRole * sideUniqueRoles),
    );
  }
  return f;
}

/**
 * Infinite Drive — chance an ultimate does NOT consume its energy. 40% for
 * Fortress / Onslaught / Reboot, 10% for Equilibrium; the most generous present
 * variant wins. `combat.ts` rolls this against `ctx.rng` at cast time.
 */
export function infiniteDriveKeepChance(u: BattleUnit): number {
  let c = 0;
  if (hasEffect(u, 'fortress-infinite-drive')) c = Math.max(c, INFINITE_DRIVE_KEEP_CHANCE.fortress);
  if (hasEffect(u, 'onslaught-infinite-drive')) c = Math.max(c, INFINITE_DRIVE_KEEP_CHANCE.onslaught);
  if (hasEffect(u, 'reboot-infinite-drive')) c = Math.max(c, INFINITE_DRIVE_KEEP_CHANCE.reboot);
  if (hasEffect(u, 'equilibrium-infinite-drive')) {
    c = Math.max(c, INFINITE_DRIVE_KEEP_CHANCE.equilibrium);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Behavioural handler registry + completeness net
// ---------------------------------------------------------------------------

export interface BehaviouralHandler {
  readonly effectId: string;
  /** One line: what this effect does in the sim. */
  readonly summary: string;
  /**
   * Non-null when the sim implements the closest faithful analogue rather than
   * the literal Rivals mechanic — states what was approximated.
   */
  readonly approximation: string | null;
  /** Where in the sim the effect is wired (for the reader / a future audit). */
  readonly wiredIn: string;
}

export const BEHAVIOURAL_HANDLERS: Readonly<Record<string, BehaviouralHandler>> = {
  'fortress-critical-damage-shell': {
    effectId: 'fortress-critical-damage-shell',
    summary: '80% damage reduction for 3s the first time health drops below 30%',
    approximation: null,
    wiredIn: 'effects.maybeTriggerCriticalDamageShell + combat.applyOneDamage reduction chain',
  },
  'fortress-backup-rebirth': {
    effectId: 'fortress-backup-rebirth',
    summary: 'revive once at 30% health on first KO',
    approximation: null,
    wiredIn: 'effects.backupRebirthFraction + combat.deathChecks',
  },
  'onslaught-backup-rebirth': {
    effectId: 'onslaught-backup-rebirth',
    summary: 'revive once at 40% health on first KO',
    approximation: null,
    wiredIn: 'effects.backupRebirthFraction + combat.deathChecks',
  },
  'equilibrium-backup-rebirth': {
    effectId: 'equilibrium-backup-rebirth',
    summary: 'revive once at 10% health per unique role on first KO',
    approximation: 'revive fraction = 0.1 × unique roles, capped at 100%',
    wiredIn: 'effects.backupRebirthFraction + combat.deathChecks',
  },
  'fortress-infinite-drive': {
    effectId: 'fortress-infinite-drive',
    summary: '40% chance an ultimate does not consume energy',
    approximation: null,
    wiredIn: 'effects.infiniteDriveKeepChance + combat.maybeCastUlt (rolled from ctx.rng)',
  },
  'onslaught-infinite-drive': {
    effectId: 'onslaught-infinite-drive',
    summary: '40% chance an ultimate does not consume energy',
    approximation: null,
    wiredIn: 'effects.infiniteDriveKeepChance + combat.maybeCastUlt (rolled from ctx.rng)',
  },
  'reboot-infinite-drive': {
    effectId: 'reboot-infinite-drive',
    summary: '40% chance an ultimate does not consume energy',
    approximation: null,
    wiredIn: 'effects.infiniteDriveKeepChance + combat.maybeCastUlt (rolled from ctx.rng)',
  },
  'equilibrium-infinite-drive': {
    effectId: 'equilibrium-infinite-drive',
    summary: '10% chance an ultimate does not consume energy',
    approximation: null,
    wiredIn: 'effects.infiniteDriveKeepChance + combat.maybeCastUlt (rolled from ctx.rng)',
  },
  'onslaught-annihilator-fury': {
    effectId: 'onslaught-annihilator-fury',
    summary: 'after a Final Hit: full heal, +40% attack speed and lifesteal (Rampage)',
    approximation: 'Rampage lasts 5s (module text gives no duration); it refreshes on each kill',
    wiredIn: 'combat.deathChecks (killer branch) + combat.currentAttackIntervalTicks + combat.applyOneDamage lifesteal',
  },
  'reboot-double-heal': {
    effectId: 'reboot-double-heal',
    summary: '40% chance each heal triggers again',
    approximation: 'a single re-trigger per heal, not recursive',
    wiredIn: 'combat.doSustainedHeal (rolled from ctx.rng)',
  },
  'reboot-critical-counter': {
    effectId: 'reboot-critical-counter',
    summary: 'first near-death: damage taken over the next 3s converts to healing',
    approximation: 'near-death = health < 30% (undefined in text); converted damage heals 1:1',
    wiredIn: 'effects.maybeTriggerCriticalCounter + combat.applyOneDamage (conversion branch)',
  },
  'equilibrium-cumulative-dual-enhancement': {
    effectId: 'equilibrium-cumulative-dual-enhancement',
    summary: '+1% damage & healing per second per unique role',
    approximation: 'continuous ramp: elapsed seconds × unique roles × 1%',
    wiredIn: 'effects.cumulativeDualMultiplier + combat damage/heal amplifiers',
  },
};

/** Every behavioural `effectId` present in the M1 module data, sorted. */
export function behaviouralEffectIdsInData(): string[] {
  return (modulesJson as unknown as readonly BaseModule[])
    .filter((m) => m.stat === 'behavioural' && typeof m.effectId === 'string')
    .map((m) => m.effectId as string)
    .sort();
}

/** Behavioural `effectId`s in the data with no registered handler — must be empty. */
export function missingBehaviouralHandlers(): string[] {
  return behaviouralEffectIdsInData()
    .filter((id) => !Object.prototype.hasOwnProperty.call(BEHAVIOURAL_HANDLERS, id))
    .sort();
}

/** Registered handlers pointing at an `effectId` that no longer exists in the data. */
export function staleBehaviouralHandlers(): string[] {
  const inData = new Set(behaviouralEffectIdsInData());
  return Object.keys(BEHAVIOURAL_HANDLERS)
    .filter((id) => !inData.has(id))
    .sort();
}
