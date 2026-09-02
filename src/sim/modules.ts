/*
 * M4 — Module system: rarity odds, the 4-card shop draw, buy/upgrade/sell,
 * protocol XP -> level, lock/refresh, the two value-display rules, Change Hero
 * offers, and the swap-out Strengthen-Module conversion.
 *
 * NUMBERS: every canonical / derived / authored value imports from
 * `src/data/constants` or `src/data/authored`. Nothing numeric is retyped here
 * except a small M4-local knob (the reroll attempt budget), mirroring how
 * `match.ts` keeps `PAIRING_MAX_ATTEMPTS` local.
 *
 * FIVE UNPUBLISHED DECISIONS, each pinned by an `authored.ts` constant (see
 * that file's doc comments for the falsifier):
 *   1. MODULE_DRAW_PROTOCOL_SELECTION — uniform protocol, then uniform module.
 *   2. MODULE_DRAW_DISTINCT_IN_SET — no duplicate module id in one 4-card draw.
 *   3. MODULE_DRAW_EXCLUDE_MAXED — a maxed owned module never redraws.
 *   4. MODULE_SELL_SCALES_PER_STAR — refund/XP-removal scale by stars owned.
 *   5. SHOP_LOCK_BEHAVIOUR — LOCK is shop-wide, carries over once, then clears.
 *
 * THE TRAP: `ownedValue` is `values[level - 1]` — a table LOOKUP, never a sum.
 * `shopCardValue` is always `values[0]`, regardless of owned stars.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import {
  CHANGE_HERO_OFFERS,
  COMMON_MODULE_BUY,
  LEGENDARY_UNLOCK_LEVEL,
  LOOTING_LEVIATHAN_RARITY_TABLE,
  MODULE_SELL,
  MODULE_XP,
  PROTOCOL_XP_THRESHOLDS,
  RARE_UNLOCK_LEVEL,
  SHOP_CARD_COUNT,
} from '../data/constants';
import {
  MODULE_BUY_LEGENDARY,
  MODULE_BUY_RARE,
  MODULE_DRAW_DISTINCT_IN_SET,
  MODULE_DRAW_EXCLUDE_MAXED,
  MODULE_SELL_SCALES_PER_STAR,
  RARITY_ODDS_LEGENDARY_COEFF,
  RARITY_ODDS_RARE_COEFF,
} from '../data/authored';
import modulesJson from '../data/modules.json';
import heroesJson from '../data/heroes.json';
import type { BaseModule, Protocol, Rarity, Role } from '../data/types';

import type { Substream } from './rng';

// ---------------------------------------------------------------------------
// M4-local knobs (not values M1 owns)
// ---------------------------------------------------------------------------

/**
 * Bounded rerolls when the distinct-in-set rule (decision 2) collides with an
 * already-picked module id. Mirrors `match.ts`'s `PAIRING_MAX_ATTEMPTS` — draws
 * at most this many candidates before falling back to the documented
 * deterministic scan (see `authored.ts` -> MODULE_DRAW_DISTINCT_IN_SET).
 */
const MAX_REROLLS_PER_CARD = 40;

// ---------------------------------------------------------------------------
// Module lookup
// ---------------------------------------------------------------------------

export const PROTOCOLS: readonly Protocol[] = ['fortress', 'onslaught', 'reboot', 'equilibrium'];

const MODULES = modulesJson as unknown as readonly BaseModule[];
const MODULE_BY_ID = new Map<string, BaseModule>(MODULES.map((m) => [m.id, m]));

export function moduleById(id: string): BaseModule {
  const m = MODULE_BY_ID.get(id);
  if (m === undefined) throw new RangeError(`moduleById(): unknown module id "${id}"`);
  return m;
}

/** Max stars a module can reach — `values.length` (the Fortress Damage Enhancement quirk is 4, not 6). */
export function maxStarsOf(module: BaseModule): number {
  return module.values.length;
}

// ---------------------------------------------------------------------------
// Value display — the two rules, kept as separate one-line lookups
// ---------------------------------------------------------------------------

