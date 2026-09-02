/*
 * The bridge between UI gestures and the sim: pure `Action` builders and the
 * callback surface the screens receive. Every user gesture becomes exactly one
 * of these `Action`s — the UI never mutates sim state directly. `tests/
 * ui-actions.spec.ts` asserts each builder produces a legal member of the sim's
 * `Action` union and that `runMatch` accepts it.
 */

import type { DeployCell } from '../sim/board';
import type { Action } from '../sim/types';
import type { Protocol, Role } from '../data/types';
import type { ShopTabId } from './viewmodels/shop';

export const buildAction = {
  selectLineup: (heroes: readonly string[]): Action => ({ type: 'selectLineup', heroes: [...heroes] }),
  confirmPhase: (): Action => ({ type: 'confirmPhase' }),
  advanceTimer: (): Action => ({ type: 'advanceTimer' }),
  buyModule: (slot: number): Action => ({ type: 'buyModule', slot }),
  sellModule: (moduleId: string): Action => ({ type: 'sellModule', moduleId }),
  refreshShop: (): Action => ({ type: 'refreshShop' }),
  lockShop: (): Action => ({ type: 'lockShop' }),
  deploy: (cells: readonly DeployCell[]): Action => ({
    type: 'deploy',
    cells: cells.map((cell) => ({ col: cell.col, row: cell.row })),
  }),
  swapHero: (incoming: string, outgoing: string): Action => ({ type: 'swapHero', incoming, outgoing }),
  selectReward: (moduleId: string): Action => ({ type: 'selectReward', moduleId }),
  refreshReward: (): Action => ({ type: 'refreshReward' }),
} as const;

/** The gestures a screen can raise. The app turns each into `buildAction` calls / UI-local state. */
export interface UiCallbacks {
  // Draft
  toggleDraftPick(heroId: string): void;
  // Shop
  setShopTab(tab: ShopTabId): void;
  buyModule(slot: number): void;
  refreshShop(): void;
  toggleLock(): void;
  // Change Hero / swap-out
  openChangeHero(role: Role): void;
  pickSwapIncoming(heroId: string): void;
  pickSwapOutgoing(heroId: string): void;
  confirmSwap(): void;
  cancelSwap(): void;
  // Select Position
  moveHero(slot: number, cell: DeployCell): void;
  selectBoardSlot(slot: number | null): void;
  // Reward
  selectReward(moduleId: string): void;
  refreshReward(): void;
  // Chrome / navigation
  openInfoPane(protocol: Protocol): void;
  closeInfoPane(): void;
  toggleScoreboard(): void;
  confirmPhase(): void;
}
