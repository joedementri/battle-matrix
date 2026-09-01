/*
 * Pure validator for the canonical data layer. `validate()` returns a list of
 * problems — it never throws, never calls `process.exit`, and has no console or
 * other side effects on import, so it is safe to run at dev boot and from tests.
 *
 * It encodes the M1 assertions plus the authored-combat-stat band checks. The
 * data test also re-derives the key facts independently (its own baseHealth
 * table, its own counts) so a mistake here and a matching mistake in the data
 * cannot pass together.
 *
 * Data files import nothing from `ui/` or `render/`.
 */

import heroesJson from './heroes.json';
import modulesJson from './modules.json';
import strengthenJson from './strengthen.json';
import galactaJson from './galacta.json';

import * as C from './constants';
import {
  AUTHORED_ELSEWHERE,
  COMBAT_BANDS,
  INTEREST_CAP,
  MODULE_BUY_LEGENDARY,
  MODULE_BUY_RARE,
  PVP_WIN_TOKEN_BONUS,
  RARITY_ODDS_LEGENDARY_COEFF,
  RARITY_ODDS_RARE_COEFF,
  ROUND_CAP,
} from './authored';
import type {
  AttackType,
  BaseModule,
  GalactaData,
  Hero,
  ModuleScope,
  ModuleStat,
  ModuleTarget,
  Problem,
  Protocol,
  Rarity,
  Role,
  StrengthenModuleSkeleton,
  Targeting,
  UltArchetype,
} from './types';

// The JSON files are untyped literals; these views are proven correct by the
// checks below (shape mismatches surface as problems, not type errors).
const heroes = heroesJson as unknown as readonly Hero[];
const modules = modulesJson as unknown as readonly BaseModule[];
const strengthen = strengthenJson as unknown as readonly StrengthenModuleSkeleton[];
const galacta = galactaJson as unknown as GalactaData;

// ---------------------------------------------------------------------------
// Deterministic id rule
// ---------------------------------------------------------------------------

/**
 * kebab-case id rule, applied to both hero and module display names:
 * lowercase → `&` becomes `and` → every run of non-alphanumerics becomes a
 * single `-` (so "Star-Lord" keeps its hyphen as a separator) → trim stray `-`.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Canonical reference tables (independent of the JSON)
// ---------------------------------------------------------------------------

/** CANONICAL base health, transcribed from the plan's "Hero roster" table. */
const CANONICAL_BASE_HEALTH: Readonly<Record<string, number>> = {
  'captain-america': 575,
  'doctor-strange': 575,
  'emma-frost': 600,
  groot: 700,
  hulk: 700,
  magneto: 650,
  'peni-parker': 650,
  'the-thing': 700,
  thor: 600,
  venom: 675,
  'black-panther': 275,
  'black-widow': 250,
  hawkeye: 250,
  hela: 250,
  'human-torch': 250,
  'iron-fist': 300,
  'iron-man': 250,
  magik: 250,
  'mister-fantastic': 375,
  'moon-knight': 275,
  namor: 275,
  psylocke: 250,
  'scarlet-witch': 250,
  'spider-man': 250,
  'squirrel-girl': 275,
  'star-lord': 250,
  storm: 250,
  'the-punisher': 300,
  'winter-soldier': 275,
  wolverine: 350,
  'adam-warlock': 275,
  'cloak-and-dagger': 275,
  'invisible-woman': 275,
  'jeff-the-land-shark': 250,
  loki: 275,
  'luna-snow': 275,
  mantis: 250,
  'rocket-raccoon': 250,
  ultron: 250,
};

const ROLE_COUNTS: Readonly<Record<Role, number>> = {
  vanguard: 10,
  duelist: 20,
  strategist: 9,
};

