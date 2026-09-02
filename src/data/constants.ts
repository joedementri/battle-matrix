/*
 * CANONICAL constants only.
 *
 * Everything here is either in the plan's "Source fidelity ledger → CONFIRMED"
 * list (proven by a screenshot) or stated as fact elsewhere in the plan's
 * "Canonical Data" section. Nothing in this file is a guess or a fitted value —
 * those live in `authored.ts`. If a number here turns out to be wrong, the plan
 * itself was wrong.
 *
 * Data files import nothing from `ui/` or `render/`.
 */

import type { Protocol, Rarity, Role } from './types';

// ---------------------------------------------------------------------------
// Match structure
// ---------------------------------------------------------------------------

/** CONFIRMED: "6 players". */
export const PLAYER_COUNT = 6;

/** CONFIRMED: "50 starting health" — this is the Ultron Drone's health = player health. */
export const STARTING_HEALTH = 50;

/** Canonical: round `1-1` shows every player at `◇10` before any income. */
export const STARTING_TOKENS = 10;

/** CONFIRMED: "6×4 board". */
export const BOARD = { cols: 6, rows: 4 } as const;

/**
 * Canonical: each player is dealt 6 Vanguards + 6 Duelists + 6 Strategists and
 * picks 6 as their lineup; the other 12 become Reserve.
 */
export const HERO_POOL_PER_ROLE = 6;
export const LINEUP_SIZE = 6;

/** Canonical: Practice Protocol (PvE) rounds. All other rounds are Battle Protocol (PvP). */
export const PRACTICE_ROUNDS = [1, 6, 11, 16, 21] as const;

/**
 * Canonical: Strengthen Module reward count per Practice round, index-aligned to
 * `PRACTICE_ROUNDS` — 1 on rounds 1 & 6; 2 on rounds 11, 16, 21.
 */
export const PRACTICE_REWARD_COUNTS = [1, 1, 2, 2, 2] as const;

/**
 * CORRECTED by screenshots: 3 phases on a Battle (PvP) round, 4 on a Practice
 * round (a Reward Phase is appended). The HUD phase strip shows this count.
 */
export const PHASE_COUNT = { battle: 3, practice: 4 } as const;

// ---------------------------------------------------------------------------
// Token economy  (the engine is M3; only the plan-stated constants live here)
// ---------------------------------------------------------------------------

/** CONFIRMED: "base income 15" at the start of every round. */
export const BASE_INCOME = 15;

/** CONFIRMED: "interest +1 per 10 held". The +5 cap is NOT confirmed — see authored.ts. */
export const INTEREST_PER_TOKENS = 10;
export const INTEREST_RATE = 1;

/** CONFIRMED: "streak bonus caps at 4". */
export const STREAK_BONUS_CAP = 4;
/** Canonical: streak "starts at 1, +1 per consecutive result". */
export const STREAK_START = 1;
export const STREAK_STEP = 1;

/**
 * Canonical (plan's Token economy table): "+1 token per 1 health lost", granted
 * at the moment health is lost. Not itself in the screenshot-CONFIRMED list, but
 * the plan states it as fact and never flags it as uncertain.
 */
export const HEALTH_COMPENSATION_PER_HP = 1;

// ---------------------------------------------------------------------------
// Shop / module economy
// ---------------------------------------------------------------------------

/** CONFIRMED: shop draws 4 cards. */
export const SHOP_CARD_COUNT = 4;

/** CONFIRMED: "Module purchase price 5 tokens" (Common). Rare/Legendary buy is authored. */
export const COMMON_MODULE_BUY = 5;

/** CORRECTED by screenshots: `REFRESH ◇1` — refresh costs 1 token (was guessed at 2). */
export const SHOP_REFRESH_COST = 1;

/** CONFIRMED: "hero swap 5 tokens". */
export const HERO_SWAP_COST = 5;

/** Canonical: Change Hero costs 5 tokens (same as a swap). */
export const CHANGE_HERO_COST = 5;

