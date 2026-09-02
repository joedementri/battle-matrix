/*
 * M7 — the shared shop-turn driver.
 *
 * `executeShopPlan(input, plan)` turns an archetype's economy knobs (`ShopPlan`)
 * into a legal sequence of `buyModule` / `refreshShop` / `lockShop` calls
 * against the live `ModuleAccount`, and returns the final `ShopState`.
 *
 * THE POLICY MUST NOT ASK FOR SOMETHING ILLEGAL. `modules.ts` already refuses a
 * bad buy — but M7's assertion is on the *attempt*: a bot never fires
 * `buyModule` at a rarity-locked / maxed / unaffordable card, and never
 * refreshes what it cannot afford or a locked shop. `pickBuy` pre-checks every
 * one of those; if a refusal still comes back, `executeShopPlan` THROWS (a bug
 * in the pre-check), which the legality fuzz turns into a hard failure.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { SHOP_REFRESH_COST } from '../data/constants';
import {
  accountLevels,
  buyModule,
  buyPrice,
  canRefreshShop,
  lockShop,
  maxStarsOf,
  moduleById,
  protocolsEligibleFor,
  refreshShop,
  spendShopRefresh,
} from '../sim/modules';
import type { ModuleAccount, ShopCard, ShopState } from '../sim/modules';
import type { ShopTurnInput } from './types';

export interface ShopPlan {
  /** Maximum `REFRESH`es this round. */
  readonly refreshBudget: number;
  /** Carry the current cards into next round's shop (`LOCK`) at the end of the turn? */
  readonly lockAtEnd: boolean;
  /** `REFRESH` when no acceptable card is showing (vs. never refresh)? */
  readonly refreshWhenStuck: boolean;
  /**
   * Score a candidate card — higher buys sooner. `null` means the policy
   * refuses this card outright (wrong protocol for its plan, off-strategy, ...).
   */
  score(card: ShopCard, account: ModuleAccount, ctx: ShopTurnInput): number | null;
  /**
   * Is the policy willing to let its balance fall to `tokensAfter`? Encodes the
   * economy rule (hold ≥ 50, spend to 0, keep a 25 buffer, ...). Gates buys and
   * refreshes alike.
   */
  willSpendTo(tokensAfter: number, ctx: ShopTurnInput): boolean;
}

/** The slot of the highest-scored card the policy may legally buy, or `null`. */
function pickBuy(shop: ShopState, acc: ModuleAccount, plan: ShopPlan, ctx: ShopTurnInput): number | null {
  const levels = accountLevels(acc);
  let bestSlot: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < shop.slots.length; i++) {
    const card = shop.slots[i];
    if (card === undefined || card === null) continue;

    const score = plan.score(card, acc, ctx);
    if (score === null) continue;

    const price = buyPrice(card.rarity);
    if (price > acc.tokens) continue; // unaffordable — do not ask
    if (!plan.willSpendTo(acc.tokens - price, ctx)) continue; // breaks the economy rule
    if (!protocolsEligibleFor(card.rarity, levels).includes(card.protocol)) continue; // rarity-locked
    const owned = acc.owned.find((o) => o.moduleId === card.moduleId);
    if (owned !== undefined && owned.stars >= maxStarsOf(moduleById(card.moduleId))) continue; // maxed

    if (score > bestScore) {
      bestScore = score;
      bestSlot = i;
    }
  }
  return bestSlot;
}

export function executeShopPlan(input: ShopTurnInput, plan: ShopPlan): ShopState {
  const acc = input.account;
  let shop = input.shop;
  let refreshesLeft = plan.refreshBudget;

  // Bounded: at most 4 buys + `refreshBudget` refreshes per shop, well under this.
  for (let guard = 0; guard < 64; guard++) {
    const slot = pickBuy(shop, acc, plan, input);
    if (slot !== null) {
      const { outcome, shop: next } = buyModule(acc, shop, slot);
      if (!outcome.ok) {
        throw new Error(
          `ai/shop: policy asked for an illegal buy at slot ${slot} (${outcome.reason}) — pickBuy is wrong`,
        );
      }
      shop = next;
      continue;
    }

    if (
      refreshesLeft > 0 &&
      plan.refreshWhenStuck &&
      canRefreshShop(shop) &&
      acc.tokens >= SHOP_REFRESH_COST &&
      plan.willSpendTo(acc.tokens - SHOP_REFRESH_COST, input)
    ) {
      if (!spendShopRefresh(acc, SHOP_REFRESH_COST)) {
        throw new Error('ai/shop: policy asked for an unaffordable refresh — the guard is wrong');
      }
      shop = refreshShop(shop, accountLevels(acc), acc.owned, input.rng);
      refreshesLeft--;
      continue;
    }

    break;
  }

  if (plan.lockAtEnd && !shop.locked) shop = lockShop(shop);
  return shop;
}
