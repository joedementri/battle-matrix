/*
 * Protocol info pane (opened by a left-rail click). Header + XP meter, the three
 * tier-bonus rows with the earned one flagged, the `★ = XP+1 …` legend, then the
 * Owned Modules list showing each owned module's CUMULATIVE value at its owned
 * star level (`modules.ownedValue`, a table lookup — never a sum).
 *
 * PURE, no DOM.
 */

import * as S from '../../data/strings';
import type { Protocol, Rarity } from '../../data/types';
import {
  levelsFromXp,
  moduleById,
  ownedValue,
} from '../../sim/modules';
import { leftRailMeter, protocolTierRows } from '../../sim/selectors';
import type { MatchState } from '../../sim/types';
import { renderModuleEffect, starRow } from '../format';
import type { StarCell } from '../format';

function tierLineText(bonus: Readonly<Record<string, number>>): string {
  return Object.entries(bonus)
    .map(([key, value]) => {
      const unit = /Pct/.test(key) ? '%' : '';
      const label = S.STAT_LABEL[key] ?? key;
      return `+${value}${unit} ${label}`;
    })
    .join(' · ');
}

export interface TierRowVM {
  readonly tierIndex: number; // 0-based; tier 2 = Level 3
  readonly earned: boolean;
  readonly text: string;
}

export interface OwnedModuleVM {
  readonly moduleId: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly stars: number;
  readonly maxStars: number;
  readonly starCells: readonly StarCell[];
  readonly valueText: string; // cumulative value at owned level, one decimal
  readonly effectText: string;
}

export interface InfoPaneVM {
  readonly protocol: Protocol;
  readonly displayName: string;
  readonly titleText: string; // `Protocol: Fortress`
  readonly meterText: string; // `16/20`
  readonly xp: number;
  readonly level: number;
  readonly tiers: readonly TierRowVM[];
  readonly legendParts: readonly string[]; // `★ = XP+1`, `★ = XP+2`, `★ = XP+4`
  readonly ownedHeader: string; // `Owned Modules:`
  readonly owned: readonly OwnedModuleVM[];
  readonly roleClass: string; // `bm-infopane--fortress`
}

export function protocolInfoVM(
  state: MatchState,
  playerId: number,
  protocol: Protocol,
): InfoPaneVM {
  const player = state.players[playerId];
  const xp = player ? player.protocolXp[protocol] : 0;
  const meter = leftRailMeter(xp);
  const level = player ? levelsFromXp(player.protocolXp)[protocol] : 0;
  const ownedModules = player ? player.ownedModules : [];

  return {
    protocol,
    displayName: S.PROTOCOL_DISPLAY_NAME[protocol],
    titleText: S.protocolPaneTitle(S.PROTOCOL_DISPLAY_NAME[protocol]),
    meterText: S.xpMeter(meter.xp, meter.nextThreshold),
    xp: meter.xp,
    level,
    tiers: protocolTierRows(protocol, level).map((row) => ({
      tierIndex: row.tierIndex,
      earned: row.earned,
      text: tierLineText(row.bonus),
    })),
    legendParts: [...S.XP_LEGEND_PARTS],
    ownedHeader: S.OWNED_MODULES,
    roleClass: `bm-infopane--${protocol}`,
    owned: ownedModules
      .filter((owned) => moduleById(owned.moduleId).protocol === protocol)
      .map((owned) => {
        const module = moduleById(owned.moduleId);
        const disp = ownedValue(module, owned.stars); // cumulative at owned level
        return {
          moduleId: owned.moduleId,
          name: module.name,
          rarity: module.rarity,
          stars: owned.stars,
          maxStars: module.values.length,
          starCells: starRow(owned.stars, module.values.length),
          valueText: disp.value.toFixed(1),
          effectText: renderModuleEffect(module.effect, disp.value, disp.isPercent),
        };
      }),
  };
}
