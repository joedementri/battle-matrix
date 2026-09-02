/*
 * Scoreboard (TAB) — `Rank / Player Name / Deploy / Initiate Protocol`, all six
 * lineups, all four protocol levels + the Strengthen count, tokens, health,
 * streaks. A divider marks the top-3 cutoff; rows below it dim. Fully public —
 * nothing hidden. VM → DOM.
 */

import { h } from '../dom';
import * as S from '../../data/strings';
import { heroToken } from '../heroToken';
import type { SbRowVM, ScoreboardVM } from '../viewmodels/scoreboard';

function protocolCell(row: SbRowVM): HTMLElement {
  return h(
    'div',
    { class: 'bm-sb-protos' },
    ...row.protocols.map((proto) =>
      h(
        'div',
        { class: `bm-sb-proto bm-sb-proto--${proto.protocol}` },
        h('span', { class: 'bm-sb-proto__dot' }),
        h('span', { text: String(proto.level) }),
      ),
    ),
    h(
      'div',
      { class: 'bm-sb-proto bm-sb-proto--strengthen' },
      h('span', { class: 'bm-sb-proto__dot' }),
      h('span', { text: `x${row.strengthenCount}` }),
    ),
  );
}

function sbRow(row: SbRowVM): HTMLElement[] {
  const cls = `bm-sb-row${row.isSelf ? ' bm-sb-row--self' : ''}${row.dimmed ? ' bm-sb-row--dim' : ''}`;
  return [
    h(
      'div',
      { class: cls },
      h('span', { class: `bm-sb-row__rank${row.rank === 1 ? ' bm-sb-row__rank--1' : ''}`, text: String(row.rank) }),
    ),
    h(
      'div',
      { class: cls },
      h('span', { text: row.name }),
      h('span', { class: 'bm-tokens', text: `${S.TOKEN_SYMBOL}${row.tokens}` }),
      h('span', { class: 'bm-muted', text: row.healthText }),
    ),
    h('div', { class: `${cls} bm-sb-deploy` }, ...row.deploy.map((art) => heroToken(art, { size: 26 }))),
    h('div', { class: cls }, protocolCell(row)),
  ];
}

export function renderScoreboard(vm: ScoreboardVM, onClose: () => void): HTMLElement {
  const grid = h(
    'div',
    { class: 'bm-sb-grid' },
    h(
      'div',
      { class: 'bm-sb-grid__head' },
      ...vm.columns.map((col) => h('div', { text: col })),
    ),
  );

  vm.rows.forEach((row, index) => {
    if (index === vm.dividerAfterIndex) grid.appendChild(h('div', { class: 'bm-sb-divider' }));
    for (const cell of sbRow(row)) grid.appendChild(cell);
  });

  return h(
    'div',
    { class: 'bm-scoreboard' },
    h(
      'div',
      { class: 'bm-shop__tabs' },
      h('h2', { class: 'bm-h2', text: S.HINT_TAB_SCOREBOARD }),
      h('button', { class: 'bm-btn', type: 'button', onClick: () => onClose() }, S.BTN_CANCEL),
    ),
    grid,
  );
}