/**
 * Canonical: Change Hero offers three role cards whose pool sizes mirror the
 * roster — 3 random Vanguards, 6 random Duelists, 3 random Strategists.
 */
export const CHANGE_HERO_OFFERS: Readonly<Record<Role, number>> = {
  vanguard: 3,
  duelist: 6,
  strategist: 3,
};

/** CONFIRMED: XP granted per module by rarity — 1 / 2 / 4. */
export const MODULE_XP: Readonly<Record<Rarity, number>> = {
  common: 1,
  rare: 2,
  legendary: 4,
};

/**
 * PLAN-SUPPLIED (M10 milestone text): Jeff the Land Shark's Strengthen Module
 * *Looting Leviathan* grants Base Modules on its OWN rarity table, keyed by how
 * many enemies its Ultimate Ability devoured, and **bypasses the derived shop
 * odds formula entirely**. The plan gives this table verbatim and it is the only
 * Strengthen numeric data the plan provides — used exactly as written. Rows are
 * `common / rare / legendary` percentages (the game calls Legendary "Epic"); the
 * "6" row covers "devour 6 or more". Wired through `modules.lootingLeviathanRarityOdds`
 * / `rollLootingLeviathanRarity`, which never touch `modules.rarityOdds`.
 */
export const LOOTING_LEVIATHAN_RARITY_TABLE: Readonly<
  Record<4 | 5 | 6, Readonly<Record<Rarity, number>>>
> = {
  4: { common: 90, rare: 8, legendary: 2 },
  5: { common: 60, rare: 30, legendary: 10 },
  6: { common: 0, rare: 70, legendary: 30 },
};

/** Canonical (Module system table): sell value by rarity — 4 / 9 / 14. */
export const MODULE_SELL: Readonly<Record<Rarity, number>> = {
  common: 4,
  rare: 9,
  legendary: 14,
};

/**
 * Canonical (Module system table): upgrade levels by rarity. Common has 6
 * upgrade stars (CONFIRMED), Rare has 3, Legendary has none (`null`, shown as
 * "—" in the plan).
 */
export const MODULE_UPGRADE_LEVELS: Readonly<Record<Rarity, number | null>> = {
  common: 6,
  rare: 3,
  legendary: null,
};

// ---------------------------------------------------------------------------
// Protocol levelling
// ---------------------------------------------------------------------------

/** CONFIRMED: protocol level thresholds — 10 / 20 / 40 XP. */
export const PROTOCOL_XP_THRESHOLDS = [10, 20, 40] as const;

/** Canonical: Level 1 unlocks Rare for that protocol. */
export const RARE_UNLOCK_LEVEL = 1;
/** Canonical: Level 2 unlocks Legendary for that protocol. Bonuses are cumulative. */
export const LEGENDARY_UNLOCK_LEVEL = 2;

/**
 * Protocol level tier bonuses, cumulative. Transcribed from the plan's "Protocol
 * level bonuses" table. Fortress (120/120/240) and Reboot (12/12/24) are in the
 * CONFIRMED list; Onslaught and Equilibrium are from the same plan table.
 *
 * Index 0 = Level 1 (10 XP), index 1 = Level 2 (20 XP), index 2 = Level 3 (40 XP).
 */
export const PROTOCOL_TIER_BONUSES: Readonly<
  Record<Protocol, readonly Readonly<Record<string, number>>[]>
> = {
  fortress: [{ maxHealth: 120 }, { maxHealth: 120 }, { maxHealth: 240 }],
  onslaught: [{ damagePct: 12 }, { damagePct: 12 }, { damagePct: 24 }],
  reboot: [{ healingPct: 12 }, { healingPct: 12 }, { healingPct: 24 }],
  equilibrium: [
    { maxHealthPerUniqueRole: 20, damageAndHealingPctPerUniqueRole: 2 },
    { maxHealthPerUniqueRole: 20, damageAndHealingPctPerUniqueRole: 2 },
    { maxHealthPerUniqueRole: 40, damageAndHealingPctPerUniqueRole: 4 },
  ],
};

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

