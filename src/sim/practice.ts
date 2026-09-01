/*
 * M6 — the Practice Protocol Reward Phase (phase 4).
 *
 * Wires the GRANT / SELECTION / REFRESH / OWNERSHIP for Strengthen Modules and
 * the left-rail count (`totalStrengthen`). `strengthen.json` is an M1 skeleton
 * (empty name / effect / keybind — M10 fills those), so everything here works on
 * ids alone and INVENTS NOTHING.
 *
 * Three unpublished rules, each pinned in `authored.ts`:
 *  - STRENGTHEN_REWARD_REQUIRES_WIN  = false  → granted regardless of outcome.
 *  - STRENGTHEN_REWARD_MULTI_MODE = 'singleOfferSetSelectN' → rounds 11/16/21
 *    pay 2 as ONE offer set of three, select two (matches the string
 *    `Select N Strengthen Modules` + the single `REFRESH 1/1`).
 *  - STRENGTHEN_OFFER_SHRINK_FALLBACK = 'offerFewer' → when a lineup's eligible
 *    pool (each hero has exactly 2 modules → ≤ 12, shrunk by accumulation and
 *    hero swaps) drops below the offer size, show fewer cards rather than widen
 *    off-lineup or throw.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { PRACTICE_REWARD_COUNTS, PRACTICE_ROUNDS } from '../data/constants';
import strengthenJson from '../data/strengthen.json';
import type { StrengthenModuleSkeleton } from '../data/types';

import type { Substream } from './rng';
import { totalStrengthen } from './modules';
import type { StrengthenInventory } from './modules';

// ---------------------------------------------------------------------------
// Strengthen skeleton lookups (ids only — M10 fills name/effect/keybind)
// ---------------------------------------------------------------------------

const ROWS = strengthenJson as unknown as readonly StrengthenModuleSkeleton[];
const HERO_OF: ReadonlyMap<string, string> = new Map(ROWS.map((r) => [r.id, r.heroId]));

const IDS_BY_HERO: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const r of ROWS) {
    const list = m.get(r.heroId) ?? [];
    list.push(r.id);
    m.set(r.heroId, list);
  }
  for (const [k, v] of m) m.set(k, v.slice().sort());
  return m;
})();

/** The hero a Strengthen Module id belongs to (its slot is fixed in the data). */
export function strengthenHeroOf(moduleId: string): string {
  const h = HERO_OF.get(moduleId);
  if (h === undefined) throw new RangeError(`strengthenHeroOf(): unknown Strengthen id "${moduleId}"`);
  return h;
}

/** Both of a hero's Strengthen Module ids, sorted. */
export function strengthenIdsForHero(heroId: string): readonly string[] {
  return IDS_BY_HERO.get(heroId) ?? [];
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/** Every Strengthen id a player holds — equipped on a hero OR loose in the pool. */
export function strengthenOwnedIds(inv: StrengthenInventory): string[] {
  const out: string[] = [...inv.selectable];
  for (const list of Object.values(inv.equipped)) out.push(...list);
  return out;
}

// ---------------------------------------------------------------------------
// The reward offer state
// ---------------------------------------------------------------------------

/** Cards shown per Practice round (rounds 11/16/21 still show 3 and pick 2). */
export const STRENGTHEN_OFFER_SIZE = 3;

export interface StrengthenRewardState {
  readonly round: number;
  /** How many picks this round grants (`PRACTICE_REWARD_COUNTS`). */
  readonly needed: number;
  /** ≤ `STRENGTHEN_OFFER_SIZE` Strengthen ids; fewer only via the shrink fallback. */
  readonly offers: readonly string[];
  /** 0 or 1 — the single free `REFRESH 1/1`. */
  readonly refreshesUsed: number;
  readonly picks: readonly string[];
}

/** Eligible Strengthen ids: for a hero in the current lineup, and not already owned. */
function candidatePool(lineup: readonly string[], ownedIds: readonly string[]): string[] {
  const owned = new Set(ownedIds);
  const pool: string[] = [];
  for (const heroId of lineup) {
    for (const id of strengthenIdsForHero(heroId)) {
      if (!owned.has(id)) pool.push(id);
    }
  }
  return pool;
}

function drawOffers(lineup: readonly string[], ownedIds: readonly string[], rng: Substream): string[] {
  // STRENGTHEN_OFFER_SHRINK_FALLBACK = 'offerFewer': min(size, poolSize).
  return rng.shuffle(candidatePool(lineup, ownedIds)).slice(0, STRENGTHEN_OFFER_SIZE);
}

export function openStrengthenReward(
  round: number,
  needed: number,
  lineup: readonly string[],
  ownedIds: readonly string[],
  rng: Substream,
): StrengthenRewardState {
  return { round, needed, offers: drawOffers(lineup, ownedIds, rng), refreshesUsed: 0, picks: [] };
}

export function canRefreshStrengthenReward(state: StrengthenRewardState): boolean {
  return state.refreshesUsed < 1;
}

/** The one free `REFRESH 1/1`. A second call is a no-op (returns the state unchanged). */
export function refreshStrengthenReward(
  state: StrengthenRewardState,
  lineup: readonly string[],
  ownedIds: readonly string[],
  rng: Substream,
): StrengthenRewardState {
  if (!canRefreshStrengthenReward(state)) return state;
  // Exclude picks-so-far too, so a refresh never re-offers something already taken.
  const exclude = [...ownedIds, ...state.picks];
  return { ...state, offers: drawOffers(lineup, exclude, rng), refreshesUsed: 1 };
}

/** Record a pick if it is a current offer, not already picked, and room remains. */
export function pickStrengthenReward(
  state: StrengthenRewardState,
  moduleId: string,
): StrengthenRewardState {
  if (state.picks.length >= state.needed) return state;
  if (!state.offers.includes(moduleId)) return state;
  if (state.picks.includes(moduleId)) return state;
  return { ...state, picks: [...state.picks, moduleId] };
}

/** Fill any shortfall deterministically from the current offers, in offer order. */
export function autoFillStrengthenReward(state: StrengthenRewardState): StrengthenRewardState {
  if (state.picks.length >= state.needed) return state;
  const picks = [...state.picks];
  for (const id of state.offers) {
    if (picks.length >= state.needed) break;
    if (!picks.includes(id)) picks.push(id);
  }
  return { ...state, picks };
}

// ---------------------------------------------------------------------------
// Grant
// ---------------------------------------------------------------------------

/**
 * Apply reward picks to a Strengthen inventory: each picked module equips to its
 * own hero (always in the current lineup — offers are scoped that way). Returns a
 * NEW inventory; `totalStrengthen` rises by exactly `pickedModuleIds.length`.
 */
export function grantStrengthenPicks(
  inv: StrengthenInventory,
  pickedModuleIds: readonly string[],
): StrengthenInventory {
  const equipped: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(inv.equipped)) equipped[k] = [...v];
  for (const id of pickedModuleIds) {
    const heroId = strengthenHeroOf(id);
    const list = equipped[heroId] ?? [];
    list.push(id);
    equipped[heroId] = list;
  }
  return { equipped, selectable: [...inv.selectable] };
}

// ---------------------------------------------------------------------------
// Round → reward count
// ---------------------------------------------------------------------------

/** Strengthen picks granted on `round` (0 when `round` is not a Practice round). */
export function practiceRewardCount(round: number): number {
  const i = (PRACTICE_ROUNDS as readonly number[]).indexOf(round);
  return i >= 0 ? (PRACTICE_REWARD_COUNTS[i] ?? 0) : 0;
}

export { totalStrengthen };
