/*
 * M8 — pure, read-only selectors for the UI layer.
 *
 * Every function here is a COMPOSITION of existing `src/sim` exports and
 * canonical data: no new game rule, no arithmetic the UI could be trusted to do
 * itself, and the only RNG is the one seed-derivation `changeHeroOfferIds`
 * genuinely needs (the offer set is random by design). It lives in `src/sim/`
 * so the purity tests and the ESLint headless override cover it, and so the UI
 * layer can hold to "format only, never derive" (the M8 enforcement grep).
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { PROTOCOL_TIER_BONUSES, PROTOCOL_XP_THRESHOLDS } from '../data/constants';
import {
  HEALTH_BAR_HP_PER_SEGMENT,
  HEALTH_BAR_MAX_SEGMENTS,
  HEALTH_BAR_MIN_SEGMENTS,
} from '../data/authored';
import type { Protocol, Role } from '../data/types';

import { changeHeroOffers, protocolLevelFromXp } from './modules';
import {
  openStrengthenReward,
  practiceRewardCount,
  refreshStrengthenReward,
  strengthenOwnedIds,
} from './practice';
import { RngStream } from './rng';
import type { StrengthenInventory } from './modules';
import type { MatchState, PlayerState } from './types';

// ---------------------------------------------------------------------------
// Left-rail XP meter — `xp / nextThreshold` + the level badge
// ---------------------------------------------------------------------------

export interface LeftRailMeter {
  readonly xp: number;
  /** 0..3 (the level badge). */
  readonly level: number;
  /** The denominator the meter shows: 10 / 20 / 40, and 40 again once maxed. */
  readonly nextThreshold: number;
  /** True once `xp >= 40`: the meter reads `xp / 40` with badge 3. */
  readonly atMax: boolean;
}

/**
 * Thresholds are `[10, 20, 40]`. Below level 3 the meter counts toward the next
 * threshold; at level 3 (`xp >= 40`) it keeps the 40 denominator and badge 3
 * (the plan's recommended reading — see the M8 report).
 */
export function leftRailMeter(xp: number): LeftRailMeter {
  const level = protocolLevelFromXp(xp);
  const idx = Math.min(level, PROTOCOL_XP_THRESHOLDS.length - 1);
  return {
    xp,
    level,
    nextThreshold: PROTOCOL_XP_THRESHOLDS[idx]!,
    atMax: level >= PROTOCOL_XP_THRESHOLDS.length,
  };
}

// ---------------------------------------------------------------------------
// Right-panel order — health descending, stable tiebreak by player id
// ---------------------------------------------------------------------------

/** Player ids ordered for the right panel: health desc, then id asc. */
export function rankByHealthDesc(players: readonly PlayerState[]): number[] {
  return players
    .map((p) => p.id)
    .sort((a, b) => {
      const ha = players[a]!.health;
      const hb = players[b]!.health;
      if (ha !== hb) return ha < hb ? 1 : -1;
      return a < b ? -1 : 1;
    });
}

// ---------------------------------------------------------------------------
// Scoreboard order — living by health desc, then eliminated by placement asc
// ---------------------------------------------------------------------------

export interface ScoreboardOrder {
  /** Player ids, best rank first. */
  readonly order: readonly number[];
  /** Rows `[0, topCutoffIndex)` sit above the top-3 divider. */
  readonly topCutoffIndex: number;
}

export function scoreboardOrder(state: MatchState): ScoreboardOrder {
  const cmpId = (a: number, b: number): number => (a < b ? -1 : 1);

  const living = state.players
    .filter((p) => p.alive)
    .map((p) => p.id)
    .sort((a, b) => {
      const ha = state.players[a]!.health;
      const hb = state.players[b]!.health;
      if (ha !== hb) return ha < hb ? 1 : -1;
      return cmpId(a, b);
    });

  const eliminated = state.players
    .filter((p) => !p.alive)
    .map((p) => p.id)
    .sort((a, b) => {
      const pa = state.players[a]!.placement ?? state.players.length;
      const pb = state.players[b]!.placement ?? state.players.length;
      if (pa !== pb) return pa < pb ? -1 : 1;
      return cmpId(a, b);
    });

  return {
    order: [...living, ...eliminated],
    topCutoffIndex: Math.min(3, state.players.length),
  };
}

// ---------------------------------------------------------------------------
// Protocol info pane — the three tier-bonus rows with the earned flag
// ---------------------------------------------------------------------------

export interface TierRow {
  /** 0-based: tier 0 = Level 1 (10 XP), tier 2 = Level 3 (40 XP). */
  readonly tierIndex: number;
  readonly earned: boolean;
  /** The raw cumulative bonus for this tier, straight from `PROTOCOL_TIER_BONUSES`. */
  readonly bonus: Readonly<Record<string, number>>;
}