const TARGETINGS: readonly Targeting[] = ['nearest', 'lowestMaxHealth', 'highestMaxHealth'];
const ULT_ARCHETYPES: readonly UltArchetype[] = [
  'singleTargetBurst',
  'aoeBurst',
  'sustainedBeam',
  'teamHealBurst',
  'shieldDamageReduction',
  'selfBuff',
];
const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];
const ATTACK_TYPES: readonly AttackType[] = ['melee', 'ranged', 'sniper'];
const PROTOCOLS: readonly Protocol[] = ['fortress', 'onslaught', 'reboot', 'equilibrium'];
const RARITIES: readonly Rarity[] = ['common', 'rare', 'legendary'];
const SCOPES: readonly ModuleScope[] = ['flat', 'perRoleUnit', 'perUniqueRole'];
const TARGETS: readonly ModuleTarget[] = ['ally', 'enemy'];
const STATS: readonly ModuleStat[] = [
  'attackSpeed',
  'damage',
  'healing',
  'damageAndHealing',
  'maxHealth',
  'damageTaken',
  'ultCharge',
  'lifesteal',
  'lostHealthRegen',
  'lastStandDamage',
  'vulnerability',
  'overflowToBonusHealth',
  'healingAsDamage',
  'bonusHealthAtRoundStart',
  'ultEnergyAtRoundStart',
  'enemyMaxHealth',
  'enemyDamageOutput',
  'enemyHealing',
  'behavioural',
];

/** Common `values.length` is 6 everywhere except this one known source quirk. */
const FORTRESS_DAMAGE_ENHANCEMENT_ID = 'fortress-damage-enhancement';
const VALUES_LENGTH_BY_RARITY: Readonly<Record<Rarity, number>> = {
  common: 6,
  rare: 3,
  legendary: 1,
};

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

const EPS = 1e-9;
const inRange = (x: number, lo: number, hi: number): boolean => x >= lo - EPS && x <= hi + EPS;
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function validate(): Problem[] {
  const problems: Problem[] = [];
  const add = (code: string, message: string): void => {
    problems.push({ code, message });
  };

  validateHeroes(add);
  validateModules(add);
  validateStrengthen(add);
  validateGalacta(add);
  validateConstants(add);
  validateAuthored(add);

  return problems;
}

type Add = (code: string, message: string) => void;

function validateHeroes(add: Add): void {
  if (heroes.length !== 39) add('heroes/count', `expected 39 heroes, got ${heroes.length}`);

  const byRole: Record<string, number> = { vanguard: 0, duelist: 0, strategist: 0 };
  const seen = new Set<string>();

  for (const h of heroes) {
    if (seen.has(h.id)) add('heroes/id-unique', `duplicate hero id: ${h.id}`);
    seen.add(h.id);

    if (!KEBAB.test(h.id)) add('heroes/id-kebab', `hero id is not kebab-case: ${h.id}`);
    const expectedId = slugify(h.name);
    if (h.id !== expectedId) {
      add('heroes/id-rule', `hero "${h.name}" should have id "${expectedId}", has "${h.id}"`);
    }

    if (!ROLES.includes(h.role)) add('heroes/role-value', `${h.id}: bad role "${h.role}"`);
    else byRole[h.role] = (byRole[h.role] ?? 0) + 1;

    const canon = CANONICAL_BASE_HEALTH[h.id];
    if (canon === undefined) {
      add('heroes/base-health-table', `${h.id} is not in the canonical base-health table`);
    } else if (h.baseHealth !== canon) {
      add('heroes/base-health', `${h.id}: baseHealth ${h.baseHealth} ≠ canonical ${canon}`);
    }

    if (!TARGETINGS.includes(h.targeting)) {
      add('heroes/targeting-value', `${h.id}: bad targeting "${h.targeting}"`);
    }

    if (h.ult === undefined || !ULT_ARCHETYPES.includes(h.ult.archetype)) {
      add(
        'heroes/ult-archetype',
        `${h.id}: ult.archetype must be one of ${ULT_ARCHETYPES.join(' / ')}, got ${JSON.stringify(h.ult)}`,
      );
    }

    validateHeroCombat(add, h);
  }

  for (const role of ROLES) {
    if (byRole[role] !== ROLE_COUNTS[role]) {
      add('heroes/role-count', `expected ${ROLE_COUNTS[role]} ${role}s, got ${byRole[role] ?? 0}`);
    }
  }

  const canonKeys = Object.keys(CANONICAL_BASE_HEALTH);
  if (canonKeys.length !== 39) {
    add('heroes/base-health-table', `canonical base-health table has ${canonKeys.length} rows, expected 39`);
  }

  // Every ult archetype is represented — a mapping that silently collapses to one
  // or two archetypes is a bug, not a balance choice.
  const usedArchetypes = new Set(heroes.map((h) => h.ult?.archetype).filter(Boolean));
  for (const a of ULT_ARCHETYPES) {
    if (!usedArchetypes.has(a)) add('heroes/ult-archetype-unused', `no hero maps to ult archetype "${a}"`);
  }

  // Targeting partitions the roster: every hero in exactly one of the three lists.
  const partition = TARGETINGS.map((t) => heroes.filter((h) => h.targeting === t).length);
  const partitionSum = partition.reduce((a, b) => a + b, 0);
  if (partitionSum !== heroes.length) {
    add('heroes/targeting-partition', `targeting lists cover ${partitionSum} heroes, expected ${heroes.length}`);
  }
}

