/*
 * Practice-round Reward Phase screen — `SELECT REWARD`, three gold Strengthen
 * cards, `REFRESH 1/1`, `❗ Select N Strengthen Modules`, the delayed-effect
 * tooltip. The card name / effect / keybind are EMPTY (M1 skeleton) and rendered
 * as-is; M10 fills them without touching this renderer. VM → DOM.
 */

import { h, keyActivate } from '../dom';
import { heroToken } from '../heroToken';
import type { RewardCardVM, RewardVM } from '../viewmodels/reward';

export interface RewardScreenCallbacks {
  readonly select: (moduleId: string) => void;
  readonly refresh: () => void;
}

function rewardCard(card: RewardCardVM, disabled: boolean, cb: RewardScreenCallbacks): HTMLElement {
  const effect = h('div', { class: 'bm-strcard__effect' });
  if (card.effectText !== '') effect.appendChild(h('span', { text: card.effectText }));
  if (card.keybind !== '') {
    effect.appendChild(h('span', { text: ' ' }));
    effect.appendChild(h('span', { class: 'bm-keybind', text: card.keybind }));
  }

  const el = h(
    'div',
    {
      class: `bm-strcard${card.selected ? ' bm-strcard--sel' : ''}`,
      'aria-label': card.nameText || card.moduleId,
    },
    heroToken(card.art, { size: 44 }),
    h('div', { class: 'bm-strcard__name', text: card.nameText }),
    effect,
    h('span', { class: 'bm-btn', text: card.selectLabel }),
  );
  keyActivate(el, () => cb.select(card.moduleId), { disabled });
  return el;
}

export function renderReward(vm: RewardVM, cb: RewardScreenCallbacks): HTMLElement {
  return h(
    'div',
    { class: 'bm-reward' },
    h('h2', { class: 'bm-screen-title', text: vm.title }),
    h(
      'div',
      { class: 'bm-reward__cards' },
      ...vm.cards.map((card) => rewardCard(card, !vm.canPickMore && !card.selected, cb)),
    ),
    h(
      'button',
      {
        class: 'bm-btn',
        type: 'button',
        disabled: vm.refreshEnabled ? undefined : 'true',
        onClick: () => cb.refresh(),
      },
      vm.refreshLabel,
    ),
    h(
      'div',
      { class: 'bm-reward__instruction' },
      h('span', { class: 'bm-reward__bang', text: '❗' }),
      h('span', { text: vm.instructionText }),
    ),
    h('p', { class: 'bm-swap__footnote', text: vm.delayedEffectTooltip }),
  );
}