export interface ModuleValueDisplay {
  readonly value: number;
  readonly isPercent: boolean;
}

/** A module's effect template marks a percentage stat with a literal `{value}%`. */
function isPercentModule(module: BaseModule): boolean {
  return module.effect.includes('{value}%');
}

/**
 * Shop card value — ALWAYS the level-1 base value, regardless of how many
 * stars the player already owns. `values[0]`, never anything else.
 */
export function shopCardValue(module: BaseModule): ModuleValueDisplay {
  const v = module.values[0];
  if (v === undefined) throw new RangeError(`shopCardValue(): ${module.id} has an empty values table`);
  return { value: v, isPercent: isPercentModule(module) };
}

/**
 * Owned-Modules-pane value — the CUMULATIVE table value at the owned star
 * level. `values[level - 1]` — a table lookup, never a sum of the table.
 */
export function ownedValue(module: BaseModule, level: number): ModuleValueDisplay {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`ownedValue(): level must be a positive integer, got ${level}`);
  }
  const idx = Math.min(level, module.values.length) - 1;
  const v = module.values[idx];
  if (v === undefined) throw new RangeError(`ownedValue(): ${module.id} has an empty values table`);
  return { value: v, isPercent: isPercentModule(module) };
}

/** `90.0`, `20.0 %` — one decimal place, a space before a trailing `%`. */
export function formatModuleValue(display: ModuleValueDisplay): string {
  return `${display.value.toFixed(1)}${display.isPercent ? ' %' : ''}`;
}

// ---------------------------------------------------------------------------
// Protocol XP -> level
// ---------------------------------------------------------------------------

export type ProtocolXp = Record<Protocol, number>;
export type ProtocolLevels = Readonly<Record<Protocol, number>>;

export function zeroProtocolXp(): ProtocolXp {
  return { fortress: 0, onslaught: 0, reboot: 0, equilibrium: 0 };
}

/** `[10, 20, 40]` -> level 0..3. Every star's XP counts again on an upgrade. */
export function protocolLevelFromXp(xp: number): number {
  let level = 0;
  for (const threshold of PROTOCOL_XP_THRESHOLDS) {
    if (xp >= threshold) level++;
  }
  return level;
}

export function levelsFromXp(xp: Readonly<ProtocolXp>): ProtocolLevels {
  const out: Record<Protocol, number> = { fortress: 0, onslaught: 0, reboot: 0, equilibrium: 0 };
  for (const p of PROTOCOLS) out[p] = protocolLevelFromXp(xp[p]);
  return out;
}

// ---------------------------------------------------------------------------
// Rarity odds — the DERIVED formula
// ---------------------------------------------------------------------------

export interface RarityOdds {
  readonly common: number;
  readonly rare: number;
  readonly legendary: number;
}

/**
 * `rare% = 4.0 × Σ(all four protocol levels)`, `legendary% = 1.5 × count(≥ L2)`,
 * `common% = 100 − rare% − legendary%`, clamped at 0. Exact fit on all three
 * observed odds rows (100/0/0, 86.5/12/1.5, 81/16/3).
 */
export function rarityOdds(levels: ProtocolLevels): RarityOdds {
  const sumLevels = PROTOCOLS.reduce((s, p) => s + levels[p], 0);
  const atLeastL2 = PROTOCOLS.filter((p) => levels[p] >= LEGENDARY_UNLOCK_LEVEL).length;
  const rare = RARITY_ODDS_RARE_COEFF * sumLevels;
  const legendary = RARITY_ODDS_LEGENDARY_COEFF * atLeastL2;
  if (rare + legendary > 100) {
    throw new RangeError(
      `rarityOdds(): rare% (${rare}) + legendary% (${legendary}) exceeds 100% — unreachable for the canonical level range [0,3]`,
    );
  }
  return { common: Math.max(0, 100 - rare - legendary), rare, legendary };
}

/** Level ≥1 unlocks Rare for a protocol; level ≥2 unlocks Legendary. Common needs no level. */
export function protocolsEligibleFor(rarity: Rarity, levels: ProtocolLevels): Protocol[] {
  if (rarity === 'common') return [...PROTOCOLS];
  const minLevel = rarity === 'rare' ? RARE_UNLOCK_LEVEL : LEGENDARY_UNLOCK_LEVEL;
  return PROTOCOLS.filter((p) => levels[p] >= minLevel);
}