function validateHeroCombat(add: Add, h: Hero): void {
  const band = COMBAT_BANDS[h.role];
  const c = h.combat;
  const where = `${h.id}/combat`;

  if (!inRange(h.baseHealth, band.baseHealth[0], band.baseHealth[1])) {
    add(`${where}/base-health-band`, `${h.id}: baseHealth ${h.baseHealth} outside ${band.baseHealth.join('–')}`);
  }
  if (!inRange(c.dps, band.dps[0], band.dps[1])) {
    add(`${where}/dps-band`, `${h.id}: dps ${c.dps} outside ${band.dps.join('–')}`);
  }
  if (!inRange(c.moveSpeed, band.moveSpeed[0], band.moveSpeed[1])) {
    add(`${where}/move-band`, `${h.id}: moveSpeed ${c.moveSpeed} outside ${band.moveSpeed.join('–')}`);
  }
  if (!(c.attackSpeed > 0)) {
    add(`${where}/attack-speed`, `${h.id}: attackSpeed must be > 0, got ${c.attackSpeed}`);
  }
  if (!band.attackTypes.includes(c.attackType)) {
    add(`${where}/attack-type`, `${h.id}: attackType "${c.attackType}" not valid for a ${h.role}`);
  }

  if (c.attackType === 'melee') {
    const mr = band.meleeRange;
    if (!mr) add(`${where}/range-band`, `${h.id}: ${h.role} has no melee range band`);
    else if (!inRange(c.attackRange, mr[0], mr[1])) {
      add(`${where}/range-band`, `${h.id}: melee attackRange ${c.attackRange} outside ${mr.join('–')}`);
    }
  } else {
    const rr = band.rangedRange;
    if (!rr) add(`${where}/range-band`, `${h.id}: ${h.role} has no ranged range band`);
    else if (!inRange(c.attackRange, rr[0], rr[1])) {
      add(`${where}/range-band`, `${h.id}: ${c.attackType} attackRange ${c.attackRange} outside ${rr.join('–')}`);
    }
  }

  if (h.role === 'strategist') {
    const hb = band.healPerSecond;
    if (c.healPerSecond === undefined) {
      add(`${where}/heal`, `${h.id}: Strategist is missing healPerSecond`);
    } else if (hb && !inRange(c.healPerSecond, hb[0], hb[1])) {
      add(`${where}/heal-band`, `${h.id}: healPerSecond ${c.healPerSecond} outside ${hb.join('–')}`);
    }
  } else if (c.healPerSecond !== undefined) {
    add(`${where}/heal`, `${h.id}: only Strategists carry healPerSecond`);
  }
}

