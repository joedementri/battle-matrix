/*
 * The game loop lives HERE, not in `src/sim/` (the sim has no clock).
 *
 * `GameApp` owns the wall clock (`requestAnimationFrame` + `performance.now`),
 * an append-only `Action[]`, and a phase cursor into the boundary list `runMatch`
 * returns. Every user gesture becomes exactly one sim `Action`; the app never
 * mutates sim state. Screens route off `state.phaseKind`. Bot turns resolve
 * inside `runMatch` through `src/ai/` — the UI only renders the outcome.
 *
 * Rendering model: a full rebuild of `#app` on any state change (a few hundred
 * nodes — cheap), and a per-frame text stamp of the `[data-bm-timer]` nodes for
 * the countdown. `runMatch` is memoised on `(actions.length, simCap)`; `simCap`
 * grows as the cursor advances so an early recompute only simulates a handful of
 * rounds of real combat.
 */

import { CHANGE_HERO_COST, LINEUP_SIZE } from '../data/constants';
import { PHASE_TIMERS_SECONDS, ROUND_CAP } from '../data/authored';
import type { Protocol, Role } from '../data/types';
import type { DeployCell } from '../sim/board';
import { createCombatResolver } from '../sim/combat';
import { humanBattleContext, runMatch } from '../sim/match';
import { practiceRewardCount } from '../sim/practice';
import { changeHeroOfferIds, humanRewardOffers } from '../sim/selectors';
import type { Action, MatchResult, MatchState, PhaseKind } from '../sim/types';
import { BattleRenderer } from '../render/battleRenderer';
import type { RawDroneInput } from '../render/battleRenderer';
import { battleNames, renderBattleHost, renderBattleShopOverlay } from './screens/battle';

import { buildScene } from './chrome';
import { h, replaceChildren } from './dom';
import { clock } from './format';
import { buildAction } from './intents';
import type { UiCallbacks } from './intents';
import { renderDeploy } from './screens/deploy';
import { renderDraft } from './screens/draft';
import { renderInfoPane } from './screens/infoPane';
import { renderReward } from './screens/reward';
import { renderScoreboard } from './screens/scoreboard';
import { renderShop } from './screens/shop';
import { renderStandings } from './screens/standings';
import { renderSwapOut } from './screens/swapOut';
import { changeHeroCardsVM, swapOutVM } from './viewmodels/changeHero';
import type { SwapSelection } from './viewmodels/changeHero';
import { deployVM, defaultPlacement, placeHeroAt } from './viewmodels/deploy';
import { draftVM, toggleDraftPick } from './viewmodels/draft';
import { protocolInfoVM } from './viewmodels/infoPane';
import { rewardVM } from './viewmodels/reward';
import { scoreboardVM } from './viewmodels/scoreboard';
import { shopVM } from './viewmodels/shop';
import type { ShopTabId } from './viewmodels/shop';
import { finalStandingsVM } from './viewmodels/standings';

const TIMER_KEY: Readonly<Record<PhaseKind, keyof typeof PHASE_TIMERS_SECONDS>> = {
  draft: 'draft',
  moduleDraw: 'module',
  selectPosition: 'position',
  battle: 'battle',
  reward: 'reward',
};

/** How long "Waiting for Others" runs after an early confirm before the phase advances. */
const OTHERS_WAIT_MS = 3500;

export class GameApp {
  private readonly host: HTMLElement;
  private readonly seed: number;
  private readonly resolver = createCombatResolver();
  private readonly humanId = 0;

  private actions: Action[] = [];
  private phaseCursor = 0;
  private simCap = 8;
  private result: MatchResult;
  private resultKey = '';

  // per-phase UI-local edit state
  private draftSelection: string[] = [];
  private shopTab: ShopTabId = 'select';
  private swap: { role: Role; offers: string[]; sel: SwapSelection } | null = null;
  private changeHeroNonce = 0;
  private boardPlacement: DeployCell[] | null = null;
  private boardEdited = false;
  private boardSelectedSlot: number | null = null;
  private rewardPicks: string[] = [];
  private rewardRefreshed = false;

