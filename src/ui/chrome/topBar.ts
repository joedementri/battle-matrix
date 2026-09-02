/*
 * Top-bar renderer: round-phase indicator, the phase-icon strip (completed
 * phases become ✓), and the phase name + countdown. VM → DOM; the live
 * countdown text is stamped by the app onto the `[data-bm-timer]` node.
 */

import { h } from '../dom';
import type { TopBarVM } from '../viewmodels/chrome';

export function renderTopBar(vm: TopBarVM, waitingForOthers: boolean): HTMLElement {
  const strip = h(
    'div',
    { class: 'bm-phasestrip' },
    ...vm.strip.icons.map((icon) =>
      h('span', {
        class: `bm-phasestrip__icon bm-phasestrip__icon--${icon.state}`,
        text: icon.state === 'done' ? '✓' : String(icon.phase),
      }),
    ),
  );

  const phaseLine = waitingForOthers
    ? h(
        'div',
        { class: 'bm-topbar__phase bm-topbar__phase--waiting' },
        h('span', { text: vm.waitingText }),
        h('span', { text: ' - ' }),
        h('span', { 'data-bm-timer': 'true', text: '00:00' }),
      )
    : h(
        'div',
        { class: 'bm-topbar__phase' },
        h('span', { text: vm.phaseNameText }),
        h('span', { text: ' - ' }),
        h('span', { 'data-bm-timer': 'true', text: '00:00' }),
      );

  return h(
    'div',
    { class: 'bm-topbar' },
    h(
      'div',
      { class: 'bm-topbar__box' },
      h(
        'div',
        { class: 'bm-topbar__row' },
        h('span', { class: 'bm-topbar__round', text: `⏱ ${vm.roundPhaseText}` }),
        strip,
      ),
      phaseLine,
    ),
  );
}
