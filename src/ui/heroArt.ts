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
import { GALACTA_ARCHETYPE_IDS } from '../sim/galacta';
import { DRONE_COLOURS } from '../data/constants';

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

// ---------------------------------------------------------------------------
// M9 — one resolver for every kind of thing the battle renderer draws:
// heroes, Galacta Bots (visually distinct MONSTER tokens, not heroes), and the
// Ultron Drone. Same one-file drop-in property: a real-image pack swaps the
// `shape` / `spritePath` here and nothing downstream changes.
// ---------------------------------------------------------------------------

export type UnitShape = RoleShape | 'monster';
export type UnitCategory = 'hero' | 'bot';

export interface UnitArt {
  readonly id: string;
  readonly name: string;
  readonly category: UnitCategory;
  readonly role: Role;
  readonly shape: UnitShape;
  /** CSS custom property the executor resolves to a concrete colour. */
  readonly colorVar: string;
  /** SVG path data (viewBox 0 0 100 100), single-letter commands + digits only. */
  readonly shapePath: string;
  readonly initials: string;
}

/** A blobby, asymmetric monster silhouette — deliberately un-heroic. */
const MONSTER_PATH =
  'M50 8 L64 20 L82 16 L78 34 L92 46 L74 56 L80 76 L58 68 L44 90 L36 66 L14 70 L24 50 L8 36 L28 30 L26 10 L44 22 Z';

const GALACTA_META: Readonly<Record<string, { readonly name: string; readonly role: Role }>> = {
  'galacta-swarm': { name: 'Swarm', role: 'duelist' },
  'galacta-brute': { name: 'Brute', role: 'vanguard' },
  'galacta-caster': { name: 'Caster', role: 'strategist' },
};

export function isGalactaId(id: string): boolean {
  return GALACTA_ARCHETYPE_IDS.includes(id);
}

/** Resolve battle art for a hero id OR a Galacta archetype id. */
export function resolveUnitArt(id: string): UnitArt {
  if (isGalactaId(id)) {
    const meta = GALACTA_META[id] ?? { name: 'Monster', role: 'duelist' as Role };
    return {
      id,
      name: meta.name,
      category: 'bot',
      role: meta.role,
      shape: 'monster',
      colorVar: '--bm-galacta',
      shapePath: MONSTER_PATH,
      initials: meta.name.slice(0, 2).toUpperCase(),
    };
  }
  const hero = resolveHeroArt(id);
  return {
    id,
    name: hero.name,
    category: 'hero',
    role: hero.role,
    shape: hero.shape,
    colorVar: hero.colorVar,
    shapePath: SHAPE_PATH[hero.shape],
    initials: hero.initials,
  };
}

export type DroneColourName = (typeof DRONE_COLOURS)[number];

export interface DroneArt {
  readonly colour: DroneColourName;
  /** Concrete hex — drone colours are literal, not theme tokens. */
  readonly colorHex: string;
  /** SVG path data (viewBox 0 0 100 100) — a forward chevron, clearly not a unit token. */
  readonly shapePath: string;
}

const DRONE_HEX: Readonly<Record<DroneColourName, string>> = {
  Blue: '#4aa8ff',
  Yellow: '#ffd23f',
  White: '#eef1f8',
  Default: '#b8c0d8',
  Red: '#ff5a52',
  Green: '#3fb964',
};

const DRONE_PATH = 'M50 6 L86 40 L68 40 L68 94 L32 94 L32 40 L14 40 Z';

export function resolveDroneArt(colour: string): DroneArt {
  const name = (DRONE_COLOURS as readonly string[]).includes(colour)
    ? (colour as DroneColourName)
    : 'Default';
  return { colour: name, colorHex: DRONE_HEX[name], shapePath: DRONE_PATH };
}
