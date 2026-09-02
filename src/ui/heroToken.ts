/*
 * Hero-token renderer: role SHAPE + 2-letter initials + optional Strengthen pip.
 * VM → DOM only; every decision (which shape, which colour, the initials) was
 * made in `resolveHeroArt`. A later real-image drop-in swaps the `<svg>` for an
 * `<img>` here and touches nothing else.
 */

import { h, svg } from './dom';
import { SHAPE_PATH } from './heroArt';
import type { HeroArt } from './heroArt';

export interface HeroTokenOptions {
  readonly size?: number;
  readonly strengthenPips?: number;
  readonly ariaLabel?: string;
}

export function heroToken(art: HeroArt, options: HeroTokenOptions = {}): HTMLElement {
  const size = options.size ?? 46;
  const pips = options.strengthenPips ?? 0;
  const label = options.ariaLabel ?? `${art.name || art.initials}, ${art.displayRole}`;

  const el = h(
    'span',
    {
      class: `bm-token ${art.roleClass}`,
      role: 'img',
      'aria-label': label,
      'data-hero': art.heroId,
    },
    svg(
      'svg',
      { class: 'bm-token__shape', viewBox: '0 0 100 100', 'aria-hidden': 'true' },
      svg('path', { d: SHAPE_PATH[art.shape] }),
    ),
    h('span', { class: 'bm-token__initials', text: art.initials }),
    pips > 0 ? h('span', { class: 'bm-token__pip', text: `x${pips}` }) : null,
  );
  el.style.setProperty('--bm-token-size', `${size}px`);
  el.style.setProperty('--c', `var(${art.colorVar})`);
  return el;
}
