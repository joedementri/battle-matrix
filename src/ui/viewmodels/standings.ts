/*
 * Final Standings view model (screen 9). No screenshot exists; kept consistent
 * with the scoreboard's `Rank` language. PURE, no DOM.
 */

import * as S from '../../data/strings';
import type { MatchState } from '../../sim/types';

export interface StandingRowVM {
  readonly placement: number;
  readonly playerId: number;
  readonly name: string;
  readonly isSelf: boolean;
  readonly isWinner: boolean;
}

export interface StandingsVM {
  readonly title: string; // `FINAL STANDINGS`
  readonly rankLabel: string; // `Rank`
  readonly winnerId: number | null;
  readonly complete: boolean;
  readonly rows: readonly StandingRowVM[];
}

export function finalStandingsVM(state: MatchState): StandingsVM {
  const rows: StandingRowVM[] = state.players
    .map((p) => ({
      placement: p.placement ?? state.players.length,
      playerId: p.id,
      name: p.name,
      isSelf: p.isHuman,
      isWinner: state.winnerId === p.id,
    }))
    .sort((a, b) => (a.placement !== b.placement ? a.placement - b.placement : a.playerId - b.playerId));
  return {
    title: S.FINAL_STANDINGS,
    rankLabel: S.COL_RANK,
    winnerId: state.winnerId,
    complete: state.status === 'complete',
    rows,
  };
}
