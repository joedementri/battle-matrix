/*
 * ONE resolver for hero art, so a later real-image drop-in touches only this
 * file (the plan's explicit instruction). Today it returns an abstract token
 * spec: a role SHAPE (Vanguard shield / Duelist blade / Strategist cross), the
 * role colour token, and 2-letter initials. The Strengthen pip count is passed
 * by the caller (it is inventory state, not art).
 *
 * The role shape is LOAD-BEARING, not decoration: M11 requires the shape to
 * carry the same information as the role colour, so it is modelled here as a
 * first-class field now rather than retrofitted.
 */

import heroesJson from '../data/heroes.json';
import { ROLE_DISPLAY_NAME } from '../data/strings';
import type { DisplayRole } from '../data/strings';
import type { Role } from '../data/types';

export type RoleShape = 'shield' | 'blade' | 'cross';

export interface HeroArt {
  readonly heroId: string;
  readonly name: string;
  readonly role: Role;
  readonly displayRole: DisplayRole;
  /** Vanguard → shield, Duelist → blade, Strategist → cross. */
  readonly shape: RoleShape;
  /** The CSS custom property to colour the token with. */
  readonly colorVar: string;
  /** BEM modifier the renderer appends to `.bm-token`. */
  readonly roleClass: string;
  /** Up to two uppercase letters. */
  readonly initials: string;
}

interface HeroLite {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
}

const HEROES = heroesJson as unknown as readonly HeroLite[];
const BY_ID = new Map<string, HeroLite>(HEROES.map((hero) => [hero.id, hero]));

const SHAPE_BY_ROLE: Readonly<Record<Role, RoleShape>> = {
  vanguard: 'shield',
  duelist: 'blade',
  strategist: 'cross',
};

const COLOR_VAR_BY_ROLE: Readonly<Record<Role, string>> = {
  vanguard: '--bm-fortress',
  duelist: '--bm-onslaught',
  strategist: '--bm-reboot',
};

/** SVG path data (viewBox 0 0 100 100) for each role shape. Digits + single-letter commands only. */
export const SHAPE_PATH: Readonly<Record<RoleShape, string>> = {
  shield: 'M50 6 L90 20 V48 Q90 82 50 96 Q10 82 10 48 V20 Z',
  blade: 'M50 4 L80 44 L50 96 L20 44 Z',
  cross: 'M40 8 H60 V40 H92 V60 H60 V92 H40 V60 H8 V40 H40 Z',
};

/** First letter of the first word + first letter of the last word (or first two letters if one word). */
export function initialsOf(name: string): string {
  const words = name.split(/[^A-Za-z]+/).filter((word) => word.length > 0);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[words.length - 1]![0]!}`.toUpperCase();
}

const FALLBACK: Omit<HeroArt, 'heroId'> = {
  name: '',
  role: 'duelist',
  displayRole: 'Duelist',
  shape: 'blade',
  colorVar: '--bm-onslaught',
  roleClass: 'bm-token--duelist',
  initials: '??',
};

export function resolveHeroArt(heroId: string): HeroArt {
  const hero = BY_ID.get(heroId);
  if (hero === undefined) return { heroId, ...FALLBACK };
  return {
    heroId,
    name: hero.name,
    role: hero.role,
    displayRole: ROLE_DISPLAY_NAME[hero.role],
    shape: SHAPE_BY_ROLE[hero.role],
    colorVar: COLOR_VAR_BY_ROLE[hero.role],
    roleClass: `bm-token--${hero.role}`,
    initials: initialsOf(hero.name),
  };
}