  private phaseTerminated = false;
  private editCommitted = false;
  private confirmedEarly = false;

  // overlays
  private scoreboardOpen = false;
  private infoPaneProtocol: Protocol | null = null;

  // M9 — battle renderer + live drone-input latch
  private battle: BattleRenderer | null = null;
  private battleShopOpen = false;
  private droneRecordingCommitted = false;
  private droneControlMode = true;
  private readonly keysDown = new Set<string>();
  private pointerVec: { x: number; y: number } | null = null;
  private pointerBeam = false;
  private altPrev = false;
  private clickDamage = false;
  private clickHeal = false;

  // wall clock
  private phaseSeconds: number = PHASE_TIMERS_SECONDS.draft;
  private phaseStartMs = 0;
  private othersReadyAt = Number.POSITIVE_INFINITY;
  private advancing = false;

  private readonly cb: UiCallbacks;

  constructor(host: HTMLElement, seed: number) {
    this.host = host;
    this.seed = seed >>> 0;
    this.result = runMatch(this.seed, this.actions, this.resolver, { maxRounds: this.simCap });
    this.resultKey = `0:${this.simCap}`;
    this.cb = this.buildCallbacks();
  }

  start(): void {
    this.phaseStartMs = performance.now();
    document.addEventListener('keydown', this.onGlobalKey);
    document.addEventListener('keyup', this.onGlobalKeyUp);
    this.render();
    requestAnimationFrame(this.tick);
  }

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  private get boundaries() {
    return this.result.boundaries;
  }

  private get cursor(): number {
    return Math.min(this.phaseCursor, this.boundaries.length - 1);
  }

  private state(): MatchState {
    return this.boundaries[this.cursor]!.state;
  }

  private humanPlayer() {
    return this.state().players[this.humanId]!;
  }

  // -----------------------------------------------------------------------
  // Sim recompute (memoised) + cap growth
  // -----------------------------------------------------------------------

  private recompute(): void {
    const key = `${this.actions.length}:${this.simCap}`;
    if (key !== this.resultKey) {
      this.result = runMatch(this.seed, this.actions, this.resolver, { maxRounds: this.simCap });
      this.resultKey = key;
    }
    const round = this.state().round;
    if (this.simCap < ROUND_CAP && round + 3 >= this.simCap) {
      this.simCap = Math.min(ROUND_CAP, round + 8);
      this.result = runMatch(this.seed, this.actions, this.resolver, { maxRounds: this.simCap });
      this.resultKey = `${this.actions.length}:${this.simCap}`;
    }
  }

  // -----------------------------------------------------------------------
  // Phase transitions
  // -----------------------------------------------------------------------

  private commitEdits(): void {
    if (this.editCommitted) return;
    this.editCommitted = true;
    const kind = this.state().phaseKind;
    if (kind === 'draft' && this.draftSelection.length === LINEUP_SIZE) {
      this.actions.push(buildAction.selectLineup(this.draftSelection));
    } else if (kind === 'selectPosition' && this.boardEdited && this.boardPlacement) {
      this.actions.push(buildAction.deploy(this.boardPlacement));
    }
  }

  private appendTerminator(): void {
    if (this.phaseTerminated) return;
    this.commitEdits();
    this.actions.push(buildAction.advanceTimer());
    this.phaseTerminated = true;
  }

  private resetPhaseLocal(): void {
    this.phaseTerminated = false;
    this.editCommitted = false;
    this.confirmedEarly = false;
    this.swap = null;
    this.shopTab = 'select';
    this.boardPlacement = null;
    this.boardEdited = false;
    this.boardSelectedSlot = null;
    this.rewardPicks = [];
    this.rewardRefreshed = false;
    this.scoreboardOpen = false;
    this.infoPaneProtocol = null;
    this.battleShopOpen = false;
    this.droneRecordingCommitted = false;
    this.droneControlMode = true;
    this.keysDown.clear();
    this.pointerBeam = false;
    this.phaseSeconds = PHASE_TIMERS_SECONDS[TIMER_KEY[this.state().phaseKind]];
    this.phaseStartMs = performance.now();
    this.othersReadyAt = Number.POSITIVE_INFINITY;
  }

