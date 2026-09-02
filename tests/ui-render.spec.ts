// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runMatch } from '../src/sim/match';
import { createStubCombatResolver } from '../src/sim/stubCombat';

import { GameApp } from '../src/ui/app';
import { buildScene } from '../src/ui/chrome';
import { renderScoreboard } from '../src/ui/screens/scoreboard';
import { renderInfoPane } from '../src/ui/screens/infoPane';
import { renderReward } from '../src/ui/screens/reward';
import { scoreboardVM } from '../src/ui/viewmodels/scoreboard';
import { protocolInfoVM } from '../src/ui/viewmodels/infoPane';
import { rewardVM } from '../src/ui/viewmodels/reward';

/*
 * Renderer smoke tests (happy-dom, scoped per-file). Proves the screens build
 * real DOM and that `GameApp` routes through a full match: driven only by
 * clicking the on-screen READY / confirm affordances, never by waiting on the
 * wall clock.
 */

afterEach(() => {
  document.body.innerHTML = '';
});

function mountHost(): HTMLElement {
  const host = document.createElement('div');
  host.id = 'app';
  document.body.appendChild(host);
  return host;
}

function clickAll(nodes: Iterable<Element>): void {
  for (const node of nodes) (node as HTMLElement).click();
}

describe('GameApp routes through the screens', () => {
  it('boots on the Draft screen', () => {
    const app = new GameApp(mountHost(), 20250606);
    app.start();
    expect(document.querySelector('.bm-draft')).not.toBeNull();
    expect(document.querySelector('.bm-pool-card')).not.toBeNull();
  });

  it('draft → Module Draw → Select Position → Battle → (Reward) → round 2, no throw', () => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
    try {
      const host = mountHost();
      const app = new GameApp(host, 20250606);
      app.start();

      // pick six heroes and confirm the draft
      clickAll([...host.querySelectorAll('.bm-pool-card')].slice(0, 6));
      (host.querySelector('.bm-draft__foot .bm-btn--primary') as HTMLElement).click();

      // Module Draw
      expect(host.querySelector('.bm-shop'), 'shop after draft').not.toBeNull();
      expect(host.querySelector('.bm-scene'), 'in-round chrome present').not.toBeNull();
      expect(host.querySelectorAll('.bm-card').length).toBe(4);
      // buy the first card, then READY
      (host.querySelector('.bm-card') as HTMLElement).click();

      // walk phases: click READY / DEPLOY, then let "Waiting for Others" elapse
      let guard = 0;
      let sawBattle = false;
      let sawReward = false;
      while (roundOf(host) < 2 && guard < 60) {
        guard += 1;
        if (host.querySelector('.bm-battle')) sawBattle = true;
        if (host.querySelector('.bm-reward')) sawReward = true;
        const deploy = host.querySelector('.bm-deploy__actions .bm-btn--primary') as HTMLElement | null;
        const ready = host.querySelector('.bm-readybar .bm-btn') as HTMLElement | null;
        (deploy ?? ready)?.click();
        vi.advanceTimersByTime(5000); // outlast "Waiting for Others"
      }
      expect(roundOf(host)).toBeGreaterThanOrEqual(2);
      expect(sawBattle, 'battle screen seen in round 1').toBe(true);
      expect(sawReward, 'reward screen seen in round 1 (Practice)').toBe(true);
      expect(host.querySelector('.bm-scene')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('TAB opens the scoreboard overlay; a left-rail click opens the info pane', () => {
    const host = mountHost();
    const app = new GameApp(host, 7);
    app.start();
    clickAll([...host.querySelectorAll('.bm-pool-card')].slice(0, 6));
    (host.querySelector('.bm-draft__foot .bm-btn--primary') as HTMLElement).click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(host.querySelector('.bm-scoreboard'), 'scoreboard after TAB').not.toBeNull();
    expect(host.querySelectorAll('.bm-sb-row').length).toBeGreaterThan(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(host.querySelector('.bm-scoreboard')).toBeNull();

    (host.querySelector('.bm-rail__proto') as HTMLElement).click();
    expect(host.querySelector('.bm-infopane'), 'info pane after left-rail click').not.toBeNull();
    expect(host.querySelector('.bm-infopane__legend')?.children.length).toBe(3);
  });
});

function roundOf(host: HTMLElement): number {
  const text = host.querySelector('.bm-topbar__round')?.textContent ?? '0-0';
  return Number(text.replace(/[^\d-]/g, '').split('-')[0] ?? '0');
}

describe('screen renderers build DOM from view models', () => {
  const res = runMatch(31337, [], createStubCombatResolver());
  const state = res.boundaries.find((b) => b.round >= 3 && b.phase === 1)!.state;

  it('buildScene assembles the persistent chrome', () => {
    const { root, stage } = buildScene(state, 0, {
      openProtocol: null,
      waitingForOthers: false,
      onProtocolClick: () => {},
    });
    expect(root.querySelector('.bm-topbar')).not.toBeNull();
    expect(root.querySelector('.bm-rail')).not.toBeNull();
    expect(root.querySelectorAll('.bm-rail__proto').length).toBe(4);
    expect(root.querySelector('.bm-panel')).not.toBeNull();
    expect(root.querySelectorAll('.bm-prow').length).toBe(6);
    expect(root.querySelector('.bm-healthbar')).not.toBeNull();
    expect(root.querySelector('.bm-hints')).not.toBeNull();
    expect(stage.className).toContain('bm-stage');
  });

  it('scoreboard renderer shows six rows + the divider', () => {
    const el = renderScoreboard(scoreboardVM(state), () => {});
    expect(el.querySelectorAll('.bm-sb-row__rank').length).toBe(6);
    expect(el.querySelector('.bm-sb-divider')).not.toBeNull();
  });

  it('info-pane renderer shows three tier rows and the legend', () => {
    const el = renderInfoPane(protocolInfoVM(state, 0, 'fortress'), () => {});
    expect(el.querySelectorAll('.bm-infopane__tier').length).toBe(3);
    expect(el.querySelectorAll('.bm-infopane__legend span').length).toBe(3);
  });

  // M10 — the M8 Reward screen was built to render from data with no invented
  // text; with strengthen.json now populated it lights up on its own, and the
  // pre-existing `.bm-keybind` chip affordance carries the screenshot keybinds.
  it('reward screen renders real Strengthen name / effect text and a keybind chip', () => {
    const offers = ['loki-s2', 'hela-s1', 'groot-s2']; // three screenshot-verbatim rows
    const el = renderReward(rewardVM(state, offers, [], 0), { select: () => {}, refresh: () => {} });

    const names = [...el.querySelectorAll('.bm-strcard__name')].map((n) => n.textContent);
    expect(names).toEqual(["Loki's Sanctuary", 'Soul Reaper', 'Ghost Thornlash Wall']);

    const effects = [...el.querySelectorAll('.bm-strcard__effect')].map((n) => n.textContent ?? '');
    expect(effects[0]).toContain('Reduce Regeneration Domain cooldown by 18s');
    expect(effects.every((t) => t.length > 20)).toBe(true); // no empty cards

    const chips = [...el.querySelectorAll('.bm-keybind')].map((c) => c.textContent);
    expect(chips).toEqual(['LSHIFT', 'LMB', 'LSHIFT']); // one inline chip per card
  });
});