function validateModules(add: Add): void {
  if (modules.length !== 64) add('modules/count', `expected 64 modules, got ${modules.length}`);

  const seen = new Set<string>();
  const perProtocol: Record<string, Record<string, number>> = {};
  for (const p of PROTOCOLS) perProtocol[p] = { common: 0, rare: 0, legendary: 0 };

  for (const m of modules) {
    if (seen.has(m.id)) add('modules/id-unique', `duplicate module id: ${m.id}`);
    seen.add(m.id);

    if (!PROTOCOLS.includes(m.protocol)) add('modules/protocol-value', `${m.id}: bad protocol "${m.protocol}"`);
    if (!RARITIES.includes(m.rarity)) add('modules/rarity-value', `${m.id}: bad rarity "${m.rarity}"`);
    if (!SCOPES.includes(m.scope)) add('modules/scope-value', `${m.id}: bad scope "${m.scope}"`);
    if (!TARGETS.includes(m.target)) add('modules/target-value', `${m.id}: bad target "${m.target}"`);
    if (!STATS.includes(m.stat)) add('modules/stat-value', `${m.id}: bad stat "${m.stat}"`);

    if (!KEBAB.test(m.id)) add('modules/id-kebab', `module id is not kebab-case: ${m.id}`);
    const expectedId = `${m.protocol}-${slugify(m.name)}`;
    if (m.id !== expectedId) {
      add('modules/id-rule', `module "${m.name}" (${m.protocol}) should have id "${expectedId}", has "${m.id}"`);
    }

    const counts = perProtocol[m.protocol];
    if (counts && m.rarity in counts) counts[m.rarity] = (counts[m.rarity] ?? 0) + 1;

    if (m.levels !== m.values.length) {
      add('modules/levels-match', `${m.id}: levels ${m.levels} ≠ values.length ${m.values.length}`);
    }

    const expectedLen =
      m.id === FORTRESS_DAMAGE_ENHANCEMENT_ID ? 4 : VALUES_LENGTH_BY_RARITY[m.rarity];
    if (m.values.length !== expectedLen) {
      add('modules/values-length', `${m.id}: values.length ${m.values.length}, expected ${expectedLen}`);
    }

    if (m.rarity === 'legendary') {
      if (!m.effectId || m.effectId.length === 0) {
        add('modules/legendary-effect-id', `${m.id}: legendary module needs a non-empty effectId`);
      }
      if (!eq(m.values, [1])) {
        add('modules/legendary-values', `${m.id}: legendary values should be [1], got ${JSON.stringify(m.values)}`);
      }
      if (m.stat !== 'behavioural') {
        add('modules/legendary-stat', `${m.id}: legendary stat should be "behavioural", got "${m.stat}"`);
      }
    }

    if (typeof m.effect !== 'string' || m.effect.length === 0) {
      add('modules/effect-text', `${m.id}: missing effect text`);
    }
  }

  for (const p of PROTOCOLS) {
    const c = perProtocol[p] ?? {};
    const total = (c['common'] ?? 0) + (c['rare'] ?? 0) + (c['legendary'] ?? 0);
    if (total !== 16) add('modules/per-protocol-count', `${p}: ${total} modules, expected 16`);
    if ((c['common'] ?? 0) !== 8) add('modules/per-protocol-common', `${p}: ${c['common'] ?? 0} commons, expected 8`);
    if ((c['rare'] ?? 0) !== 5) add('modules/per-protocol-rare', `${p}: ${c['rare'] ?? 0} rares, expected 5`);
    if ((c['legendary'] ?? 0) !== 3) add('modules/per-protocol-legendary', `${p}: ${c['legendary'] ?? 0} legendaries, expected 3`);
  }

  const byId = new Map(modules.map((m) => [m.id, m]));

  const fde = byId.get(FORTRESS_DAMAGE_ENHANCEMENT_ID);
  if (!fde) add('modules/fortress-damage-enhancement', 'missing fortress-damage-enhancement');
  else {
    if (!eq(fde.values, [12, 16, 20, 28])) {
      add('modules/fortress-damage-enhancement', `values should be [12,16,20,28], got ${JSON.stringify(fde.values)}`);
    }
    if (!fde.quirk) {
      add('modules/fortress-damage-enhancement', 'the 4-value quirk must be recorded in `quirk`');
    }
  }

  if (byId.has('reboot-damage-enhancement')) {
    add('modules/reboot-healing-enhancement', 'Reboot must NOT have a "Damage Enhancement" common');
  }
  if (!byId.has('reboot-healing-enhancement')) {
    add('modules/reboot-healing-enhancement', 'Reboot common should be "Healing Enhancement"');
  }
  if (!byId.has('equilibrium-dual-enhancement')) {
    add('modules/equilibrium-dual-enhancement', 'Equilibrium common should be "Dual Enhancement"');
  }
  const ihb = byId.get('reboot-initial-healing-boost');
  if (!ihb || ihb.name !== 'Initial Healing Boost') {
    add('modules/initial-healing-boost-name', 'use the in-game name "Initial Healing Boost"');
  }
}