  private toggleBattleShop(): void {
    this.battleShopOpen = !this.battleShopOpen;
    this.render();
  }

  private closeBattleShop(): void {
    this.battleShopOpen = false;
    this.render();
  }

  private advancePhase(): void {
    if (this.state().status === 'complete') return;
    // M9 — the Battle Phase is ending: bank the flown drone stream as a
    // `driveDrone` action so `runMatch` resolves this round with what the
    // player actually flew, then tear down the renderer.
    this.commitDroneRecording();
    this.disposeBattle();
    this.appendTerminator();
    this.phaseCursor += 1;
    this.recompute();
    this.resetPhaseLocal();
    this.render();
  }

  /** Push this round's recorded drone-input stream exactly once. */
  private commitDroneRecording(): void {
    if (this.battle === null || this.droneRecordingCommitted) return;
    this.droneRecordingCommitted = true;
    this.actions.push({
      type: 'driveDrone',
      round: this.state().round,
      input: this.battle.recordedInput,
    });
  }

  private disposeBattle(): void {
    if (this.battle === null) return;
    this.battle.dispose();
    this.battle = null;
    this.battleShopOpen = false;
  }

  /** In-round "READY" — confirm early and show "Waiting for Others" while the timer runs. */
  private readyUp(): void {
    if (this.phaseTerminated || this.state().status === 'complete') return;
    this.commitEdits();
    this.actions.push(buildAction.confirmPhase());
    this.phaseTerminated = true;
    this.confirmedEarly = true;
    this.othersReadyAt = performance.now() + OTHERS_WAIT_MS;
    this.recompute();
    this.render();
  }

  /** Draft confirm — advances straight away (the draft screen has no in-round chrome). */
  private confirmDraft(): void {
    if (this.phaseTerminated) return;
    this.commitEdits();
    this.actions.push(buildAction.confirmPhase());
    this.phaseTerminated = true;
    this.advancePhase();
  }

  // -----------------------------------------------------------------------
  // rAF tick — stamp the countdown, advance on timeout / others-ready
  // -----------------------------------------------------------------------

  private readonly tick = (): void => {
    const remaining = this.remainingSeconds();
    this.stampTimers(remaining);
    const timedOut = remaining <= 0;
    const othersDone = this.confirmedEarly && performance.now() >= this.othersReadyAt;
    if ((timedOut || othersDone) && !this.advancing && this.state().status !== 'complete') {
      this.advancing = true;
      this.advancePhase();
      this.advancing = false;
    }
    requestAnimationFrame(this.tick);
  };

  private remainingSeconds(): number {
    const elapsed = (performance.now() - this.phaseStartMs) / 1000;
    return Math.max(0, this.phaseSeconds - elapsed);
  }

  private stampTimers(remaining: number): void {
    const text = clock(remaining);
    for (const el of this.host.querySelectorAll('[data-bm-timer]')) el.textContent = text;
    this.stampDebug();
  }

