/*
 * Battle phase — the DOM host for the M9 Canvas2D renderer.
 *
 * The renderer (`src/render/battleRenderer.ts`) creates and owns the <canvas>
 * inside this host and draws the whole battle view onto it: arena, unit tokens,
 * long segmented health bars, ult-charge bars, damage numbers, target lines, the
 * drone, the kill feed, your name / the opponent name, the LSHIFT / E ability
 * buttons, the `LALT CURSOR MODE / B MODULES` hint, and the Speed Up Protocol
 * announcement. This module only provides the positioned container and the
 * mid-battle module-menu overlay (`B`).
 */

import { h } from '../dom';
import * as S from '../../data/strings';
import type { MatchState, MatchupKind } from '../../sim/types';

export interface BattleNames {
  readonly playerName: string;
  readonly opponentName: string;
  readonly matchupKind: MatchupKind | null;
  readonly opponentId: number;
}

/** Resolve the display names for the human's current matchup. */
export function battleNames(state: MatchState, playerId: number): BattleNames {
  const me = state.players[playerId];
  const mine = state.matchups.find((m) => m.a === playerId || m.b === playerId) ?? null;
  let opponentName = '';
  let opponentId = -1;
  if (mine) {
    if (mine.kind === 'pve') {
      opponentName = S.PRACTICE_PROTOCOL;
    } else {
      opponentId = mine.a === playerId ? mine.b : mine.a;
      opponentName = state.players[opponentId]?.name ?? '';
    }
  }
  return {
    playerName: me ? me.name : '',
    opponentName,
    matchupKind: mine ? mine.kind : null,
    opponentId,
  };
}

/** The empty positioned container the renderer mounts its <canvas> into. */
export function renderBattleHost(): HTMLElement {
  return h('div', { class: 'bm-battle' });
}

export interface BattleShopSlots {
  /** The shop screen element (built by the caller from `renderShop`). */
  readonly shopEl: HTMLElement;
  readonly onClose: () => void;
}

/** The `B MODULES` overlay shown over a still-ticking battle. */
export function renderBattleShopOverlay(slots: BattleShopSlots): HTMLElement {
  return h(
    'div',
    { class: 'bm-battle-shop' },
    h('div', { class: 'bm-battle-shop__notice', text: S.PURCHASED_MODULES_TOOLTIP }),
    slots.shopEl,
    h(
      'button',
      { class: 'bm-btn bm-battle-shop__close', type: 'button', onClick: slots.onClose },
      S.BTN_CANCEL,
    ),
  );
}
