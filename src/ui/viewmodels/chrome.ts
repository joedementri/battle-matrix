/*
 * View models for the persistent in-round chrome — top bar, phase strip, left
 * protocol rail, right player panel, bottom health bar, key hints.
 *
 * PURE `state -> plain data`. No DOM. Every number is read straight off the sim
 * state or a `src/sim` selector; this file only picks strings and shapes the
 * data. The live phase countdown is a wall-clock value the app owns and the
 * renderer merges in — it is deliberately NOT here.
 */

import { STARTING_HEALTH } from '../../data/constants';
import * as S from '../../data/strings';
import { phaseCountOf } from '../../sim/match';
import { PROTOCOLS, totalStrengthen } from '../../sim/modules';
import { leftRailMeter, rankByHealthDesc } from '../../sim/selectors';
import type { MatchState, PhaseKind, StreakKind } from '../../sim/types';
import type { Protocol } from '../../data/types';

// ---------------------------------------------------------------------------
// Phase name + phase-icon strip
// ---------------------------------------------------------------------------

/** The header string under the round-phase indicator, per the plan's phase table. */
export function phaseName(state: MatchState): string {
  switch (state.phaseKind) {
    case 'draft':
      return S.ASSEMBLE_YOUR_TEAM;
    case 'moduleDraw':
      // The plan: "round 1 shows the round type"; every later Module Draw shows
      // the generic header.
      return state.round === 1 ? S.PRACTICE_PROTOCOL : S.SELECT_MODULES_HEADER;
    case 'selectPosition':
      return S.SELECT_POSITION;
    case 'battle':
      return S.BATTLE_PROTOCOL;
    case 'reward':
      return S.PRACTICE_PROTOCOL_REWARD_PHASE;
  }
}

export type PhaseIconState = 'done' | 'active' | 'pending';

export interface PhaseStripVM {
  readonly count: number; // 3 on PvP rounds, 4 on Practice rounds
  readonly icons: readonly { readonly phase: number; readonly state: PhaseIconState }[];
}

export function phaseStripVM(state: MatchState): PhaseStripVM {
  const count = state.round >= 1 ? phaseCountOf(state.round) : 3;
  const icons: { phase: number; state: PhaseIconState }[] = [];
  for (let phase = 1; phase <= count; phase += 1) {
    let iconState: PhaseIconState = 'pending';
    if (phase < state.phase) iconState = 'done';
    else if (phase === state.phase) iconState = 'active';
    icons.push({ phase, state: iconState });
  }
  return { count, icons };
}

export interface TopBarVM {
  readonly roundPhaseText: string; // `1-1`, `9-3`
  readonly phaseNameText: string;
  readonly waitingText: string; // `Waiting for Others`
  readonly strip: PhaseStripVM;
}

export function topBarVM(state: MatchState): TopBarVM {
  return {
    roundPhaseText: S.roundPhase(state.round, state.phase),
    phaseNameText: phaseName(state),
    waitingText: S.WAITING_FOR_OTHERS,
    strip: phaseStripVM(state),
  };
}

// ---------------------------------------------------------------------------
// Left rail — four protocol meters + the Strengthen counter
// ---------------------------------------------------------------------------

export interface RailProtoVM {
  readonly protocol: Protocol;
  readonly displayName: string;
  readonly meterText: string; // `16/20`, `23/40`
  readonly badge: number; // level 0..3
  readonly xp: number;
  readonly nextThreshold: number;
  readonly atMax: boolean;
  readonly active: boolean; // its info pane is open
}

export interface LeftRailVM {
  readonly protocols: readonly RailProtoVM[];
  readonly strengthenCount: number;
}

export function leftRailVM(
  state: MatchState,
  playerId: number,
  openProtocol: Protocol | null = null,
): LeftRailVM {
  const player = state.players[playerId];
  return {
    protocols: PROTOCOLS.map((protocol) => {
      const xp = player ? player.protocolXp[protocol] : 0;
      const meter = leftRailMeter(xp);
      return {
        protocol,
        displayName: S.PROTOCOL_DISPLAY_NAME[protocol],
        meterText: S.xpMeter(meter.xp, meter.nextThreshold),
        badge: meter.level,
        xp: meter.xp,
        nextThreshold: meter.nextThreshold,
        atMax: meter.atMax,
        active: openProtocol === protocol,
      };
    }),
    strengthenCount: player ? totalStrengthen(player.strengthen) : 0,
  };
}

// ---------------------------------------------------------------------------
// Right panel — player list, health descending
// ---------------------------------------------------------------------------

export interface PlayerRowVM {
  readonly playerId: number;
  readonly name: string;
  readonly isSelf: boolean;
  readonly out: boolean;
  readonly health: number;
  readonly healthText: string; // number, or `Out of Play`
  readonly tokens: number;
  readonly tokensText: string; // `◇10`
  readonly streakKind: StreakKind;
  readonly streak: number;
  readonly streakText: string; // the count, or '' when there is no streak yet
}

export interface RightPanelVM {
  readonly rows: readonly PlayerRowVM[];
}

export function rightPanelVM(state: MatchState): RightPanelVM {
  return {
    rows: rankByHealthDesc(state.players).map((id) => {
      const p = state.players[id]!;
      return {
        playerId: id,
        name: p.name,
        isSelf: p.isHuman,
        out: !p.alive,
        health: p.health,
        healthText: p.alive ? String(p.health) : S.OUT_OF_PLAY,
        tokens: p.tokens,
        tokensText: `${S.TOKEN_SYMBOL}${p.tokens}`,
        streakKind: p.streakKind,
        streak: p.streak,
        streakText: p.streakKind === 'none' ? '' : String(p.streak),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Bottom-centre health bar
// ---------------------------------------------------------------------------

export interface HealthBarVM {
  readonly current: number;
  readonly max: number;
  readonly text: string; // `50/50`
}

export function healthBarVM(state: MatchState, playerId: number): HealthBarVM {
  const p = state.players[playerId];
  const current = p ? p.health : 0;
  return { current, max: STARTING_HEALTH, text: `${current}/${STARTING_HEALTH}` };
}

// ---------------------------------------------------------------------------
// Contextual key hints (bottom-right)
// ---------------------------------------------------------------------------

const HINTS_BY_PHASE: Readonly<Record<PhaseKind, readonly string[]>> = {
  draft: [S.HINT_ENTER_CHAT],
  moduleDraw: [S.HINT_ENTER_CHAT, S.HINT_TAB_SCOREBOARD, S.HINT_ESC_BACK, S.HINT_B_DEPLOY],
  selectPosition: [S.HINT_TAB_SCOREBOARD, S.HINT_ESC_MENU, S.HINT_EXIT_EDITING],
  battle: [S.HINT_TAB_SCOREBOARD, S.HINT_ESC_MENU, S.HINT_LALT_CURSOR_MODE, S.HINT_B_MODULES],
  reward: [S.HINT_ENTER_CHAT, S.HINT_TAB_SCOREBOARD, S.HINT_B_MODULES],
};

export interface KeyHintsVM {
  readonly hints: readonly string[];
}

export function keyHintsVM(state: MatchState): KeyHintsVM {
  return { hints: HINTS_BY_PHASE[state.phaseKind] };
}
