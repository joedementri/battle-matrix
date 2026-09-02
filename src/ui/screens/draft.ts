/*
 * Draft screen — the 18-hero pool as a grid of portrait cards, six lineup
 * slots, `LINEUP (n/6)` confirm, mode title + tagline + countdown. VM → DOM.
 */

import { h, keyActivate } from '../dom';
import { heroToken } from '../heroToken';
import type { DraftVM } from '../viewmodels/draft';

export interface DraftScreenCallbacks {
  readonly toggle: (heroId: string) => void;
  readonly confirm: () => void;
}

export function renderDraft(vm: DraftVM, cb: DraftScreenCallbacks): HTMLElement {
  const poolGrid = h(
    'div',
    { class: 'bm-draft__pool' },
    ...vm.pool.map((card) => {
      const el = h(
        'div',
        {
          class: `bm-pool-card${card.picked ? ' bm-pool-card--picked' : ''}${
            card.disabled ? ' bm-pool-card--disabled' : ''
          }`,
          'aria-pressed': card.picked ? 'true' : 'false',
        },
        heroToken(card.art, { size: 40 }),
        h('div', { class: 'bm-pool-card__name', text: card.art.name }),
        h('div', { class: 'bm-pool-card__role', text: card.art.displayRole }),
      );
      keyActivate(el, () => cb.toggle(card.heroId), { disabled: card.disabled && !card.picked });
      return el;
    }),
  );

  const slots = h(
    'div',
    { class: 'bm-draft__slots' },
    ...vm.slots.map((art) =>
      h('div', { class: 'bm-slot' }, art ? heroToken(art, { size: 38 }) : null),
    ),
  );

  return h(
    'div',
    { class: 'bm-draft' },
    h(
      'div',
      { class: 'bm-draft__head' },
      h('p', { class: 'title-eyebrow bm-muted', text: vm.modeTitle }),
      h('h1', { class: 'bm-h1', text: vm.assembleTitle }),
      h('p', { class: 'bm-draft__tagline', text: vm.tagline }),
      h('p', { class: 'bm-draft__timer', 'data-bm-timer': 'true', text: '00:00' }),
    ),
    poolGrid,
    h(
      'div',
      { class: 'bm-draft__foot' },
      slots,
      h(
        'button',
        {
          class: 'bm-btn bm-btn--primary',
          type: 'button',
          disabled: vm.canConfirm ? undefined : 'true',
          onClick: () => cb.confirm(),
        },
        vm.lineupText,
      ),
    ),
  );
}