/**
 * Canonical: the Speed Up Protocol sub-stage applies "+120 % damage" to all
 * heroes. The 2.2× multiplier used by the sim is exactly `1 + PCT / 100` — not a
 * separate number. (When Speed Up *triggers* is authored — see authored.ts.)
 */
export const SPEED_UP_DAMAGE_BONUS_PCT = 120;
export const SPEED_UP_DAMAGE_MULTIPLIER = 1 + SPEED_UP_DAMAGE_BONUS_PCT / 100;

// ---------------------------------------------------------------------------
// Combat tick — locked project decision (M5)
// ---------------------------------------------------------------------------

/**
 * Locked with the user (Context table): "2D top-down real-time deterministic
 * tick sim (30 Hz)". The whole simulation advances on this fixed integer tick;
 * there is no wall clock anywhere in `src/sim/`.
 */
export const TICK_RATE_HZ = 30;
/** Seconds per tick — the `dt` every integrator in `src/sim/combat.ts` uses. */
export const TICK_DT_SECONDS = 1 / TICK_RATE_HZ;

/**
 * Plan rule (M5 tick section): a unit re-acquires a target only after that
 * target has been out of range for **more than** 0.5 s, tracked by a per-unit
 * out-of-range timer (not a per-tick distance check).
 */
export const TARGET_REACQUIRE_GRACE_SECONDS = 0.5;

// ---------------------------------------------------------------------------
// Behavioural Base Module parameters — from the verbatim module tables (M5)
// ---------------------------------------------------------------------------
// Every magnitude below is transcribed word-for-word from the plan's "Base
// Module tables"; only the *durations expressed in ticks* are derived
// (seconds × TICK_RATE_HZ). Anything the tables leave unspecified — Rampage
// duration, the Critical Counter "near-death" fraction, the Vulnerability stack
// cap / decay — is AUTHORED and lives in `authored.ts`.

/** Critical Damage Shell: "80% damage reduction for 3s the first time their health drops below 30%". */
export const CRITICAL_DAMAGE_SHELL = {
  reductionPct: 80,
  durationSeconds: 3,
  healthFraction: 0.3,
} as const;

/** Backup Rebirth revive health: Fortress 30% · Onslaught 40% · Equilibrium 10% per unique role. */
export const BACKUP_REBIRTH_REVIVE_FRACTION = {
  fortress: 0.3,
  onslaught: 0.4,
  equilibriumPerUniqueRole: 0.1,
} as const;

/** Infinite Drive: chance an ultimate does NOT consume energy — 40% (Fortress/Onslaught/Reboot), 10% (Equilibrium). */
export const INFINITE_DRIVE_KEEP_CHANCE = {
  fortress: 0.4,
  onslaught: 0.4,
  reboot: 0.4,
  equilibrium: 0.1,
} as const;

/** Double Heal: "40% chance each heal triggers again". */
export const DOUBLE_HEAL_RETRIGGER_CHANCE = 0.4;

/** Critical Counter: "damage taken over the next 3s converts to healing". */
export const CRITICAL_COUNTER_DURATION_SECONDS = 3;

/** Annihilator Fury (Rampage): "+40% attack speed and lifesteal" (and a full heal) after each Final Hit. */
export const RAMPAGE_ATTACK_SPEED_AND_LIFESTEAL_PCT = 40;

/** Cumulative Dual Enhancement: "+1% damage & healing every second" per unique role. */
export const CUMULATIVE_DUAL_PCT_PER_SECOND_PER_ROLE = 1;

/** Initial Damage / Healing / Dual Enhancement: the window is "10s at round start". */
export const INITIAL_ROUND_WINDOW_SECONDS = 10;

/** Canonical: the six Ultron Drone colours, one picked at random per match. */
export const DRONE_COLOURS = [
  'Blue',
  'Yellow',
  'White',
  'Default',
  'Red',
  'Green',
] as const;

/** Canonical: the arena. */
export const ARENA_MAP = 'Age of Ultron: Digital Duel Grounds';
