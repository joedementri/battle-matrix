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
