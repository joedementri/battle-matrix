/*
 * Assembles the persistent in-round chrome around an empty stage the active
 * screen renderer fills. All rule-free: it only calls the chrome view models and
 * the dumb renderers.
 */

import { h } from '../dom';
import {
  healthBarVM,
  keyHintsVM,
  leftRailVM,
  rightPanelVM,
  topBarVM,
} from '../viewmodels/chrome';
import type { MatchState } from '../../sim/types';
import type { Protocol } from '../../data/types';
import { renderHealthBar, renderKeyHints } from './healthBar';
import { renderLeftRail } from './leftRail';
import { renderRightPanel } from './rightPanel';
import { renderTopBar } from './topBar';

export interface ChromeOptions {
  readonly openProtocol: Protocol | null;
  readonly waitingForOthers: boolean;
  readonly onProtocolClick: (protocol: Protocol) => void;
}

export interface SceneChrome {
  readonly root: HTMLElement;
  /** The active screen renderer appends its content here. */
  readonly stage: HTMLElement;
}

export function buildScene(
  state: MatchState,
  playerId: number,
  options: ChromeOptions,
): SceneChrome {
  const stage = h('div', { class: 'bm-stage' });
  const root = h(
    'div',
    { class: 'bm-scene' },
    h('div', { class: 'bm-topbar-slot' }, renderTopBar(topBarVM(state), options.waitingForOthers)),
    h(
      'div',
      { class: 'bm-rail-slot' },
      renderLeftRail(leftRailVM(state, playerId, options.openProtocol), options.onProtocolClick),
    ),
    stage,
    h('div', { class: 'bm-health-slot' }, renderHealthBar(healthBarVM(state, playerId))),
    h('div', { class: 'bm-panel-slot' }, renderRightPanel(rightPanelVM(state))),
    renderKeyHints(keyHintsVM(state)),
  );
  return { root, stage };
}