// ---------------------------------------------------------------------------
// Jeff the Land Shark — *Looting Leviathan* (M10)
//
// This Strengthen Module grants Base Modules on its OWN rarity table, keyed by
// how many enemies Jeff's ult devoured, and BYPASSES the derived shop-odds
// formula entirely. It never calls `rarityOdds()` and never touches a shop
// draw — its own path, its own (caller-supplied) substream. The table is
// plan-supplied (`LOOTING_LEVIATHAN_RARITY_TABLE`) and used exactly as written.
// ---------------------------------------------------------------------------

/** Clamp a devour count to the table's `{4, 5, 6}` tiers (6 = "6 or more"). */
function lootingLeviathanTier(devoured: number): 4 | 5 | 6 {
  if (devoured <= 4) return 4;
  if (devoured === 5) return 5;
  return 6;
}

/** The `common / rare / legendary` percentages for a devour count. Does NOT touch `rarityOdds`. */
export function lootingLeviathanRarityOdds(devoured: number): RarityOdds {
  return LOOTING_LEVIATHAN_RARITY_TABLE[lootingLeviathanTier(devoured)];
}

/**
 * Roll one Base Module rarity off the Looting Leviathan table. `rng` MUST be a
 * dedicated substream (`stream('looting-leviathan', …)`) so this consumer cannot
 * shift the shop's or any AI's rolls.
 */
export function rollLootingLeviathanRarity(devoured: number, rng: Substream): Rarity {
  const o = lootingLeviathanRarityOdds(devoured);
  return rng.weighted([
    { value: 'common' as const, weight: o.common },
    { value: 'rare' as const, weight: o.rare },
    { value: 'legendary' as const, weight: o.legendary },
  ]);
}

/**
 * Grant `devoured - 2` Base Modules (one per enemy past the 3-enemy floor),
 * each rolled off the Looting Leviathan table and then drawn uniformly from the
 * pool of that rarity across all protocols (Looting Leviathan is not
 * protocol-gated). Returns module ids. `[]` for `devoured < 3`.
 */
