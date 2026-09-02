/*
 * Final Standings — placements 1..6, one winner. No screenshot; kept in the
 * scoreboard's `Rank` language. The fan-project disclaimer lives as static
 * markup in index.html (visible on every screen's footer). VM → DOM.
 */

import { h } from '../dom';
import type { StandingsVM } from '../viewmodels/standings';

export function renderStandings(vm: StandingsVM): HTMLElement {
  return h(
    'div',
    { class: 'bm-standings' },
    h('h1', { class: 'bm-h1', text: vm.title }),
    h(
      'div',
      { class: 'bm-standings__list' },
      ...vm.rows.map((row) =>
        h(
          'div',
          { class: `bm-standings__row${row.placement === 1 ? ' bm-standings__row--1' : ''}` },
          h('span', { class: 'bm-standings__rank', text: `#${row.placement}` }),
          h('span', { text: row.name }),
          h('span', { class: 'bm-muted', text: row.isWinner ? '★' : row.isSelf ? '•' : '' }),
        ),
      ),
    ),
  );
}
