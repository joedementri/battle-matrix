/*
 * Practice-round Reward Phase view model.
 *
 * IMPORTANT: `strengthen.json` is an M1 skeleton — every row's `name` / `effect`
 * / `keybind` is an empty string, filled by M10. This VM renders the STRUCTURE
 * (three gold cards, hero art, `SELECT`, `REFRESH 1/1`, `Select N Strengthen
 * Modules`) and passes the empty text through verbatim. Nothing is invented; the
 * screen lights up when M10 lands without a renderer change.
 *
 * PURE, no DOM.
 */

import * as S from '../../data/strings';
import strengthenJson from '../../data/strengthen.json';
import type { StrengthenModuleSkeleton } from '../../data/types';
import { practiceRewardCount } from '../../sim/practice';
import type { MatchState } from '../../sim/types';
import { resolveHeroArt } from '../heroArt';
import type { HeroArt } from '../heroArt';

const ROWS = strengthenJson as unknown as readonly StrengthenModuleSkeleton[];
const BY_ID = new Map<string, StrengthenModuleSkeleton>(ROWS.map((row) => [row.id, row]));

export interface RewardCardVM {
  readonly moduleId: string;
  readonly heroId: string;
  readonly art: HeroArt;
  readonly nameText: string; // '' until M10
  readonly effectText: string; // '' until M10
  readonly keybind: string; // '' until M10 — render a chip only when non-empty
  readonly selected: boolean;
  readonly selectLabel: string;
}

export interface RewardVM {
  readonly title: string; // `SELECT REWARD`
  readonly phaseHeader: string; // `PRACTICE PROTOCOL REWARD PHASE`
  readonly instructionText: string; // `Select 1 Strengthen Modules`
  readonly bangText: string; // the `❗` icon stand-in is the renderer's; this is the phrase
  readonly refreshLabel: string; // `REFRESH 1/1`
  readonly refreshEnabled: boolean;
  readonly needed: number;
  readonly canPickMore: boolean;
  readonly cards: readonly RewardCardVM[];
  readonly delayedEffectTooltip: string;
}

export function rewardVM(
  state: MatchState,
  offers: readonly string[],
  picks: readonly string[],
  refreshesUsed: number,
): RewardVM {
  const needed = practiceRewardCount(state.round);
  return {
    title: S.SELECT_REWARD,
    phaseHeader: S.PRACTICE_PROTOCOL_REWARD_PHASE,
    instructionText: S.selectNStrengthen(needed),
    bangText: S.selectNStrengthen(needed),
    refreshLabel: S.REFRESH_1_1,
    refreshEnabled: refreshesUsed < 1,
    needed,
    canPickMore: picks.length < needed,
    delayedEffectTooltip: S.PURCHASED_MODULES_TOOLTIP,
    cards: offers.map((moduleId) => {
      const row = BY_ID.get(moduleId);
      const heroId = row ? row.heroId : '';
      return {
        moduleId,
        heroId,
        art: resolveHeroArt(heroId),
        nameText: row ? row.name : '',
        effectText: row ? row.effect : '',
        keybind: row ? row.keybind : '',
        selected: picks.includes(moduleId),
        selectLabel: S.BTN_SELECT,
      };
    }),
  };
}