export function grantLootingLeviathanModules(devoured: number, rng: Substream): string[] {
  if (devoured < 3) return [];
  const out: string[] = [];
  for (let i = 0; i < devoured - 2; i++) {
    const rarity = rollLootingLeviathanRarity(devoured, rng);
    const pool = MODULES.filter((m) => m.rarity === rarity);
    if (pool.length > 0) out.push(rng.pick(pool).id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

export interface OwnedModule {
  readonly moduleId: string;
  readonly stars: number;
}

function starsOf(owned: readonly OwnedModule[], moduleId: string): number {
  return owned.find((o) => o.moduleId === moduleId)?.stars ?? 0;
}

function candidatesFor(protocol: Protocol, rarity: Rarity, owned: readonly OwnedModule[]): BaseModule[] {
  return MODULES.filter((m) => {
    if (m.protocol !== protocol || m.rarity !== rarity) return false;
    if (!MODULE_DRAW_EXCLUDE_MAXED) return true;
    return starsOf(owned, m.id) < maxStarsOf(m);
  });
}

function rollRarity(odds: RarityOdds, rng: Substream): Rarity {
  return rng.weighted([
    { value: 'common' as const, weight: odds.common },
    { value: 'rare' as const, weight: odds.rare },
    { value: 'legendary' as const, weight: odds.legendary },
  ]);
}

export interface ShopCardInfo {
  readonly moduleId: string;
  readonly protocol: Protocol;
  readonly rarity: Rarity;
}

/**
 * One card: roll rarity globally, then (decision 1) uniform among eligible
 * protocols that still have a candidate module, then uniform among that
 * protocol's candidates. `null` means the rolled rarity has nothing left to
 * offer anywhere (every eligible protocol's modules of that rarity are owned
 * at max stars) — a genuinely exhausted late-game shop, not a bug.
 */
function tryPickCard(
  levels: ProtocolLevels,
  owned: readonly OwnedModule[],
  setSoFar: ReadonlySet<string>,
  rng: Substream,
): ShopCardInfo | null {
  const rarity = rollRarity(rarityOdds(levels), rng);
  const eligible = protocolsEligibleFor(rarity, levels);
  if (eligible.length === 0) {
    // The DERIVED odds formula makes rare%/legendary% exactly 0 whenever no
    // protocol meets that rarity's unlock level, so rollRarity can never
    // return a rarity with no eligible protocol. An explicit invariant, not a
    // silent fall-back to Common — a fall-back here would mask a real bug.
    throw new Error(
      `tryPickCard(): rolled "${rarity}" with zero eligible protocols — the odds formula guarantees this is unreachable`,
    );
  }

  const availableProtocols = eligible.filter((p) => candidatesFor(p, rarity, owned).length > 0);
  if (availableProtocols.length === 0) return null;

  let protocol = rng.pick(availableProtocols);
  let pool = candidatesFor(protocol, rarity, owned);
  let moduleId = rng.pick(pool).id;

  if (MODULE_DRAW_DISTINCT_IN_SET) {
    let attempts = 0;
    while (setSoFar.has(moduleId) && attempts < MAX_REROLLS_PER_CARD) {
      protocol = rng.pick(availableProtocols);
      pool = candidatesFor(protocol, rarity, owned);
      moduleId = rng.pick(pool).id;
      attempts++;
    }
    if (setSoFar.has(moduleId)) {
      // Deterministic fallback: scan every available candidate of this
      // rarity, id order, for the first not already in the set.
      const sorted = availableProtocols
        .flatMap((p) => candidatesFor(p, rarity, owned))
        .sort((a, b) => a.id.localeCompare(b.id));
      const fresh = sorted.find((m) => !setSoFar.has(m.id));
      if (fresh !== undefined) {
        protocol = fresh.protocol;
        moduleId = fresh.id;
      }
      // else: every candidate of this rarity is already in the set (a tiny
      // Legendary pool, say) — accept the rolled duplicate rather than loop.
    }
  }

  return { protocol, rarity, moduleId };
}

/**
 * Draw `count` cards (default `SHOP_CARD_COUNT`). Distinct module ids
 * (decision 2); a rarity that turns out fully exhausted is bounded-rerolled at
 * the whole-card level and, failing that, the slot is simply left unfilled —
 * `drawCards` may return fewer than `count` entries only when the shop has
 * truly run out of purchasable modules.
 */
export function drawCards(
  levels: ProtocolLevels,
  owned: readonly OwnedModule[],
  rng: Substream,
  count: number = SHOP_CARD_COUNT,
): ShopCardInfo[] {
  const set = new Set<string>();
  const out: ShopCardInfo[] = [];
  for (let i = 0; i < count; i++) {
    let pick = tryPickCard(levels, owned, set, rng);
    let attempts = 0;
    while (pick === null && attempts < MAX_REROLLS_PER_CARD) {
      pick = tryPickCard(levels, owned, set, rng);
      attempts++;
    }
    if (pick !== null) {
      set.add(pick.moduleId);
      out.push(pick);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shop state — cards + lock, as seen by the UI
// ---------------------------------------------------------------------------

export interface ShopCard extends ShopCardInfo {
  readonly action: 'purchase' | 'upgrade';
  readonly ownedStars: number;
  readonly maxStars: number;
  readonly price: number;
}

export interface ShopState {
  readonly round: number;
  readonly slots: readonly (ShopCard | null)[];
  readonly locked: boolean;
}

export function buyPrice(rarity: Rarity): number {
  if (rarity === 'common') return COMMON_MODULE_BUY;
  if (rarity === 'rare') return MODULE_BUY_RARE;
  return MODULE_BUY_LEGENDARY;
}

function toShopCard(info: ShopCardInfo, owned: readonly OwnedModule[]): ShopCard {
  const module = moduleById(info.moduleId);
  const stars = starsOf(owned, info.moduleId);
  return {
    moduleId: info.moduleId,
    protocol: info.protocol,
    rarity: info.rarity,
    action: stars > 0 ? 'upgrade' : 'purchase',
    ownedStars: stars,
    maxStars: maxStarsOf(module),
    price: buyPrice(info.rarity),
  };
}

function freshSlots(
  levels: ProtocolLevels,
  owned: readonly OwnedModule[],
  rng: Substream,
): (ShopCard | null)[] {
  const slots: (ShopCard | null)[] = new Array<ShopCard | null>(SHOP_CARD_COUNT).fill(null);
  drawCards(levels, owned, rng).forEach((c, i) => {
    slots[i] = toShopCard(c, owned);
  });
  return slots;
}

/**
 * Open the shop for `round`. If `previous` was locked, SHOP_LOCK_BEHAVIOUR
 * carries its four cards over unchanged (metadata recomputed against current
 * ownership) and the lock releases; otherwise a fresh 4-card draw.
 */
export function openShop(
  round: number,
  levels: ProtocolLevels,
  owned: readonly OwnedModule[],
  rng: Substream,
  previous: ShopState | null = null,
): ShopState {
  if (previous !== null && previous.locked) {
    return {
      round,
      slots: previous.slots.map((c) => (c === null ? null : toShopCard(c, owned))),
      locked: false,
    };
  }
  return { round, slots: freshSlots(levels, owned, rng), locked: false };
}

/** No-op while locked (SHOP_LOCK_BEHAVIOUR.refreshDisabledWhileLocked) — caller must not charge the cost then. */
export function canRefreshShop(shop: ShopState): boolean {
  return !shop.locked;
}

export function refreshShop(
  shop: ShopState,
  levels: ProtocolLevels,
  owned: readonly OwnedModule[],
  rng: Substream,
): ShopState {
  if (!canRefreshShop(shop)) return shop;
  return { ...shop, slots: freshSlots(levels, owned, rng), locked: false };
}

export function lockShop(shop: ShopState): ShopState {
  return { ...shop, locked: true };
}

export function unlockShop(shop: ShopState): ShopState {
  return { ...shop, locked: false };
}

function emptySlot(shop: ShopState, slotIndex: number): ShopState {
  if (slotIndex < 0 || slotIndex >= shop.slots.length) {
    throw new RangeError(`emptySlot(): slot ${slotIndex} out of range`);
  }
  const slots = shop.slots.slice();
  slots[slotIndex] = null;
  return { ...shop, slots };
}

// ---------------------------------------------------------------------------
// Player module account — tokens, ownership, protocol XP, and the ledger the
// token-conservation property test checks (`earned + refunded === spent + tokens`)
// ---------------------------------------------------------------------------

export interface ModuleAccount {
  tokens: number;
  readonly owned: OwnedModule[];
  readonly protocolXp: ProtocolXp;
  earned: number;
  spent: number;
  refunded: number;
}

export function createAccount(startingTokens: number): ModuleAccount {
  return {
    tokens: startingTokens,
    owned: [],
    protocolXp: zeroProtocolXp(),
    earned: startingTokens,
    spent: 0,
    refunded: 0,
  };
}

/** Any external credit (round income, HP compensation, PvP win bonus, …). */
export function credit(acc: ModuleAccount, amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`credit(): amount must be finite and >= 0, got ${amount}`);
  }
  acc.tokens += amount;
  acc.earned += amount;
}

export function accountLevels(acc: ModuleAccount): ProtocolLevels {
  return levelsFromXp(acc.protocolXp);
}

/** `earned + refunded === spent + tokens`, at every point in a legal sequence. */
export function conserves(acc: ModuleAccount): boolean {
  return acc.earned + acc.refunded === acc.spent + acc.tokens;
}

/** A raw, unpriced debit — refuses rather than clamps. Backs refresh / swap / change-hero costs. */
function spendFlat(acc: ModuleAccount, amount: number): boolean {
  if (!Number.isInteger(amount) || amount < 0 || amount > acc.tokens) return false;
  acc.tokens -= amount;
  acc.spent += amount;
  return true;
}

export function spendShopRefresh(acc: ModuleAccount, amount: number): boolean {
  return spendFlat(acc, amount);
}

export function spendChangeHero(acc: ModuleAccount, amount: number): boolean {
  return spendFlat(acc, amount);
}

export function spendHeroSwap(acc: ModuleAccount, amount: number): boolean {
  return spendFlat(acc, amount);
}

export type BuyFailureReason = 'empty-slot' | 'unaffordable' | 'maxed' | 'rarity-locked';

export type BuyOutcome =
  | {
      readonly ok: true;
      readonly kind: 'purchase' | 'upgrade';
      readonly moduleId: string;
      readonly price: number;
      readonly stars: number;
    }
  | { readonly ok: false; readonly reason: BuyFailureReason };

/**
 * Buy (or upgrade) the module in `shop.slots[slotIndex]`. Spends `buyPrice`,
 * grants that rarity's XP AGAIN (every star's purchase counts, not just the
 * first), and empties the slot — it does not refill for the rest of the phase.
 */
export function buyModule(
  acc: ModuleAccount,
  shop: ShopState,
  slotIndex: number,
): { outcome: BuyOutcome; shop: ShopState } {
  const card = slotIndex >= 0 && slotIndex < shop.slots.length ? shop.slots[slotIndex] : undefined;
  if (card === undefined || card === null) {
    return { outcome: { ok: false, reason: 'empty-slot' }, shop };
  }

  const levels = accountLevels(acc);
  const eligible = protocolsEligibleFor(card.rarity, levels).includes(card.protocol);
  if (!eligible) {
    return { outcome: { ok: false, reason: 'rarity-locked' }, shop };
  }

  const module = moduleById(card.moduleId);
  const currentStars = starsOf(acc.owned, card.moduleId);
  if (currentStars >= maxStarsOf(module)) {
    return { outcome: { ok: false, reason: 'maxed' }, shop };
  }

  const price = buyPrice(card.rarity);
  if (price > acc.tokens) {
    return { outcome: { ok: false, reason: 'unaffordable' }, shop };
  }

  acc.tokens -= price;
  acc.spent += price;
  const newStars = currentStars + 1;
  const idx = acc.owned.findIndex((o) => o.moduleId === card.moduleId);
  if (idx >= 0) acc.owned[idx] = { moduleId: card.moduleId, stars: newStars };
  else acc.owned.push({ moduleId: card.moduleId, stars: newStars });
  acc.protocolXp[card.protocol] += MODULE_XP[card.rarity];

  return {
    outcome: {
      ok: true,
      kind: currentStars > 0 ? 'upgrade' : 'purchase',
      moduleId: card.moduleId,
      price,
      stars: newStars,
    },
    shop: emptySlot(shop, slotIndex),
  };
}

export type SellOutcome =
  | { readonly ok: true; readonly refunded: number; readonly xpRemoved: number; readonly newLevel: number }
  | { readonly ok: false; readonly reason: 'not-owned' };

/**
 * Sell an owned module entirely (decision 4): refund `sellValue × stars`,
 * remove `rarityXp × stars` from that protocol's XP (floored at 0 — never
 * negative), which can drop a level and revoke its bonus.
 */
export function sellModule(acc: ModuleAccount, moduleId: string): SellOutcome {
  const idx = acc.owned.findIndex((o) => o.moduleId === moduleId);
  if (idx < 0) return { ok: false, reason: 'not-owned' };

  const owned = acc.owned[idx]!;
  const module = moduleById(moduleId);
  const starsSold = MODULE_SELL_SCALES_PER_STAR ? owned.stars : 1;
  const refund = MODULE_SELL[module.rarity] * starsSold;
  const xpRemoved = MODULE_XP[module.rarity] * starsSold;

  acc.tokens += refund;
  acc.refunded += refund;
  acc.owned.splice(idx, 1);
  acc.protocolXp[module.protocol] = Math.max(0, acc.protocolXp[module.protocol] - xpRemoved);

  return { ok: true, refunded: refund, xpRemoved, newLevel: protocolLevelFromXp(acc.protocolXp[module.protocol]) };
}

// ---------------------------------------------------------------------------
// Change Hero — role offers (3 / 6 / 3), never a hero already in the lineup
// ---------------------------------------------------------------------------

interface HeroLite {
  readonly id: string;
  readonly role: Role;
}

const HEROES = heroesJson as unknown as readonly HeroLite[];
const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];
const HEROES_OF_ROLE: Readonly<Record<Role, readonly string[]>> = {
  vanguard: HEROES.filter((h) => h.role === 'vanguard').map((h) => h.id).sort(),
  duelist: HEROES.filter((h) => h.role === 'duelist').map((h) => h.id).sort(),
  strategist: HEROES.filter((h) => h.role === 'strategist').map((h) => h.id).sort(),
};

/** `CHANGE_HERO_OFFERS[role]` random heroes of `role`, drawn from the full roster, never one already in `lineup`. */
export function changeHeroOffers(role: Role, lineup: readonly string[], rng: Substream): string[] {
  if (!ROLES.includes(role)) throw new RangeError(`changeHeroOffers(): bad role "${role}"`);
  const n = CHANGE_HERO_OFFERS[role];
  const inLineup = new Set(lineup);
  const pool = HEROES_OF_ROLE[role].filter((id) => !inLineup.has(id));
  if (pool.length < n) {
    throw new RangeError(`changeHeroOffers(): only ${pool.length} eligible ${role}s available for ${n} offers`);
  }
  return rng.shuffle(pool).slice(0, n);
}

// ---------------------------------------------------------------------------
// Swap-out: lineup/reserve exchange + Strengthen-Module conversion
// ---------------------------------------------------------------------------

export interface LineupState {
  readonly lineup: readonly string[];
  readonly reserve: readonly string[];
}

/** Outgoing hero must be active; incoming must not already be. Positions are preserved. */
export function applyHeroSwap(state: LineupState, incomingHeroId: string, outgoingHeroId: string): LineupState {
  if (!state.lineup.includes(outgoingHeroId)) {
    throw new RangeError(`applyHeroSwap(): "${outgoingHeroId}" is not in the active lineup`);
  }
  if (state.lineup.includes(incomingHeroId)) {
    throw new RangeError(`applyHeroSwap(): "${incomingHeroId}" is already in the active lineup`);
  }
  return {
    lineup: state.lineup.map((id) => (id === outgoingHeroId ? incomingHeroId : id)),
    reserve: [...state.reserve.filter((id) => id !== incomingHeroId), outgoingHeroId],
  };
}

/** `heroId -> equipped Strengthen module ids` plus the unassigned pool. */
export interface StrengthenInventory {
  readonly equipped: Readonly<Record<string, readonly string[]>>;
  readonly selectable: readonly string[];
}

export function totalStrengthen(inv: StrengthenInventory): number {
  const equippedCount = Object.values(inv.equipped).reduce((sum, list) => sum + list.length, 0);
  return equippedCount + inv.selectable.length;
}

/**
 * The outgoing hero's equipped Strengthen Modules are converted back to
 * selectable modules — NOT auto-assigned to anyone else. `totalStrengthen` is
 * unchanged by this call (M10's invariant).
 */
export function convertOnSwapOut(inv: StrengthenInventory, outgoingHeroId: string): StrengthenInventory {
  const modules = inv.equipped[outgoingHeroId];
  if (modules === undefined || modules.length === 0) return inv;
  const equipped = { ...inv.equipped };
  delete equipped[outgoingHeroId];
  return { equipped, selectable: [...inv.selectable, ...modules] };
}

/** Convenience: perform the swap and the Strengthen conversion together. */
export function swapHeroAndConvertStrengthen(
  lineupState: LineupState,
  strengthen: StrengthenInventory,
  incomingHeroId: string,
  outgoingHeroId: string,
): { lineup: LineupState; strengthen: StrengthenInventory } {
  return {
    lineup: applyHeroSwap(lineupState, incomingHeroId, outgoingHeroId),
    strengthen: convertOnSwapOut(strengthen, outgoingHeroId),
  };
}
