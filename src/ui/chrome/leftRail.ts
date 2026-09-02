/*
 * Left-rail renderer: four protocol meters (`xp/nextThreshold` + level badge),
 * the gold Strengthen counter, and the click target that opens each protocol's
 * info pane. VM → DOM.
 */

import { h, setVar } from '../dom';
import type { LeftRailVM } from '../viewmodels/chrome';
import type { Protocol } from '../../data/types';

export function renderLeftRail(
  vm: LeftRailVM,
  onProtocolClick: (protocol: Protocol) => void,
): HTMLElement {
  const protoButtons = vm.protocols.map((proto) => {
    const track = h('span', { class: 'bm-rail__track' }, h('span', { class: 'bm-rail__fill' }));
    const fill = track.firstElementChild as HTMLElement;
    setVar(fill, '--xp', proto.xp);
    setVar(fill, '--th', proto.nextThreshold);

    const button = h(
      'button',
      {
        class: `bm-rail__proto bm-rail__proto--${proto.protocol}${proto.active ? ' bm-rail__proto--active' : ''}`,
        type: 'button',
        title: proto.displayName,
        'aria-pressed': proto.active ? 'true' : 'false',
        onClick: () => onProtocolClick(proto.protocol),
      },
      h(
        'span',
        { class: 'bm-rail__glyph' },
        h('span', { class: 'bm-rail__badge', text: String(proto.badge) }),
      ),
      h('span', { class: 'bm-rail__meter', text: proto.meterText }),
      track,
    );
    button.style.setProperty('--c', `var(--bm-${proto.protocol})`);
    return button;
  });

  return h(
    'div',
    { class: 'bm-rail' },
    ...protoButtons,
    h(
      'div',
      { class: 'bm-rail__strengthen' },
      h('span', { class: 'bm-rail__glyph' }, h('span', { text: '⚡' })),
      h('span', { text: `x${vm.strengthenCount}` }),
    ),
  );
}
