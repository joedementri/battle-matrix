/*
 * View models for the Module Draw screen: the token wallet + income preview,
 * the rarity-odds row, and each of the four shop cards.
 *
 * Every derived number comes from a `src/sim` export — `economy.previewIncome`,
 * `modules.rarityOdds`, `modules.shopCardValue`, and the `ShopCard` the sim
 * already built (`action`, `ownedStars`, `maxStars`, `price`). This file only
 * formats. PURE `state -> data`, no DOM.
 */

import { SHOP_REFRESH_COST } from '../../data/constants';
import * as S from '../../data/strings';
import type { Protocol, Rarity } from '../../data/types';
import { previewIncome } from '../../sim/economy';
import {
  levelsFromXp,
  moduleById,
  rarityOdds,
  shopCardValue,
  zeroProtocolXp,
} from '../../sim/modules';
import type { ProtocolLevels, ShopCard, ShopState } from '../../sim/modules';
import type { MatchState } from '../../sim/types';
import { oddsPercent, oneDecimal, renderModuleEffect, starRow } from '../format';
import type { StarCell } from '../format';

// ---------------------------------------------------------------------------
// Wallet / income preview
// ---------------------------------------------------------------------------

export interface IncomePreviewVM {
  readonly tokens: number;
  readonly preview: number; // === economy.previewIncome(state, playerId).total
  readonly text: string; // `10 (+16)`
}

export function incomePreviewVM(state: MatchState, playerId: number): IncomePreviewVM {
  const player = state.players[playerId];
  const tokens = player ? player.tokens : 0;
  const preview = previewIncome(state, playerId).total;
  return { tokens, preview, text: S.incomePreview(tokens, preview) };
}

// ---------------------------------------------------------------------------
// Rarity-odds row  ( ★ n%  ★ n%  ★ n% )
// ---------------------------------------------------------------------------

export interface RarityOddsRowVM {
  readonly common: number;
  readonly rare: number;
  readonly legendary: number;
  readonly commonText: string;
  readonly rareText: string;
  readonly legendaryText: string;
}

export function rarityOddsVM(levels: ProtocolLevels): RarityOddsRowVM {
  const odds = rarityOdds(levels);
  return {
    common: odds.common,
    rare: odds.rare,
    legendary: odds.legendary,
    commonText: oddsPercent(odds.common),
    rareText: oddsPercent(odds.rare),
    legendaryText: oddsPercent(odds.legendary),
  };
}

export function rarityOddsVMForPlayer(state: MatchState, playerId: number): RarityOddsRowVM {
  const player = state.players[playerId];
  return rarityOddsVM(levelsFromXp(player ? player.protocolXp : zeroProtocolXp()));
}

// ---------------------------------------------------------------------------
// Shop card
// ---------------------------------------------------------------------------

export interface ShopCardVM {
  readonly empty: boolean;
  readonly moduleId: string | null;
  readonly protocol: Protocol | null;
  readonly rarity: Rarity | null;
  /** `PURCHASE` or `UPGRADE` — straight off `ShopCard.action`. */
  readonly label: string | null;
  readonly nameText: string;
  /** The module's LEVEL-1 base value, one decimal — always, regardless of owned stars. */
  readonly valueText: string;
  readonly isPercent: boolean;
  readonly effectText: string;
  readonly stars: readonly StarCell[];
  readonly starsFilled: number; // === ShopCard.ownedStars
  readonly starsTotal: number; // === ShopCard.maxStars
  readonly nextStarHighlighted: boolean;
  readonly price: number;
  readonly priceText: string; // `◇5`
  readonly priceIsRed: boolean; // exactly when tokens < price
  readonly locked: boolean;
}

const EMPTY_CARD: Omit<ShopCardVM, 'locked'> = {
  empty: true,
  moduleId: null,
  protocol: null,
  rarity: null,
  label: null,
  nameText: '',
  valueText: '',
  isPercent: false,
  effectText: '',
  stars: [],
  starsFilled: 0,
  starsTotal: 0,
  nextStarHighlighted: false,
  price: 0,
  priceText: '',
  priceIsRed: false,
};

export function shopCardVM(card: ShopCard | null, tokens: number, locked = false): ShopCardVM {
  if (card === null) return { ...EMPTY_CARD, locked };
  const module = moduleById(card.moduleId);
  const level1 = shopCardValue(module); // {value, isPercent} — always values[0]
  return {
    empty: false,
    moduleId: card.moduleId,
    protocol: card.protocol,
    rarity: card.rarity,
    label: card.action === 'upgrade' ? S.BTN_UPGRADE : S.BTN_PURCHASE,
    nameText: module.name,
    valueText: oneDecimal(level1.value),
    isPercent: level1.isPercent,
    effectText: renderModuleEffect(module.effect, level1.value, level1.isPercent),
    stars: starRow(card.ownedStars, card.maxStars),
    starsFilled: card.ownedStars,
    starsTotal: card.maxStars,
    nextStarHighlighted: card.ownedStars < card.maxStars,
    price: card.price,
    priceText: S.diamondCost(card.price),
    priceIsRed: tokens < card.price,
    locked,
  };
}

// ---------------------------------------------------------------------------
// Whole shop
// ---------------------------------------------------------------------------

export type ShopTabId = 'select' | 'activated' | 'changeHero';

export interface ShopTabVM {
  readonly id: ShopTabId;
  readonly label: string;
}

export const SHOP_TABS: readonly ShopTabVM[] = [
  { id: 'select', label: S.TAB_SELECT },
  { id: 'activated', label: S.TAB_ACTIVATED },
  { id: 'changeHero', label: S.TAB_CHANGE_HERO },
];

export interface ShopVM {
  readonly hasShop: boolean;
  readonly locked: boolean;
  readonly refreshEnabled: boolean;
  readonly refreshLabel: string; // `REFRESH`
  readonly refreshCostText: string; // `◇1`
  readonly lockLabel: string; // `LOCK` / `UNLOCK`
  readonly footnote: string | null; // shown only while locked
  readonly cards: readonly ShopCardVM[];
  readonly wallet: IncomePreviewVM;
  readonly odds: RarityOddsRowVM;
  readonly tabs: readonly ShopTabVM[];
  readonly headerText: string; // `Select the Modules you wish to purchase`
  readonly delayedEffectTooltip: string;
}

export function shopVM(state: MatchState, playerId: number): ShopVM {
  const player = state.players[playerId];
  const shop: ShopState | null = player ? player.shop : null;
  const tokens = player ? player.tokens : 0;
  const locked = shop !== null && shop.locked;
  const slots = shop ? shop.slots : [null, null, null, null];
  return {
    hasShop: shop !== null,
    locked,
    refreshEnabled: shop !== null && !locked && tokens >= SHOP_REFRESH_COST,
    refreshLabel: S.BTN_REFRESH,
    refreshCostText: S.diamondCost(SHOP_REFRESH_COST),
    lockLabel: locked ? S.BTN_UNLOCK : S.BTN_LOCK,
    footnote: locked ? S.LOCKED_MODULES_FOOTER : null,
    cards: slots.map((card) => shopCardVM(card, tokens, locked)),
    wallet: incomePreviewVM(state, playerId),
    odds: rarityOddsVMForPlayer(state, playerId),
    tabs: SHOP_TABS,
    headerText: S.SELECT_MODULES_HEADER,
    delayedEffectTooltip: S.PURCHASED_MODULES_TOOLTIP,
  };
}
