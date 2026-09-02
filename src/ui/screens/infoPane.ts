/*
 * Protocol info pane (left-rail click) — header + XP meter, the three tier
 * bonuses with the earned one in cyan, the `★ = XP+1 · …` legend, then the
 * Owned Modules list showing each module's CUMULATIVE value at its owned star
 * level. VM → DOM.
 */

import { h } from '../dom';
import * as S from '../../data/strings';
import type { InfoPaneVM, OwnedModuleVM } from '../viewmodels/infoPane';

const STAR_CLASS: Record<string, string> = {
  common: 'bm-star--filled-common',
  rare: 'bm-star--filled-rare',
  legendary: 'bm-star--filled-legendary',
};

function ownedModule(entry: OwnedModuleVM): HTMLElement {
  const stars = h(
    'div',
    { class: 'bm-card__stars' },
    ...entry.starCells.map((cell) => {
      let cls = 'bm-star';
      if (cell.state === 'filled') cls += ` ${STAR_CLASS[entry.rarity]}`;
      else if (cell.state === 'next') cls += ' bm-star--next';
      return h('span', { class: cls, text: '★' });
    }),
  );
  return h(
    'div',
    { class: 'bm-owned' },
    h('div', { class: `bm-owned__name bm-owned__name--${entry.rarity}`, text: entry.name }),
    stars,
    h('div', { class: 'bm-owned__effect', text: entry.effectText }),
  );
}

export function renderInfoPane(vm: InfoPaneVM, onClose: () => void): HTMLElement {
  return h(
    'div',
    { class: `bm-infopane ${vm.roleClass}` },
    h('button', { class: 'bm-btn bm-infopane__close', type: 'button', onClick: () => onClose() }, S.BTN_CANCEL),
    h('div', { class: 'bm-infopane__title', text: vm.titleText }),
    h('div', { class: 'bm-infopane__xp', text: `XP ${vm.meterText}` }),
    ...vm.tiers.map((tier) =>
      h('div', {
        class: `bm-infopane__tier${tier.earned ? ' bm-infopane__tier--earned' : ''}`,
        text: tier.text,
      }),
    ),
    h(
      'div',
      { class: 'bm-infopane__legend' },
      ...vm.legendParts.map((part) => h('span', { text: part })),
    ),
    h('div', { class: 'bm-infopane__owned-h', text: vm.ownedHeader }),
    vm.owned.length === 0
      ? h('div', { class: 'bm-owned__effect', text: '—' })
      : h('div', null, ...vm.owned.map(ownedModule)),
  );
}
