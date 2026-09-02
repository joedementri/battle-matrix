/*
 * Module Draw screen — the three tabs, the rarity-odds row, the token wallet
 * with income preview, the four cards, `REFRESH` / `LOCK`. VM → DOM; every state
 * decision (PURCHASE vs UPGRADE, star fill, red price, locked padlocks) was made
 * in `shopVM` / `shopCardVM`.
 */

import { h, keyActivate } from '../dom';
import * as S from '../../data/strings';
import type { UiCallbacks } from '../intents';
import type { ShopCardVM, ShopVM } from '../viewmodels/shop';
import { renderChangeHero } from './changeHero';
import type { ChangeHeroCallbacks } from './changeHero';

const STAR_CLASS: Record<string, string> = {
  common: 'bm-star--filled-common',
  rare: 'bm-star--filled-rare',
  legendary: 'bm-star--filled-legendary',
};

function renderCard(card: ShopCardVM, slot: number, disabled: boolean, cb: UiCallbacks): HTMLElement {
  if (card.empty) {
    return h('div', { class: 'bm-card bm-card--empty', 'aria-hidden': 'true' });
  }
  const stars = h(
    'div',
    { class: 'bm-card__stars' },
    ...card.stars.map((cell) => {
      let cls = 'bm-star';
      if (cell.state === 'filled') cls += ` ${STAR_CLASS[card.rarity ?? 'common']}`;
      else if (cell.state === 'next') cls += ' bm-star--next';
      return h('span', { class: cls, text: '★' });
    }),
  );

  const el = h(
    'div',
    {
      class: `bm-card bm-card--${card.protocol}`,
      'aria-label': `${card.nameText}, ${card.label}, ${card.priceText}`,
    },
    h(
      'div',
      { class: 'bm-card__banner' },
      card.locked ? h('span', { class: 'bm-card__lock', 'aria-hidden': 'true' }) : null,
      h('span', { class: 'bm-card__glyph', 'aria-hidden': 'true' }),
      h('div', { class: 'bm-card__name', text: card.nameText }),
    ),
    h(
      'div',
      { class: 'bm-card__body' },
      h('div', { class: 'bm-card__effect', text: card.effectText }),
      stars,
      h(
        'div',
        { class: 'bm-card__foot' },
        h('span', { text: card.label ?? '' }),
        h('span', {
          class: `bm-price${card.priceIsRed ? ' bm-price--red' : ''}`,
          text: card.priceText,
        }),
      ),
    ),
  );
  keyActivate(el, () => cb.buyModule(slot), { disabled });
  return el;
}

export function renderShop(
  vm: ShopVM,
  activeTab: ShopVM['tabs'][number]['id'],
  changeHero: { readonly cards: Parameters<typeof renderChangeHero>[0]; readonly cb: ChangeHeroCallbacks },
  cb: UiCallbacks,
  locked: boolean,
): HTMLElement {
  const tabs = h(
    'div',
    { class: 'bm-shop__tabs' },
    ...vm.tabs.map((tab) =>
      h(
        'button',
        {
          class: `bm-shop__tab${tab.id === activeTab ? ' bm-shop__tab--active' : ''}`,
          type: 'button',
          onClick: () => cb.setShopTab(tab.id),
        },
        tab.label,
      ),
    ),
    h(
      'span',
      { class: 'bm-shop__wallet' },
      h('span', { class: 'bm-tokens__sym', text: '◇ ' }),
      h('span', { text: vm.wallet.text }),
    ),
  );

  const odds = h(
    'div',
    { class: 'bm-odds' },
    h('span', { class: 'bm-odds__star--common', text: `★ ${vm.odds.commonText}` }),
    h('span', { class: 'bm-odds__star--rare', text: `★ ${vm.odds.rareText}` }),
    h('span', { class: 'bm-odds__star--legendary', text: `★ ${vm.odds.legendaryText}` }),
  );

  let body: HTMLElement;
  if (activeTab === 'changeHero') {
    body = renderChangeHero(changeHero.cards, changeHero.cb);
  } else {
    body = h(
      'div',
      null,
      h(
        'div',
        { class: 'bm-shop__cards' },
        ...vm.cards.map((card, slot) => renderCard(card, slot, locked, cb)),
      ),
      h(
        'div',
        { class: 'bm-shop__actions' },
        h(
          'button',
          {
            class: 'bm-btn',
            type: 'button',
            disabled: vm.refreshEnabled ? undefined : 'true',
            onClick: () => cb.refreshShop(),
          },
          h('span', { text: `${vm.refreshLabel} ` }),
          h('span', { class: 'bm-price', text: vm.refreshCostText }),
        ),
        h('button', { class: 'bm-btn', type: 'button', onClick: () => cb.toggleLock() }, vm.lockLabel),
      ),
      vm.footnote
        ? h(
            'div',
            { class: 'bm-shop__footnote' },
            h('span', { class: 'bm-reward__bang', text: '❗ ' }),
            h('span', { text: vm.footnote }),
          )
        : null,
    );
  }

  return h(
    'div',
    { class: 'bm-shop' },
    h('h2', { class: 'bm-h2 bm-muted', text: S.SELECT_MODULES_HEADER }),
    tabs,
    odds,
    body,
  );
}
