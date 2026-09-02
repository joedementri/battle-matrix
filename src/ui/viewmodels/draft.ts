/*
 * Draft screen view model — the 18-hero pool, the six lineup slots, the
 * `LINEUP (n/6)` confirm state. PURE `state -> data`, no DOM.
 */

import { LINEUP_SIZE } from '../../data/constants';
import * as S from '../../data/strings';
import { resolveHeroArt } from '../heroArt';
import type { HeroArt } from '../heroArt';

export interface DraftPoolCardVM {
  readonly heroId: string;
  readonly art: HeroArt;
  readonly picked: boolean;
  /** True when the lineup is already full and this hero is not in it. */
  readonly disabled: boolean;
}

export interface DraftVM {
  readonly modeTitle: string;
  readonly tagline: string;
  readonly assembleTitle: string;
  readonly lineupText: string; // `LINEUP (3/6)`
  readonly canConfirm: boolean;
  readonly lineupSize: number;
  readonly slots: readonly (HeroArt | null)[];
  readonly pool: readonly DraftPoolCardVM[];
}

export function draftVM(pool: readonly string[], selected: readonly string[]): DraftVM {
  const chosen = new Set(selected);
  const full = chosen.size >= LINEUP_SIZE;
  const slots: (HeroArt | null)[] = [];
  for (let i = 0; i < LINEUP_SIZE; i += 1) {
    const heroId = selected[i];
    slots.push(heroId === undefined ? null : resolveHeroArt(heroId));
  }
  return {
    modeTitle: S.MODE_TITLE,
    tagline: S.TAGLINE,
    assembleTitle: S.ASSEMBLE_YOUR_TEAM,
    lineupText: S.lineup(chosen.size),
    canConfirm: chosen.size === LINEUP_SIZE,
    lineupSize: LINEUP_SIZE,
    slots,
    pool: pool.map((heroId) => ({
      heroId,
      art: resolveHeroArt(heroId),
      picked: chosen.has(heroId),
      disabled: full && !chosen.has(heroId),
    })),
  };
}

/** Pure reducer for a pool-card click: toggle membership, never exceed the lineup size. */
export function toggleDraftPick(selected: readonly string[], heroId: string): string[] {
  if (selected.includes(heroId)) return selected.filter((id) => id !== heroId);
  if (selected.length >= LINEUP_SIZE) return selected.slice();
  return [...selected, heroId];
}
