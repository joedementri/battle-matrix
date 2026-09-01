/*
 * M6 — Galacta Bots: the Practice Protocol (PvE) opponent.
 *
 * Galacta Bots are TEAM-AGNOSTIC `Unit`s: `combat.ts` builds them onto side B
 * exactly like heroes, so targeting, movement, attacks, ults and death checks
 * all just work with no special-casing. The only bot-specific bit is a flag
 * (`BattleUnit.isGalactaBot`) carried in state for M9's distinct monster art.
 * They own no protocols and no modules, so their `ResolvedUnit` is built here
 * directly rather than through `stats.ts`.
 *
 * Wave composition per Practice round is AUTHORED in `src/data/galacta.json`
 * (pointer: `authored.ts` → `AUTHORED_ELSEWHERE.galactaWaves`); the per-round
 * health / dps scaling is AUTHORED in `authored.ts` (`GALACTA_*_SCALE_PER_ROUND`).
 * Rounds 1 & 6 are tuned to be comfortable for a reasonable lineup; 16 & 21 are
 * genuinely threatening. M11 re-tunes against the win-rate gate.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { PRACTICE_ROUNDS } from '../data/constants';
import { GALACTA_DPS_SCALE_PER_ROUND, GALACTA_HEALTH_SCALE_PER_ROUND } from '../data/authored';
import galactaJson from '../data/galacta.json';
import type { GalactaArchetype, GalactaData, Role, Targeting, UltArchetype } from '../data/types';

import type { ResolvedUnit } from './stats';

const DATA = galactaJson as unknown as GalactaData;

/** One concrete Galacta Bot to spawn (an archetype with per-round scaling baked in). */
export interface GalactaUnitSpec {
  /** archetype id, e.g. "galacta-swarm" — also the M9 monster-art key. */
  readonly kind: string;
  readonly role: Role;
  readonly targeting: Targeting;
  readonly ultArchetype: UltArchetype;
  readonly maxHealth: number;
  readonly dps: number;
  readonly healPerSecond: number;
  readonly attackRange: number;
  readonly attackSpeed: number;
  readonly moveSpeed: number;
}

/** Cosmetic 6-dp rounding so golden snapshots don't carry float noise. */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * Largest Practice-round tier whose round is `<= round` (index into
 * `PRACTICE_ROUNDS`, clamped at 0). `galactaWave(3)` → tier 0. Defensive: the
 * resolver only ever calls this on a Practice round, but M5's PvE tests pass a
 * non-Practice `round`, so this never throws for `round >= 1`.
 */
function tierIndexForRound(round: number): number {
  let idx = 0;
  for (let i = 0; i < PRACTICE_ROUNDS.length; i++) {
    const r = (PRACTICE_ROUNDS as readonly number[])[i];
    if (r !== undefined && round >= r) idx = i;
  }
  return idx;
}

/** The Galacta Bot wave for `round`, composition + per-round health/dps scaling. */
export function galactaWave(round: number): GalactaUnitSpec[] {
  const tier = tierIndexForRound(round);
  const wave = DATA.waves[tier];
  if (wave === undefined) throw new RangeError(`galactaWave(): no wave for tier ${tier}`);

  const hpScale = 1 + GALACTA_HEALTH_SCALE_PER_ROUND * (round - 1);
  const dpsScale = 1 + GALACTA_DPS_SCALE_PER_ROUND * (round - 1);

  const out: GalactaUnitSpec[] = [];
  for (const arch of DATA.archetypes) {
    const count = wave.units[arch.id] ?? 0;
    for (let i = 0; i < count; i++) {
      out.push({
        kind: arch.id,
        role: arch.role,
        targeting: arch.targeting,
        ultArchetype: arch.ult.archetype,
        maxHealth: round6(arch.baseHealth * hpScale),
        dps: round6(arch.combat.dps * dpsScale),
        healPerSecond: round6((arch.combat.healPerSecond ?? 0) * dpsScale),
        attackRange: arch.combat.attackRange,
        attackSpeed: arch.combat.attackSpeed,
        moveSpeed: arch.combat.moveSpeed,
      });
    }
  }
  return out;
}

/** Build the `ResolvedUnit` for a Galacta Bot — identity everywhere a hero would
 *  carry module-sourced bonuses (a bot has none). */
export function resolvedFromGalacta(spec: GalactaUnitSpec): ResolvedUnit {
  return {
    heroId: spec.kind,
    role: spec.role,
    targeting: spec.targeting,
    baseHealth: spec.maxHealth,
    maxHealth: spec.maxHealth,
    bonusHealth: 0,
    startingHealth: spec.maxHealth,
    baseDps: spec.dps,
    dps: spec.dps,
    roundStartDamagePct: 0,
    baseHealPerSecond: spec.healPerSecond,
    healPerSecond: spec.healPerSecond,
    roundStartHealingPct: 0,
    attackRange: spec.attackRange,
    attackSpeed: spec.attackSpeed,
    moveSpeed: spec.moveSpeed,
    damageTakenMultiplier: 1,
    ultChargeRate: 1,
    ultEnergyAtRoundStartPct: 0,
    lifestealPct: 0,
    lostHealthRegenPctPerSecond: 0,
    lastStandDamagePctPer200Lost: 0,
    vulnerabilityOnHitPct: 0,
    healingAsDamagePct: 0,
    overflowToBonusHealthPct: 0,
    effects: [],
  };
}

/** All archetype ids in declaration order (for tests / M9 art lookups). */
export const GALACTA_ARCHETYPE_IDS: readonly string[] = DATA.archetypes.map(
  (a: GalactaArchetype) => a.id,
);
