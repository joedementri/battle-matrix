/*
 * Change Hero tab + Swap-out screen view models.
 *
 * The three role cards read "Choose One of N Random <Role>s …" with N straight
 * off `CHANGE_HERO_OFFERS` (3 / 6 / 3). The swap-out screen shows the RESERVE
 * row (the role offers) ABOVE the ACTIVE row (the current lineup) and blocks
 * confirm until one of each is picked. PURE, no DOM.
 */

import { CHANGE_HERO_COST, CHANGE_HERO_OFFERS } from '../../data/constants';
import * as S from '../../data/strings';
import type { DisplayRole } from '../../data/strings';
import type { Role } from '../../data/types';
import type { StrengthenInventory } from '../../sim/modules';
import { resolveHeroArt } from '../heroArt';
import type { HeroArt } from '../heroArt';

const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];

export interface RoleCardVM {
  readonly role: Role;
  readonly displayRole: DisplayRole;
  readonly titleText: string; // `CHOOSE VANGUARD`
  readonly bodyText: string; // `Choose One of 3 Random Vanguards to Replace a Current Hero`
  readonly offerSize: number; // 3 / 6 / 3
  readonly price: number; // CHANGE_HERO_COST
  readonly priceText: string; // `◇5`
  readonly selectLabel: string; // `SELECT`
}

export function changeHeroCardsVM(): readonly RoleCardVM[] {
  return ROLES.map((role) => {
    const displayRole = S.ROLE_DISPLAY_NAME[role];
    const offerSize = CHANGE_HERO_OFFERS[role];
    return {
      role,
      displayRole,
      titleText: S.chooseRoleCardTitle(displayRole),
      bodyText: S.chooseOneOfRandom(offerSize, displayRole),
      offerSize,
      price: CHANGE_HERO_COST,
      priceText: S.diamondCost(CHANGE_HERO_COST),
      selectLabel: S.BTN_SELECT,
    };
  });
}

// ---------------------------------------------------------------------------
// Swap-out
// ---------------------------------------------------------------------------

export interface SwapPickVM {
  readonly heroId: string;
  readonly art: HeroArt;
  readonly strengthenPips: number;
  readonly selected: boolean;
}

export interface SwapSelection {
  readonly incoming: string | null; // a reserve/offer hero
  readonly outgoing: string | null; // an active lineup hero
}

export interface SwapOutVM {
  readonly title: string; // `SELECT HERO TO SWAP OUT`
  readonly subtitle: string;
  readonly footnote: string;
  /** Row order — Reserve is rendered ABOVE Active. */
  readonly rowOrder: readonly ['reserve', 'active'];
  readonly reserveLabel: string; // `RESERVE HEROES`
  readonly activeLabel: string; // `ACTIVE HEROES`
  readonly reserve: readonly SwapPickVM[];
  readonly active: readonly SwapPickVM[];
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly confirmEnabled: boolean;
}

function pipsFor(strengthen: StrengthenInventory, heroId: string): number {
  const list = strengthen.equipped[heroId];
  return list ? list.length : 0;
}

export function swapOutVM(
  lineup: readonly string[],
  strengthen: StrengthenInventory,
  offers: readonly string[],
  selection: SwapSelection,
): SwapOutVM {
  const active = lineup.map((heroId) => ({
    heroId,
    art: resolveHeroArt(heroId),
    strengthenPips: pipsFor(strengthen, heroId),
    selected: selection.outgoing === heroId,
  }));
  const reserve = offers.map((heroId) => ({
    heroId,
    art: resolveHeroArt(heroId),
    strengthenPips: pipsFor(strengthen, heroId),
    selected: selection.incoming === heroId,
  }));
  const confirmEnabled =
    selection.incoming !== null &&
    selection.outgoing !== null &&
    offers.includes(selection.incoming) &&
    lineup.includes(selection.outgoing);

  return {
    title: S.SELECT_HERO_TO_SWAP_OUT,
    subtitle: S.HEROES_SWAPPED_SUBTITLE,
    footnote: S.SWAP_CONVERSION_FOOTNOTE,
    rowOrder: ['reserve', 'active'],
    reserveLabel: S.RESERVE_HEROES,
    activeLabel: S.ACTIVE_HEROES,
    reserve,
    active,
    confirmLabel: S.BTN_CONFIRM,
    cancelLabel: S.BTN_CANCEL,
    confirmEnabled,
  };
}
