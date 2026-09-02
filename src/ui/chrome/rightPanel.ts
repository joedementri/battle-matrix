/*
 * Right-panel renderer: the player list, already sorted health-descending by
 * the view model. Streak badge with its count, `◇tokens`, and `Out of Play` in
 * place of health for eliminated players. VM → DOM.
 */

import { h, setVar } from '../dom';
import type { PlayerRowVM, RightPanelVM } from '../viewmodels/chrome';

function streakBadge(row: PlayerRowVM): HTMLElement | null {
  if (row.streakKind === 'none' || row.streakText === '') return null;
  return h('span', {
    class: `bm-streak bm-streak--${row.streakKind}`,
    text: `${row.streakKind === 'win' ? '▲' : '▼'}${row.streakText}`,
  });
}

function playerRow(row: PlayerRowVM): HTMLElement {
  const ring = h('span', {
    class: `bm-prow__ring${row.out ? ' bm-prow__ring--out' : ''}`,
    text: row.out ? '' : row.healthText,
  });
  setVar(ring, '--h', row.health);
  setVar(ring, '--m', '50');

  return h(
    'div',
    { class: `bm-prow${row.isSelf ? ' bm-prow--self' : ''}${row.out ? ' bm-prow--out' : ''}` },
    h(
      'div',
      null,
      h('div', { class: 'bm-prow__name', text: row.name }),
      h(
        'div',
        { class: 'bm-prow__sub' },
        row.out ? h('span', { text: row.healthText }) : null,
        streakBadge(row),
        h(
          'span',
          { class: 'bm-tokens' },
          h('span', { class: 'bm-tokens__sym', text: '◇' }),
          h('span', { text: String(row.tokens) }),
        ),
      ),
    ),
    ring,
  );
}

export function renderRightPanel(vm: RightPanelVM): HTMLElement {
  return h(
    'div',
    { class: 'bm-panel' },
    h(
      'div',
      { class: 'bm-panel__tabs' },
      h('span', { class: 'bm-panel__tab bm-panel__tab--active', text: '1 ◇' }),
      h('span', { class: 'bm-panel__tab', text: '2 ▤' }),
    ),
    ...vm.rows.map(playerRow),
  );
}
