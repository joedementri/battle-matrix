/*
 * Scoreboard (TAB) view model. The plan: the scoreboard is fully public — all
 * six lineups, all four protocol levels, Strengthen counts, tokens, health,
 * streaks — rendered from the real AI archetypes' state with nothing hidden.
 *
 * Ordering + the top-3 divider index come from `sim/selectors.scoreboardOrder`.
 * PURE, no DOM.
 */

import * as S from '../../data/strings';
import type { Protocol } from '../../data/types';
import { PROTOCOLS, levelsFromXp, totalStrengthen } from '../../sim/modules';
import { scoreboardOrder } from '../../sim/selectors';
import type { MatchState, StreakKind } from '../../sim/types';
import { resolveHeroArt } from '../heroArt';
import type { HeroArt } from '../heroArt';

export interface SbProtocolVM {
  readonly protocol: Protocol;
  readonly displayName: string;
  readonly level: number; // 0..3, === levelsFromXp(player.protocolXp)[protocol]
}

export interface SbRowVM {
  readonly rank: number; // 1-based
  readonly playerId: number;
  readonly name: string;
  readonly isSelf: boolean;
  readonly dimmed: boolean; // rank below the top-3 cutoff
  readonly out: boolean;
  readonly deploy: readonly HeroArt[]; // the player's six-hero lineup, public
  readonly protocols: readonly SbProtocolVM[]; // exactly four
  readonly strengthenCount: number;
  readonly tokens: number;
  readonly tokensText: string;
  readonly health: number;
  readonly healthText: string; // number, or `Out of Play`
  readonly streakKind: StreakKind;
  readonly streak: number;
}

export interface ScoreboardVM {
  readonly columns: readonly [string, string, string, string];
  readonly rows: readonly SbRowVM[];
  /** Rows `[0, dividerAfterIndex)` sit above the top-3 divider. */
  readonly dividerAfterIndex: number;
}

export function scoreboardVM(state: MatchState): ScoreboardVM {
  const { order, topCutoffIndex } = scoreboardOrder(state);
  const rows: SbRowVM[] = order.map((playerId, index) => {
    const p = state.players[playerId]!;
    const levels = levelsFromXp(p.protocolXp);
    const rank = index + 1;
    return {
      rank,
      playerId,
      name: p.name,
      isSelf: p.isHuman,
      dimmed: index >= topCutoffIndex,
      out: !p.alive,
      deploy: p.lineup.map((heroId) => resolveHeroArt(heroId)),
      protocols: PROTOCOLS.map((protocol) => ({
        protocol,
        displayName: S.PROTOCOL_DISPLAY_NAME[protocol],
        level: levels[protocol],
      })),
      strengthenCount: totalStrengthen(p.strengthen),
      tokens: p.tokens,
      tokensText: `${S.TOKEN_SYMBOL}${p.tokens}`,
      health: p.health,
      healthText: p.alive ? String(p.health) : S.OUT_OF_PLAY,
      streakKind: p.streakKind,
      streak: p.streak,
    };
  });
  return {
    columns: [S.COL_RANK, S.COL_PLAYER_NAME, S.COL_DEPLOY, S.COL_INITIATE_PROTOCOL],
    rows,
    dividerAfterIndex: topCutoffIndex,
  };
}
