/*
 * Bottom-centre health bar (`50/50`) and bottom-right contextual key hints.
 * VM → DOM. The fill width is a CSS `calc()` over two custom properties, so no
 * JS arithmetic touches the health value.
 */

import { h, setVar } from '../dom';
import type { HealthBarVM, KeyHintsVM } from '../viewmodels/chrome';

export function renderHealthBar(vm: HealthBarVM): HTMLElement {
  const fill = h('span', { class: 'bm-healthbar__fill' });
  setVar(fill, '--h', vm.current);
  setVar(fill, '--m', vm.max);
  return h(
    'div',
    { class: 'bm-healthbar' },
    h('span', { class: 'bm-healthbar__track' }, fill),
    h('span', { class: 'bm-healthbar__num', text: vm.text }),
  );
}

export function renderKeyHints(vm: KeyHintsVM): HTMLElement {
  return h(
    'div',
    { class: 'bm-hints' },
    ...vm.hints.map((hint) => {
      const [key, ...rest] = hint.split(' ');
      return h(
        'span',
        null,
        h('span', { class: 'bm-hints__key', text: key ?? '' }),
        h('span', { text: rest.join(' ') }),
      );
    }),
  );
}