function validateStrengthen(add: Add): void {
  if (strengthen.length !== 78) {
    add('strengthen/count', `expected 78 strengthen rows, got ${strengthen.length}`);
  }

  const heroIds = new Set(heroes.map((h) => h.id));
  const seenRow = new Set<string>();
  const perHero = new Map<string, number[]>();

  for (const s of strengthen) {
    if (seenRow.has(s.id)) add('strengthen/id-unique', `duplicate strengthen id: ${s.id}`);
    seenRow.add(s.id);

    if (!heroIds.has(s.heroId)) add('strengthen/hero-ref', `${s.id}: unknown heroId "${s.heroId}"`);
    if (s.slot !== 1 && s.slot !== 2) add('strengthen/slot', `${s.id}: slot must be 1 or 2, got ${String(s.slot)}`);
    if (s.id !== `${s.heroId}-s${s.slot}`) {
      add('strengthen/id-rule', `${s.id}: expected id "${s.heroId}-s${s.slot}"`);
    }
    if (s.name !== '' || s.effect !== '' || s.keybind !== '') {
      add('strengthen/skeleton', `${s.id}: name/effect/keybind must be empty in the M1 skeleton (do not invent M10 data)`);
    }

    const slots = perHero.get(s.heroId) ?? [];
    slots.push(s.slot);
    perHero.set(s.heroId, slots);
  }

  for (const id of heroIds) {
    const slots = (perHero.get(id) ?? []).slice().sort((a, b) => a - b);
    if (!eq(slots, [1, 2])) {
      add('strengthen/two-per-hero', `${id} must be referenced by exactly two rows (slots 1 & 2), got ${JSON.stringify(slots)}`);
    }
  }
}

