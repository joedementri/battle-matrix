/*
 * Change Hero tab — the three lavender role cards (`CHOOSE VANGUARD` …), each
 * reading "Choose One of N Random <Role>s …" with N = 3 / 6 / 3. VM → DOM.
 */

import { h } from '../dom';
import type { Role } from '../../data/types';
import type { RoleCardVM } from '../viewmodels/changeHero';

export interface ChangeHeroCallbacks {
  readonly openRole: (role: Role) => void;
}

export function renderChangeHero(
  cards: readonly RoleCardVM[],
  cb: ChangeHeroCallbacks,
): HTMLElement {
  return h(
    'div',
    { class: 'bm-changehero' },
    ...cards.map((card) =>
      h(
        'div',
        { class: 'bm-rolecard' },
        h('div', { class: 'bm-rolecard__title', text: card.titleText }),
        h('div', { class: 'bm-rolecard__body', text: card.bodyText }),
        h(
          'button',
          { class: 'bm-btn', type: 'button', onClick: () => cb.openRole(card.role) },
          h('span', { text: `${card.selectLabel} ` }),
          h('span', { class: 'bm-price', text: card.priceText }),
        ),
      ),
    ),
  );
}
