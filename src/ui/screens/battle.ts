/*
 * Battle-phase placeholder for M8. The Canvas2D renderer, kill feed and battle
 * HUD are M9 — this screen only holds the chrome-consistent shell: your name
 * top-left, the opponent name top-right, and `BATTLE PROTOCOL`. The app waits
 * out the phase timer here.
 */

import { h } from '../dom';
import * as S from '../../data/strings';
import type { MatchState } from '../../sim/types';

export function renderBattle(state: MatchState, playerId: number): HTMLElement {
  const me = state.players[playerId];
  const myMatchup = state.matchups.find((m) => m.a === playerId || m.b === playerId);
  let opponentName = '';
  if (myMatchup) {
    if (myMatchup.kind === 'pve') opponentName = S.PRACTICE_PROTOCOL;
    else {
      const oppId = myMatchup.a === playerId ? myMatchup.b : myMatchup.a;
      opponentName = state.players[oppId]?.name ?? '';
    }
  }

  return h(
    'div',
    { class: 'bm-battle' },
    h(
      'div',
      { class: 'bm-battle__names' },
      h('span', { text: me ? me.name : '' }),
      h('span', { text: opponentName }),
    ),
    h('h1', { class: 'bm-h1', text: S.BATTLE_PROTOCOL }),
  );
}