function validateGalacta(add: Add): void {
  if (!Array.isArray(galacta.archetypes) || galacta.archetypes.length < 1) {
    add('galacta/archetypes', 'galacta.json needs at least one archetype');
    return;
  }

  const ids = new Set<string>();
  for (const a of galacta.archetypes) {
    if (ids.has(a.id)) add('galacta/id-unique', `duplicate Galacta archetype id: ${a.id}`);
    ids.add(a.id);
    if (!KEBAB.test(a.id)) add('galacta/id-kebab', `Galacta archetype id is not kebab-case: ${a.id}`);
    if (!ROLES.includes(a.role)) add('galacta/role', `${a.id}: bad role "${a.role}"`);
    if (!TARGETINGS.includes(a.targeting)) add('galacta/targeting', `${a.id}: bad targeting "${a.targeting}"`);
    if (a.ult === undefined || !ULT_ARCHETYPES.includes(a.ult.archetype)) {
      add('galacta/ult', `${a.id}: ult.archetype must be one of ${ULT_ARCHETYPES.join(' / ')}`);
    }
    if (!(a.baseHealth > 0)) add('galacta/health', `${a.id}: baseHealth must be > 0, got ${a.baseHealth}`);

    const c = a.combat;
    if (!(c.dps > 0)) add('galacta/dps', `${a.id}: dps must be > 0, got ${c.dps}`);
    if (!(c.attackSpeed > 0)) add('galacta/attack-speed', `${a.id}: attackSpeed must be > 0, got ${c.attackSpeed}`);
    if (!(c.attackRange > 0)) add('galacta/range', `${a.id}: attackRange must be > 0, got ${c.attackRange}`);
    if (!(c.moveSpeed > 0)) add('galacta/move', `${a.id}: moveSpeed must be > 0, got ${c.moveSpeed}`);
    if (!ATTACK_TYPES.includes(c.attackType)) add('galacta/attack-type', `${a.id}: bad attackType "${c.attackType}"`);
    if (c.healPerSecond !== undefined && !(c.healPerSecond > 0)) {
      add('galacta/heal', `${a.id}: healPerSecond must be > 0 when present, got ${c.healPerSecond}`);
    }
  }

  const waveRounds = galacta.waves.map((w) => w.round).slice().sort((x, y) => x - y);
  if (!eq(waveRounds, [...C.PRACTICE_ROUNDS])) {
    add(
      'galacta/wave-rounds',
      `waves must cover exactly the Practice rounds ${JSON.stringify([...C.PRACTICE_ROUNDS])}, got ${JSON.stringify(waveRounds)}`,
    );
  }

  let prevTotal = 0;
  for (const round of C.PRACTICE_ROUNDS as readonly number[]) {
    const w = galacta.waves.find((x) => x.round === round);
    if (w === undefined) continue;
    let total = 0;
    for (const [k, n] of Object.entries(w.units)) {
      if (!ids.has(k)) add('galacta/wave-archetype', `round ${round}: unknown archetype "${k}"`);
      if (!Number.isInteger(n) || n < 1) {
        add('galacta/wave-count', `round ${round}: ${k} count ${n} must be a positive integer`);
      }
      total += n;
    }
    if (total < 1 || total > 24) {
      add('galacta/wave-size', `round ${round}: ${total} units, must be 1..24 (the 6×4 grid)`);
    }
    if (total < prevTotal) {
      add('galacta/wave-monotone', `round ${round}: wave (${total}) is smaller than the previous wave (${prevTotal})`);
    }
    prevTotal = total;
  }
}