  /** `?debug` (URL hash) — live battle frame-timing readout in the corner. */
  private stampDebug(): void {
    if (typeof window === 'undefined' || !/(^|[#&?])debug(=1)?(&|$)/.test(window.location.hash)) {
      return;
    }
    let el = this.host.querySelector('[data-bm-debug]') as HTMLElement | null;
    if (this.battle === null) {
      el?.remove();
      return;
    }
    if (el === null) {
      el = document.createElement('div');
      el.setAttribute('data-bm-debug', 'true');
      this.host.appendChild(el);
    }
    const s = this.battle.stats();
    el.textContent =
      `tick ${this.battle.controllerRef.tick}  ticks ${s.ticks}  frames ${s.frames}\n` +
      `frame ${s.avgFrameMs.toFixed(2)}ms (build ${s.avgBuildMs.toFixed(2)} draw ${s.avgDrawMs.toFixed(2)})  worst ${s.worstFrameMs.toFixed(1)}ms`;
  }

  private readonly onGlobalKey = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      event.preventDefault();
      this.cb.toggleScoreboard();
      return;
    }
    if (event.key === 'Escape') {
      if (this.battleShopOpen) this.closeBattleShop();
      else if (this.infoPaneProtocol) this.cb.closeInfoPane();
      else if (this.scoreboardOpen) this.cb.toggleScoreboard();
      else if (this.swap) this.cb.cancelSwap();
      return;
    }
    // --- M9 battle controls (only while the Battle Phase is showing) ---
    if (this.state().phaseKind !== 'battle') return;
    const k = event.key.toLowerCase();
    if (k === 'b') {
      this.toggleBattleShop();
      return;
    }
    if (k === 'alt') {
      if (!this.altPrev) this.droneControlMode = !this.droneControlMode;
      this.altPrev = true;
      event.preventDefault();
      return;
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'e'].includes(k)) {
      this.keysDown.add(k);
    }
  };

  private readonly onGlobalKeyUp = (event: KeyboardEvent): void => {
    const k = event.key.toLowerCase();
    if (k === 'alt') this.altPrev = false;
    this.keysDown.delete(k);
  };

  /** Latch of raw drone input — read once per sim tick by the battle renderer. */
  private readonly sampleInput = (): RawDroneInput => {
    let dx = 0;
    let dy = 0;
    if (this.keysDown.has('a') || this.keysDown.has('arrowleft')) dx -= 1;
    if (this.keysDown.has('d') || this.keysDown.has('arrowright')) dx += 1;
    if (this.keysDown.has('w') || this.keysDown.has('arrowup')) dy -= 1;
    if (this.keysDown.has('s') || this.keysDown.has('arrowdown')) dy += 1;
    if (dx === 0 && dy === 0 && this.droneControlMode && this.pointerVec) {
      dx = this.pointerVec.x;
      dy = this.pointerVec.y;
    } else if (dx !== 0 || dy !== 0) {
      const m = Math.sqrt(dx * dx + dy * dy);
      dx /= m;
      dy /= m;
    }
    const pressDamage = this.keysDown.has('shift') || this.clickDamage;
    const pressHeal = this.keysDown.has('e') || this.clickHeal;
    this.clickDamage = false;
    this.clickHeal = false;
    return {
      dirX: dx,
      dirY: dy,
      beam: this.pointerBeam && this.droneControlMode,
      pressDamage,
      pressHeal,
      droneControl: this.droneControlMode,
    };
  };

  // -----------------------------------------------------------------------
  // Callbacks
  // -----------------------------------------------------------------------

  private buildCallbacks(): UiCallbacks {
    return {
      toggleDraftPick: (heroId) => {
        this.draftSelection = toggleDraftPick(this.draftSelection, heroId);
        this.render();
      },
      setShopTab: (tab) => {
        this.shopTab = tab;
        this.render();
      },
      buyModule: (slot) => {
        this.actions.push(buildAction.buyModule(slot));
        this.recompute();
        this.render();
      },
      refreshShop: () => {
        this.actions.push(buildAction.refreshShop());
        this.recompute();
        this.render();
      },
      toggleLock: () => {
        this.actions.push(buildAction.lockShop());
        this.recompute();
        this.render();
      },
      openChangeHero: (role) => {
        if (this.humanPlayer().tokens < CHANGE_HERO_COST) return;
        this.changeHeroNonce += 1;
        const offers = changeHeroOfferIds(
          this.seed,
          this.state().round,
          this.changeHeroNonce,
          role,
          this.humanPlayer().lineup,
        );
        this.swap = { role, offers, sel: { incoming: null, outgoing: null } };
        this.render();
      },
      pickSwapIncoming: (heroId) => {
        if (this.swap) this.swap = { ...this.swap, sel: { ...this.swap.sel, incoming: heroId } };
        this.render();
      },
      pickSwapOutgoing: (heroId) => {
        if (this.swap) this.swap = { ...this.swap, sel: { ...this.swap.sel, outgoing: heroId } };
        this.render();
      },
      confirmSwap: () => {
        const swap = this.swap;
        if (!swap || swap.sel.incoming === null || swap.sel.outgoing === null) return;
        this.actions.push(buildAction.swapHero(swap.sel.incoming, swap.sel.outgoing));
        this.swap = null;
        this.recompute();
        this.render();
      },
      cancelSwap: () => {
        this.swap = null;
        this.render();
      },
      moveHero: (slot, cell) => {
        const size = this.humanPlayer().lineup.length;
        const base = this.boardPlacement ?? defaultPlacement(size);
        this.boardPlacement = placeHeroAt(base, slot, cell);
        this.boardEdited = true;
        this.render();
      },
      selectBoardSlot: (slot) => {
        this.boardSelectedSlot = slot;
        this.render();
      },
      selectReward: (moduleId) => {
        const needed = practiceRewardCount(this.state().round);
        if (this.rewardPicks.length >= needed || this.rewardPicks.includes(moduleId)) return;
        this.rewardPicks.push(moduleId);
        this.actions.push(buildAction.selectReward(moduleId));
        this.recompute();
        this.render();
      },
      refreshReward: () => {
        if (this.rewardRefreshed) return;
        this.rewardRefreshed = true;
        this.rewardPicks = [];
        this.actions.push(buildAction.refreshReward());
        this.recompute();
        this.render();
      },
      openInfoPane: (protocol) => {
        this.infoPaneProtocol = this.infoPaneProtocol === protocol ? null : protocol;
        this.render();
      },
      closeInfoPane: () => {
        this.infoPaneProtocol = null;
        this.render();
      },
      toggleScoreboard: () => {
        this.scoreboardOpen = !this.scoreboardOpen;
        this.render();
      },
      confirmPhase: () => this.readyUp(),
    };
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  private render(): void {
    const state = this.state();

    if (state.status === 'complete') {
      replaceChildren(this.host, renderStandings(finalStandingsVM(state)));
      return;
    }
    if (state.phaseKind === 'draft') {
      const vm = draftVM(this.humanPlayer().pool, this.draftSelection);
      replaceChildren(
        this.host,
        renderDraft(vm, {
          toggle: this.cb.toggleDraftPick,
          confirm: () => this.confirmDraft(),
        }),
      );
      this.stampTimers(this.remainingSeconds());
      return;
    }

    const { root, stage } = buildScene(state, this.humanId, {
      openProtocol: this.infoPaneProtocol,
      waitingForOthers: this.confirmedEarly,
      onProtocolClick: this.cb.openInfoPane,
    });
    if (this.confirmedEarly) stage.classList.add('bm-stage--locked');

    if (this.scoreboardOpen) {
      stage.appendChild(renderScoreboard(scoreboardVM(state), this.cb.toggleScoreboard));
    } else if (this.swap) {
      const vm = swapOutVM(
        this.humanPlayer().lineup,
        this.humanPlayer().strengthen,
        this.swap.offers,
        this.swap.sel,
      );
      stage.appendChild(
        renderSwapOut(vm, {
          pickIncoming: this.cb.pickSwapIncoming,
          pickOutgoing: this.cb.pickSwapOutgoing,
          confirm: this.cb.confirmSwap,
          cancel: this.cb.cancelSwap,
        }),
      );
    } else {
      stage.appendChild(this.renderScreen(state));
    }

    if (this.infoPaneProtocol) {
      stage.appendChild(
        renderInfoPane(
          protocolInfoVM(state, this.humanId, this.infoPaneProtocol),
          this.cb.closeInfoPane,
        ),
      );
    }

    stage.appendChild(this.readyBar());

    replaceChildren(this.host, root);
    this.stampTimers(this.remainingSeconds());

    // M9 — the battle renderer owns a persistent <canvas> that must survive this
    // full DOM rebuild. Mount it once, then re-parent it into each fresh
    // `.bm-battle` host; tear it down when the Battle Phase is not showing.
    this.syncBattleRenderer(state);
  }

  private syncBattleRenderer(state: MatchState): void {
    if (state.phaseKind !== 'battle') {
      this.disposeBattle();
      return;
    }
    const host = this.host.querySelector('.bm-battle');
    if (!(host instanceof HTMLElement)) return; // an overlay (scoreboard) replaced the stage

    if (this.battle === null) {
      const names = battleNames(state, this.humanId);
      const preBattle = this.boundaries.find(
        (b) => b.round === state.round && b.kind === 'selectPosition',
      );
      const mine = state.matchups.find((m) => m.a === this.humanId || m.b === this.humanId);
      if (preBattle === undefined || mine === undefined) return;
      const ctx = humanBattleContext(
        preBattle.state,
        { kind: mine.kind, a: mine.a, b: mine.b },
        null,
      );
      this.battle = new BattleRenderer(host, {
        ctx,
        humanPlayerId: this.humanId,
        playerName: names.playerName,
        opponentName: names.opponentName,
        sampleInput: this.sampleInput,
        reducedMotion:
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
      this.wireBattlePointer(this.battle.element);
      this.battle.start();
    } else if (this.battle.element.parentNode !== host) {
      host.appendChild(this.battle.element);
      this.battle.resize();
    }

    if (this.battleShopOpen) {
      const vm = shopVM(state, this.humanId);
      const shopEl = renderShop(
        vm,
        this.shopTab,
        { cards: changeHeroCardsVM(), cb: { openRole: this.cb.openChangeHero } },
        this.cb,
        vm.locked,
      );
      host.appendChild(
        renderBattleShopOverlay({ shopEl, onClose: () => this.closeBattleShop() }),
      );
    }
  }

  private wireBattlePointer(canvas: HTMLCanvasElement): void {
    const toVec = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        this.pointerVec = null;
        return;
      }
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      const m = Math.sqrt(nx * nx + ny * ny);
      this.pointerVec = m < 0.03 ? null : { x: (nx / m) * Math.min(1, m * 3), y: (ny / m) * Math.min(1, m * 3) };
    };
    canvas.addEventListener('pointermove', toVec);
    canvas.addEventListener('pointerdown', (e) => {
      const hit = this.battle?.hitTest(e.offsetX, e.offsetY);
      if (hit === 'ability-damage') this.clickDamage = true;
      else if (hit === 'ability-heal') this.clickHeal = true;
      else this.pointerBeam = true;
    });
    canvas.addEventListener('pointerup', () => {
      this.pointerBeam = false;
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointerVec = null;
      this.pointerBeam = false;
    });
  }

  private renderScreen(state: MatchState): HTMLElement {
    switch (state.phaseKind) {
      case 'moduleDraw': {
        const vm = shopVM(state, this.humanId);
        return renderShop(
          vm,
          this.shopTab,
          { cards: changeHeroCardsVM(), cb: { openRole: this.cb.openChangeHero } },
          this.cb,
          vm.locked,
        );
      }
      case 'selectPosition': {
        const size = this.humanPlayer().lineup.length;
        const placement = this.boardPlacement ?? defaultPlacement(size);
        return renderDeploy(
          deployVM(this.humanPlayer().lineup, placement),
          { selectedSlot: this.boardSelectedSlot },
          this.cb,
          () => {
            if (!this.boardPlacement) {
              this.boardPlacement = defaultPlacement(size);
              this.boardEdited = true;
            }
            this.readyUp();
          },
        );
      }
      case 'reward': {
        const offers = humanRewardOffers(
          this.seed,
          state.round,
          this.humanId,
          this.humanPlayer().lineup,
          this.humanPlayer().strengthen,
          this.rewardRefreshed,
        ).offers;
        return renderReward(rewardVM(state, offers, this.rewardPicks, this.rewardRefreshed ? 1 : 0), {
          select: this.cb.selectReward,
          refresh: this.cb.refreshReward,
        });
      }
      case 'battle':
      default:
        // The M9 Canvas2D renderer + HUD is mounted into this host after the
        // DOM rebuild (`syncBattleRenderer`), so it survives `replaceChildren`.
        return renderBattleHost();
    }
  }

  private readyBar(): HTMLElement {
    return h(
      'div',
      { class: 'bm-readybar' },
      this.confirmedEarly
        ? h('span', { class: 'bm-muted', text: '…' })
        : h(
            'button',
            { class: 'bm-btn bm-btn--primary', type: 'button', onClick: () => this.readyUp() },
            'READY',
          ),
    );
  }
}