export function protocolTierRows(protocol: Protocol, level: number): TierRow[] {
  return PROTOCOL_TIER_BONUSES[protocol].map((bonus, tierIndex) => ({
    tierIndex,
    earned: tierIndex < level,
    bonus,
  }));
}

// ---------------------------------------------------------------------------
// Change-Hero offers — 3 / 6 / 3 random heroes of a role, never one in the
// lineup. Deterministic per `(seed, round, nonce, role)`; the `nonce` lets the
// UI re-roll a fresh set each time the player opens the Change-Hero flow.
// ---------------------------------------------------------------------------

export function changeHeroOfferIds(
  seed: number,
  round: number,
  nonce: number,
  role: Role,
  lineup: readonly string[],
): string[] {
  const sub = new RngStream(seed >>> 0).stream(`ui:change-hero:${role}:${nonce}`, round);
  return changeHeroOffers(role, lineup, sub);
}

// ---------------------------------------------------------------------------
// Reward phase — reconstruct the human seat's Strengthen offers so the UI can
// render exactly the set `match.runRewardPhase` would show it (that set is
// computed inside `runMatch` and not persisted on `MatchState`). Uses the same
// `reward:<seat>#round` substream key and the same `practice.ts` primitives, so
// a pick raised against a rendered card is always legal there.
// ---------------------------------------------------------------------------

export interface HumanRewardOffers {
  readonly needed: number;
  readonly offers: readonly string[];
}

export function humanRewardOffers(
  seed: number,
  round: number,
  seatId: number,
  lineup: readonly string[],
  strengthen: StrengthenInventory,
  refreshed: boolean,
): HumanRewardOffers {
  const needed = practiceRewardCount(round);
  if (needed <= 0) return { needed: 0, offers: [] };
  const owned = strengthenOwnedIds(strengthen);
  const sub = new RngStream(seed >>> 0).stream(`reward:${seatId}`, round);
  let state = openStrengthenReward(round, needed, lineup, owned, sub);
  if (refreshed) state = refreshStrengthenReward(state, lineup, owned, sub);
  return { needed, offers: state.offers };
}

// ---------------------------------------------------------------------------
// M9 battle HUD — the renderer FORMATS these; it never does arithmetic on a
// health / xp / token value itself (`tests/enforce-no-arith.spec.ts` now also
// scans `src/render/**`). All of it is a pure function of a plain frame value.
// ---------------------------------------------------------------------------

export interface HealthBarModel {
  /** Total segment count for this unit's bar (a function of resolved max health). */
  readonly segments: number;
  /** Segments backed by regular health (rounded up so any sliver still lights one). */
  readonly filled: number;
  /** Extra segments backed by bonus health, drawn past `segments` in the overhealth tint. */
  readonly bonus: number;
  /** 0..1 regular-health fraction (for a continuous underlay if the renderer wants one). */
  readonly fraction: number;
}

/**
 * The segmented health bar the M9 renderer draws above every unit. Segment
 * granularity is authored (`HEALTH_BAR_HP_PER_SEGMENT`), clamped to a readable
 * band. `health` is regular health (0..maxHealth); `overhealth` is the bonus
 * pool depleted first by damage (Reserve Armor, Overflow Recharge).
 */
export function healthBarModel(
  health: number,
  overhealth: number,
  maxHealth: number,
): HealthBarModel {
  const safeMax = maxHealth > 0 ? maxHealth : 1;
  const raw = Math.round(safeMax / HEALTH_BAR_HP_PER_SEGMENT);
  const segments = Math.max(HEALTH_BAR_MIN_SEGMENTS, Math.min(HEALTH_BAR_MAX_SEGMENTS, raw));
  const clampedHealth = health < 0 ? 0 : health > safeMax ? safeMax : health;
  const fraction = clampedHealth / safeMax;
  const filled = clampedHealth <= 0 ? 0 : Math.max(1, Math.ceil(fraction * segments));
  const perSegment = safeMax / segments;
  const bonus = overhealth > 0 ? Math.ceil(overhealth / perSegment) : 0;
  return { segments, filled, bonus, fraction };
}

/** Ult-charge bar fill, 0..1. A unit casts at `>= 1`; the bar clamps to full. */
export function ultChargeFraction(ultEnergy: number): number {
  if (!(ultEnergy > 0)) return 0;
  return ultEnergy >= 1 ? 1 : ultEnergy;
}

/** Linear interpolation for renderer-side position tweening. Never fed back into the sim. */
export function lerp(from: number, to: number, alpha: number): number {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return from + (to - from) * a;
}