function validateConstants(add: Add): void {
  const check = (cond: boolean, code: string, message: string): void => {
    if (!cond) add(code, message);
  };

  check(eq(C.PROTOCOL_XP_THRESHOLDS, [10, 20, 40]), 'const/thresholds', 'PROTOCOL_XP_THRESHOLDS must be [10,20,40]');
  check(
    C.MODULE_XP.common === 1 && C.MODULE_XP.rare === 2 && C.MODULE_XP.legendary === 4,
    'const/module-xp',
    'MODULE_XP must be 1 / 2 / 4',
  );
  check(
    C.MODULE_SELL.common === 4 && C.MODULE_SELL.rare === 9 && C.MODULE_SELL.legendary === 14,
    'const/module-sell',
    'MODULE_SELL must be 4 / 9 / 14',
  );
  check(
    C.MODULE_UPGRADE_LEVELS.common === 6 &&
      C.MODULE_UPGRADE_LEVELS.rare === 3 &&
      C.MODULE_UPGRADE_LEVELS.legendary === null,
    'const/upgrade-levels',
    'MODULE_UPGRADE_LEVELS must be 6 / 3 / null',
  );
  check(C.STARTING_TOKENS === 10, 'const/starting-tokens', 'STARTING_TOKENS must be 10');
  check(C.BASE_INCOME === 15, 'const/base-income', 'BASE_INCOME must be 15');
  check(C.STARTING_HEALTH === 50, 'const/starting-health', 'STARTING_HEALTH must be 50');
  check(C.SHOP_REFRESH_COST === 1, 'const/refresh', 'SHOP_REFRESH_COST must be 1');
  check(C.COMMON_MODULE_BUY === 5, 'const/common-buy', 'COMMON_MODULE_BUY must be 5');
  check(C.HERO_SWAP_COST === 5, 'const/swap', 'HERO_SWAP_COST must be 5');
  check(C.CHANGE_HERO_COST === 5, 'const/change-hero-cost', 'CHANGE_HERO_COST must be 5');
  check(
    eq(C.CHANGE_HERO_OFFERS, { vanguard: 3, duelist: 6, strategist: 3 }),
    'const/change-hero-offers',
    'CHANGE_HERO_OFFERS must be {vanguard:3, duelist:6, strategist:3}',
  );
  check(C.PLAYER_COUNT === 6, 'const/players', 'PLAYER_COUNT must be 6');
  check(C.BOARD.cols === 6 && C.BOARD.rows === 4, 'const/board', 'BOARD must be 6×4');
  check(C.SHOP_CARD_COUNT === 4, 'const/shop-cards', 'SHOP_CARD_COUNT must be 4');
  check(C.STREAK_BONUS_CAP === 4, 'const/streak-cap', 'STREAK_BONUS_CAP must be 4');
  check(eq(C.PRACTICE_ROUNDS, [1, 6, 11, 16, 21]), 'const/practice-rounds', 'PRACTICE_ROUNDS must be [1,6,11,16,21]');
  check(eq(C.PRACTICE_REWARD_COUNTS, [1, 1, 2, 2, 2]), 'const/reward-counts', 'PRACTICE_REWARD_COUNTS must be [1,1,2,2,2]');
  check(
    C.PHASE_COUNT.battle === 3 && C.PHASE_COUNT.practice === 4,
    'const/phase-count',
    'PHASE_COUNT must be {battle:3, practice:4}',
  );
  check(C.SPEED_UP_DAMAGE_BONUS_PCT === 120, 'const/speed-up', 'SPEED_UP_DAMAGE_BONUS_PCT must be 120');

  const tb = C.PROTOCOL_TIER_BONUSES;
  check(eq(tb.fortress, [{ maxHealth: 120 }, { maxHealth: 120 }, { maxHealth: 240 }]), 'const/tier/fortress', 'Fortress tier bonuses must be 120 / 120 / 240 max health');
  check(eq(tb.onslaught, [{ damagePct: 12 }, { damagePct: 12 }, { damagePct: 24 }]), 'const/tier/onslaught', 'Onslaught tier bonuses must be 12% / 12% / 24% damage');
  check(eq(tb.reboot, [{ healingPct: 12 }, { healingPct: 12 }, { healingPct: 24 }]), 'const/tier/reboot', 'Reboot tier bonuses must be 12% / 12% / 24% healing');
  check(
    eq(tb.equilibrium, [
      { maxHealthPerUniqueRole: 20, damageAndHealingPctPerUniqueRole: 2 },
      { maxHealthPerUniqueRole: 20, damageAndHealingPctPerUniqueRole: 2 },
      { maxHealthPerUniqueRole: 40, damageAndHealingPctPerUniqueRole: 4 },
    ]),
    'const/tier/equilibrium',
    'Equilibrium tier bonuses must be per-unique-role 20/2 · 20/2 · 40/4',
  );
}

function validateAuthored(add: Add): void {
  const check = (cond: boolean, code: string, message: string): void => {
    if (!cond) add(code, message);
  };

  check(MODULE_BUY_RARE === 10, 'authored/buy-rare', 'MODULE_BUY_RARE must be 10');
  check(MODULE_BUY_LEGENDARY === 15, 'authored/buy-legendary', 'MODULE_BUY_LEGENDARY must be 15');
  check(RARITY_ODDS_RARE_COEFF === 4.0, 'authored/odds-rare', 'RARITY_ODDS_RARE_COEFF must be 4.0');
  check(RARITY_ODDS_LEGENDARY_COEFF === 1.5, 'authored/odds-legendary', 'RARITY_ODDS_LEGENDARY_COEFF must be 1.5');
  check(ROUND_CAP === 40, 'authored/round-cap', 'ROUND_CAP must be 40');
  check(PVP_WIN_TOKEN_BONUS === 2, 'authored/pvp-win-bonus', 'PVP_WIN_TOKEN_BONUS must be 2');
  check(INTEREST_CAP === 5, 'authored/interest-cap', 'INTEREST_CAP must be 5');
  check(
    AUTHORED_ELSEWHERE.perHeroCombatStats === 'heroes.json → combat',
    'authored/elsewhere',
    'AUTHORED_ELSEWHERE.perHeroCombatStats must point at "heroes.json → combat"',
  );
}
