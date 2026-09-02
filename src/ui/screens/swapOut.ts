/*
 * Swap-out overlay — `SELECT HERO TO SWAP OUT`, the RESERVE row above the ACTIVE
 * row with a `⇄` between them, per-hero Strengthen pips, the conversion
 * footnote, `CONFIRM` / `CANCEL`. Confirm is blocked until one hero from each
 * row is chosen (the VM computes `confirmEnabled`). VM → DOM.
 */

import { h, keyActivate } from '../dom';
import { heroToken } from '../heroToken';
import type { SwapOutVM, SwapPickVM } from '../viewmodels/changeHero';

export interface SwapOutCallbacks {
  readonly pickIncoming: (heroId: string) => void;
  readonly pickOutgoing: (heroId: string) => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

function pickButton(pick: SwapPickVM, onPick: (heroId: string) => void): HTMLElement {
  const el = h(
    'div',
    { class: `bm-swap__pick${pick.selected ? ' bm-swap__pick--sel' : ''}` },
    heroToken(pick.art, { size: 46, strengthenPips: pick.strengthenPips }),
    h('span', { class: 'bm-swap__pick-name', text: pick.art.name }),
  );
  keyActivate(el, () => onPick(pick.heroId));
  return el;
}

export function renderSwapOut(vm: SwapOutVM, cb: SwapOutCallbacks): HTMLElement {
  const reserveRow = h(
    'div',
    { class: 'bm-swap__row bm-swap__row--reserve' },
    ...vm.reserve.map((pick) => pickButton(pick, cb.pickIncoming)),
  );
  const activeRow = h(
    'div',
    { class: 'bm-swap__row bm-swap__row--active' },
    ...vm.active.map((pick) => pickButton(pick, cb.pickOutgoing)),
  );

  return h(
    'div',
    { class: 'bm-swap' },
    h('h2', { class: 'bm-screen-title', text: vm.title }),
    h('p', { class: 'bm-swap__sub', text: vm.subtitle }),
    h('div', { class: 'bm-swap__rowlabel', text: vm.reserveLabel }),
    reserveRow,
    h('div', { class: 'bm-swap__arrow', text: '⇄' }),
    h('div', { class: 'bm-swap__rowlabel', text: vm.activeLabel }),
    activeRow,
    h('p', { class: 'bm-swap__footnote', text: vm.footnote }),
    h(
      'div',
      { class: 'bm-swap__actions' },
      h(
        'button',
        {
          class: 'bm-btn bm-btn--primary',
          type: 'button',
          disabled: vm.confirmEnabled ? undefined : 'true',
          onClick: () => cb.confirm(),
        },
        vm.confirmLabel,
      ),
      h('button', { class: 'bm-btn', type: 'button', onClick: () => cb.cancel() }, vm.cancelLabel),
    ),
  );
}
