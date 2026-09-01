import { describe, expect, it } from 'vitest';

import heroesJson from '../src/data/heroes.json';
import modulesJson from '../src/data/modules.json';
import strengthenJson from '../src/data/strengthen.json';
import galactaJson from '../src/data/galacta.json';
import * as C from '../src/data/constants';
import * as A from '../src/data/authored';
import * as S from '../src/data/strings';
import { validate } from '../src/data/validate';
import type { BaseModule, GalactaData, Hero, StrengthenModuleSkeleton } from '../src/data/types';

/*
 * Encodes every M1 assertion. Reference facts (the baseHealth table, role counts,
 * targeting lists, the module value tables) are transcribed independently here
 * from the plan — the tests do not simply read the JSON back — so a mistake in a
 * data file and a matching mistake in `validate.ts` cannot pass together.
 */

const heroes = heroesJson as unknown as Hero[];
const modules = modulesJson as unknown as BaseModule[];
const strengthen = strengthenJson as unknown as StrengthenModuleSkeleton[];

/** Independent copy of the deterministic id rule (see plan: hero id rule). */
const kebab = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const byId = <T extends { id: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Heroes
// ---------------------------------------------------------------------------

/** CANONICAL base health — transcribed from the plan's "Hero roster (39)" table. */
const EXPECTED_HEALTH: Record<string, number> = {
  'Captain America': 575,
  'Doctor Strange': 575,
  'Emma Frost': 600,
  Groot: 700,
  Hulk: 700,
  Magneto: 650,
  'Peni Parker': 650,
  'The Thing': 700,
  Thor: 600,
  Venom: 675,
  'Black Panther': 275,
  'Black Widow': 250,
  Hawkeye: 250,
  Hela: 250,
  'Human Torch': 250,
  'Iron Fist': 300,
  'Iron Man': 250,
  Magik: 250,
  'Mister Fantastic': 375,
  'Moon Knight': 275,
  Namor: 275,
  Psylocke: 250,
  'Scarlet Witch': 250,
  'Spider-Man': 250,
  'Squirrel Girl': 275,
  'Star-Lord': 250,
  Storm: 250,
  'The Punisher': 300,
  'Winter Soldier': 275,
  Wolverine: 350,
  'Adam Warlock': 275,
  'Cloak & Dagger': 275,
  'Invisible Woman': 275,
  'Jeff the Land Shark': 250,
  Loki: 275,
  'Luna Snow': 275,
  Mantis: 250,
  'Rocket Raccoon': 250,
  Ultron: 250,
};

/** Independent transcription of the L / H marks; everything else is N (nearest). */
const TARGET_LOWEST = new Set([
  'Captain America',
  'Venom',
  'Black Panther',
  'Black Widow',
  'Magik',
  'Psylocke',
  'Scarlet Witch',
  'Spider-Man',
]);
const TARGET_HIGHEST = new Set(['Wolverine']);

describe('heroes.json', () => {
  it('has exactly 39 heroes, split 10 / 20 / 9 by role', () => {
    expect(heroes).toHaveLength(39);
    expect(heroes.filter((h) => h.role === 'vanguard')).toHaveLength(10);
    expect(heroes.filter((h) => h.role === 'duelist')).toHaveLength(20);
    expect(heroes.filter((h) => h.role === 'strategist')).toHaveLength(9);
  });

  it('the independent baseHealth table has 39 rows', () => {
    expect(Object.keys(EXPECTED_HEALTH)).toHaveLength(39);
  });

  it('every baseHealth matches the canonical table exactly', () => {
    for (const h of heroes) {
      expect(EXPECTED_HEALTH, `${h.name} missing from expected table`).toHaveProperty(h.name);
      expect(h.baseHealth, `${h.name} baseHealth`).toBe(EXPECTED_HEALTH[h.name]);
    }
  });

  it('Hulk is 700 and records the infobox 200 / 700 split', () => {
    const hulk = heroes.find((h) => h.id === 'hulk');
    expect(hulk?.baseHealth).toBe(700);
    expect(hulk?.note).toMatch(/200/);
    expect(hulk?.note).toMatch(/700/);
  });

  it('targeting partitions the roster — every hero in exactly one of N / L / H', () => {
    for (const h of heroes) {
      const expected = TARGET_HIGHEST.has(h.name)
        ? 'highestMaxHealth'
        : TARGET_LOWEST.has(h.name)
          ? 'lowestMaxHealth'
          : 'nearest';
      expect(h.targeting, `${h.name} targeting`).toBe(expected);
    }
    const n = heroes.filter((h) => h.targeting === 'nearest').length;
    const l = heroes.filter((h) => h.targeting === 'lowestMaxHealth').length;
    const hi = heroes.filter((h) => h.targeting === 'highestMaxHealth').length;
    expect([n, l, hi]).toEqual([30, 8, 1]);
    expect(n + l + hi).toBe(heroes.length);
  });

  it('hero ids are unique, kebab-case, and follow the deterministic name rule', () => {
    const ids = heroes.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of heroes) {
      expect(h.id, `${h.name} id kebab`).toMatch(KEBAB_RE);
      expect(h.id, `${h.name} id rule`).toBe(kebab(h.name));
    }
    for (const id of [
      'the-thing',
      'the-punisher',
      'star-lord',
      'spider-man',
      'cloak-and-dagger',
      'jeff-the-land-shark',
      'mister-fantastic',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('authored combat stats sit inside the M1 role bands', () => {
    for (const h of heroes) {
      const c = h.combat;
      expect(c.attackSpeed, `${h.id} attackSpeed`).toBeGreaterThan(0);

      if (h.role === 'vanguard') {
        expect(h.baseHealth).toBeGreaterThanOrEqual(575);
        expect(h.baseHealth).toBeLessThanOrEqual(700);
        expect(c.dps, `${h.id} dps`).toBeGreaterThanOrEqual(55);
        expect(c.dps, `${h.id} dps`).toBeLessThanOrEqual(85);
        expect(c.moveSpeed, `${h.id} move`).toBe(3.0);
        expect(['melee', 'ranged']).toContain(c.attackType);
        expect(c.healPerSecond, `${h.id} heal`).toBeUndefined();
        if (c.attackType === 'melee') {
          expect(c.attackRange).toBeGreaterThanOrEqual(3);
          expect(c.attackRange).toBeLessThanOrEqual(8);
        } else {
          expect(c.attackRange).toBeGreaterThanOrEqual(12);
          expect(c.attackRange).toBeLessThanOrEqual(18);
        }
      } else if (h.role === 'duelist') {
        expect(h.baseHealth).toBeGreaterThanOrEqual(250);
        expect(h.baseHealth).toBeLessThanOrEqual(375);
        expect(c.dps, `${h.id} dps`).toBeGreaterThanOrEqual(110);
        expect(c.dps, `${h.id} dps`).toBeLessThanOrEqual(170);
        expect(c.moveSpeed, `${h.id} move`).toBeGreaterThanOrEqual(3.6);
        expect(c.moveSpeed, `${h.id} move`).toBeLessThanOrEqual(4.4);
        expect(['melee', 'ranged', 'sniper']).toContain(c.attackType);
        expect(c.healPerSecond, `${h.id} heal`).toBeUndefined();
        if (c.attackType === 'melee') {
          expect(c.attackRange, `${h.id} melee range`).toBe(5);
        } else {
          expect(c.attackRange, `${h.id} ranged/sniper range`).toBeGreaterThanOrEqual(20);
          expect(c.attackRange, `${h.id} ranged/sniper range`).toBeLessThanOrEqual(34);
        }
      } else {
        expect(h.baseHealth).toBeGreaterThanOrEqual(250);
        expect(h.baseHealth).toBeLessThanOrEqual(275);
        expect(c.dps, `${h.id} dps`).toBeGreaterThanOrEqual(45);
        expect(c.dps, `${h.id} dps`).toBeLessThanOrEqual(70);
        expect(c.moveSpeed, `${h.id} move`).toBe(3.4);
        expect(c.attackType).toBe('ranged');
        expect(c.attackRange).toBeGreaterThanOrEqual(16);
        expect(c.attackRange).toBeLessThanOrEqual(22);
        expect(c.healPerSecond, `${h.id} heal`).toBeGreaterThanOrEqual(60);
        expect(c.healPerSecond, `${h.id} heal`).toBeLessThanOrEqual(95);
      }
    }
  });

  it('snipers trade DPS for reach against the melee brawlers', () => {
    const snipers = heroes.filter((h) => h.combat.attackType === 'sniper');
    const brawlers = heroes.filter((h) => h.role === 'duelist' && h.combat.attackType === 'melee');
    const maxSniperDps = Math.max(...snipers.map((h) => h.combat.dps));
    const minBrawlerDps = Math.min(...brawlers.map((h) => h.combat.dps));
    expect(maxSniperDps).toBeLessThan(minBrawlerDps);
  });
});

// ---------------------------------------------------------------------------
// Base Modules
// ---------------------------------------------------------------------------

const PROTOCOLS = ['fortress', 'onslaught', 'reboot', 'equilibrium'] as const;
const FORTRESS_DAMAGE_ENHANCEMENT_ID = 'fortress-damage-enhancement';

describe('modules.json', () => {
  it('has 64 modules — 16 per protocol, 8 Common / 5 Rare / 3 Legendary', () => {
    expect(modules).toHaveLength(64);
    for (const p of PROTOCOLS) {
      const inP = modules.filter((m) => m.protocol === p);
      expect(inP, `${p} total`).toHaveLength(16);
      expect(inP.filter((m) => m.rarity === 'common'), `${p} common`).toHaveLength(8);
      expect(inP.filter((m) => m.rarity === 'rare'), `${p} rare`).toHaveLength(5);
      expect(inP.filter((m) => m.rarity === 'legendary'), `${p} legendary`).toHaveLength(3);
    }
  });

  it('module ids are unique across protocols and follow the deterministic rule', () => {
    const ids = modules.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of modules) {
      expect(m.id, `${m.name} kebab`).toMatch(KEBAB_RE);
      expect(m.id, `${m.name} (${m.protocol}) id rule`).toBe(`${m.protocol}-${kebab(m.name)}`);
    }
  });

  it('names that recur across protocols are namespaced, not merged', () => {
    for (const name of ['Attack Speed Enhancement', 'Reserve Armor', 'Precharged Energy', 'Infinite Drive']) {
      const hits = modules.filter((m) => m.name === name);
      expect(hits.length, `${name} occurrences`).toBe(4);
      expect(new Set(hits.map((m) => m.id)).size, `${name} distinct ids`).toBe(4);
    }
    expect(modules.filter((m) => m.name === 'Backup Rebirth').map((m) => m.protocol).sort()).toEqual([
      'equilibrium',
      'fortress',
      'onslaught',
    ]);
  });

  it("values.length is 6 / 3 / 1 by rarity — Fortress \"Damage Enhancement\" is the one known 4-value quirk", () => {
    for (const m of modules) {
      expect(m.levels, `${m.id} levels === values.length`).toBe(m.values.length);
      if (m.id === FORTRESS_DAMAGE_ENHANCEMENT_ID) continue;
      const expected = m.rarity === 'common' ? 6 : m.rarity === 'rare' ? 3 : 1;
      expect(m.values.length, `${m.id} values.length`).toBe(expected);
    }
  });

  it('Fortress "Damage Enhancement" ships exactly 4 values (12/16/20/28) and flags the quirk', () => {
    const fde = byId(modules).get(FORTRESS_DAMAGE_ENHANCEMENT_ID);
    expect(fde?.values).toEqual([12, 16, 20, 28]);
    expect(fde?.levels).toBe(4);
    expect(fde?.quirk, 'the 4-value oddity must be recorded, not silently normalized').toBeTruthy();
  });

  it('the 6th Common value is the source jump, never the next arithmetic step', () => {
    const m = byId(modules);
    expect(m.get('fortress-attack-speed-enhancement')?.values).toEqual([4, 8, 12, 16, 20, 28]);
    expect(m.get('onslaught-attack-speed-enhancement')?.values).toEqual([8, 16, 24, 32, 40, 56]);
    expect(m.get('fortress-health-expansion')?.values).toEqual([90, 180, 270, 360, 450, 630]);
    expect(m.get('fortress-charge-acceleration')?.values).toEqual([20, 40, 60, 80, 100, 140]);
    expect(m.get('fortress-health-suppression')?.values).toEqual([1, 2, 3, 4, 5, 7]);
    expect(m.get('equilibrium-health-expansion')?.values).toEqual([15, 30, 45, 60, 75, 105]);
    expect(m.get('equilibrium-charge-acceleration')?.values).toEqual([6, 12, 18, 24, 30, 42]);
  });

  it('per-protocol Common substitutions are not normalized away', () => {
    const m = byId(modules);
    expect(m.has('reboot-healing-enhancement')).toBe(true);
    expect(m.has('reboot-damage-enhancement')).toBe(false);
    expect(m.has('equilibrium-dual-enhancement')).toBe(true);
    expect(m.get('reboot-initial-healing-boost')?.name).toBe('Initial Healing Boost');
  });

  it('every protocol carries the Suppression / Interference trio with machine-readable scope + target', () => {
    for (const p of PROTOCOLS) {
      const scope = p === 'equilibrium' ? 'perUniqueRole' : 'perRoleUnit';
      const hs = byId(modules).get(`${p}-health-suppression`);
      const di = byId(modules).get(`${p}-damage-interference`);
      const hsup = byId(modules).get(`${p}-healing-suppression`);
      expect(hs, `${p} health suppression`).toMatchObject({ stat: 'enemyMaxHealth', target: 'enemy', scope });
      expect(di, `${p} damage interference`).toMatchObject({ stat: 'enemyDamageOutput', target: 'enemy', scope });
      expect(hsup, `${p} healing suppression`).toMatchObject({ stat: 'enemyHealing', target: 'enemy', scope });
    }
  });

  it('legendaries are behavioural: stable effectId, [1] placeholder values, no numeric scaling', () => {
    for (const m of modules.filter((x) => x.rarity === 'legendary')) {
      expect(m.effectId, `${m.id} effectId`).toBeTruthy();
      expect(m.values, `${m.id} values`).toEqual([1]);
      expect(m.stat, `${m.id} stat`).toBe('behavioural');
    }
  });

  it('every module effect string is locked (edit = loud failure)', () => {
    const table = Object.fromEntries(
      [...modules].sort((a, b) => a.id.localeCompare(b.id)).map((m) => [m.id, m.effect]),
    );
    expect(table).toMatchSnapshot();
  });

  it('every transcribed in-game module string is locked', () => {
    const observed = [...modules]
      .filter((m) => m.observedShopText !== undefined || m.observedOwnedText !== undefined)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id,
        shop: m.observedShopText ?? null,
        owned: m.observedOwnedText ?? null,
        from: m.observedIn ?? null,
      }));
    expect(observed).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Strengthen skeleton
// ---------------------------------------------------------------------------

describe('strengthen.json (M1 skeleton)', () => {
  it('is 78 rows — 39 heroes x 2 slots — with unique ids', () => {
    expect(strengthen).toHaveLength(78);
    expect(new Set(strengthen.map((s) => s.id)).size).toBe(78);
  });

  it('references every hero id exactly twice, once per slot', () => {
    const heroIds = new Set(heroes.map((h) => h.id));
    for (const s of strengthen) {
      expect(heroIds.has(s.heroId), `${s.id} heroId`).toBe(true);
      expect(s.id).toBe(`${s.heroId}-s${s.slot}`);
    }
    for (const id of heroIds) {
      const slots = strengthen
        .filter((s) => s.heroId === id)
        .map((s) => s.slot)
        .sort((a, b) => a - b);
      expect(slots, `${id} slots`).toEqual([1, 2]);
    }
  });

  it('carries only id / heroId / slot — name, effect and keybind stay empty (M10 owns them)', () => {
    for (const s of strengthen) {
      expect(s.name, `${s.id} name`).toBe('');
      expect(s.effect, `${s.id} effect`).toBe('');
      expect(s.keybind, `${s.id} keybind`).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// Galacta Bots (M6)
// ---------------------------------------------------------------------------

describe('galacta.json (M6 Galacta Bot data)', () => {
  const galacta = galactaJson as unknown as GalactaData;
  const TARGETINGS = ['nearest', 'lowestMaxHealth', 'highestMaxHealth'];
  const ULT_ARCHETYPES = [
    'singleTargetBurst',
    'aoeBurst',
    'sustainedBeam',
    'teamHealBurst',
    'shieldDamageReduction',
    'selfBuff',
  ];
  const ATTACK_TYPES = ['melee', 'ranged', 'sniper'];

  it('has archetypes with unique kebab ids, positive combat stats and valid enums', () => {
    expect(galacta.archetypes.length).toBeGreaterThanOrEqual(1);
    expect(new Set(galacta.archetypes.map((a) => a.id)).size).toBe(galacta.archetypes.length);
    for (const a of galacta.archetypes) {
      expect(a.id, `${a.id} kebab`).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(['vanguard', 'duelist', 'strategist']).toContain(a.role);
      expect(TARGETINGS).toContain(a.targeting);
      expect(ULT_ARCHETYPES).toContain(a.ult.archetype);
      expect(a.baseHealth).toBeGreaterThan(0);
      expect(a.combat.dps).toBeGreaterThan(0);
      expect(a.combat.attackSpeed).toBeGreaterThan(0);
      expect(a.combat.attackRange).toBeGreaterThan(0);
      expect(a.combat.moveSpeed).toBeGreaterThan(0);
      expect(ATTACK_TYPES).toContain(a.combat.attackType);
    }
  });

  it('waves cover exactly the Practice rounds and never shrink round-to-round', () => {
    expect(galacta.waves.map((w) => w.round).slice().sort((x, y) => x - y)).toEqual([
      ...C.PRACTICE_ROUNDS,
    ]);
    const ids = new Set(galacta.archetypes.map((a) => a.id));
    let prev = 0;
    for (const round of C.PRACTICE_ROUNDS) {
      const w = galacta.waves.find((x) => x.round === round)!;
      let total = 0;
      for (const [k, n] of Object.entries(w.units)) {
        expect(ids.has(k), `round ${round} archetype ${k}`).toBe(true);
        expect(Number.isInteger(n) && n >= 1, `round ${round} ${k} count`).toBe(true);
        total += n;
      }
      expect(total).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThanOrEqual(24); // the 6×4 deploy grid
      expect(total, `round ${round} not smaller than the previous wave`).toBeGreaterThanOrEqual(prev);
      prev = total;
    }
  });
});

// ---------------------------------------------------------------------------
// Constants — canonical
// ---------------------------------------------------------------------------

describe('constants.ts (canonical only)', () => {
  it('module economy', () => {
    expect(C.PROTOCOL_XP_THRESHOLDS).toEqual([10, 20, 40]);
    expect(C.MODULE_XP).toEqual({ common: 1, rare: 2, legendary: 4 });
    expect(C.MODULE_SELL).toEqual({ common: 4, rare: 9, legendary: 14 });
    expect(C.MODULE_UPGRADE_LEVELS).toEqual({ common: 6, rare: 3, legendary: null });
    expect(C.COMMON_MODULE_BUY).toBe(5);
    expect(C.SHOP_REFRESH_COST).toBe(1);
    expect(C.SHOP_CARD_COUNT).toBe(4);
    expect(C.HERO_SWAP_COST).toBe(5);
    expect(C.CHANGE_HERO_COST).toBe(5);
    expect(C.CHANGE_HERO_OFFERS).toEqual({ vanguard: 3, duelist: 6, strategist: 3 });
  });

  it('match structure & economy', () => {
    expect(C.PLAYER_COUNT).toBe(6);
    expect(C.BOARD).toEqual({ cols: 6, rows: 4 });
    expect(C.STARTING_HEALTH).toBe(50);
    expect(C.STARTING_TOKENS).toBe(10);
    expect(C.BASE_INCOME).toBe(15);
    expect(C.STREAK_BONUS_CAP).toBe(4);
    expect(C.PRACTICE_ROUNDS).toEqual([1, 6, 11, 16, 21]);
    expect(C.PRACTICE_REWARD_COUNTS).toEqual([1, 1, 2, 2, 2]);
    expect(C.PHASE_COUNT).toEqual({ battle: 3, practice: 4 });
  });

  it('protocol tier bonus tables', () => {
    expect(C.PROTOCOL_TIER_BONUSES.fortress).toEqual([
      { maxHealth: 120 },
      { maxHealth: 120 },
      { maxHealth: 240 },
    ]);
    expect(C.PROTOCOL_TIER_BONUSES.onslaught).toEqual([
      { damagePct: 12 },
      { damagePct: 12 },
      { damagePct: 24 },
    ]);
    expect(C.PROTOCOL_TIER_BONUSES.reboot).toEqual([
      { healingPct: 12 },
      { healingPct: 12 },
      { healingPct: 24 },
    ]);
    expect(C.PROTOCOL_TIER_BONUSES.equilibrium).toEqual([
      { maxHealthPerUniqueRole: 20, damageAndHealingPctPerUniqueRole: 2 },
      { maxHealthPerUniqueRole: 20, damageAndHealingPctPerUniqueRole: 2 },
      { maxHealthPerUniqueRole: 40, damageAndHealingPctPerUniqueRole: 4 },
    ]);
  });

  it('Speed Up damage bonus is +120% (× 2.2)', () => {
    expect(C.SPEED_UP_DAMAGE_BONUS_PCT).toBe(120);
    expect(C.SPEED_UP_DAMAGE_MULTIPLIER).toBeCloseTo(2.2);
  });
});

// ---------------------------------------------------------------------------
// Authored / Derived
// ---------------------------------------------------------------------------

describe('authored.ts (every non-canonical number, with provenance)', () => {
  it('DERIVED coefficients and formula constants', () => {
    expect(A.RARITY_ODDS_RARE_COEFF).toBe(4.0);
    expect(A.RARITY_ODDS_LEGENDARY_COEFF).toBe(1.5);
    expect(A.HP_LOSS_ROUND_DIVISOR).toBe(5);
    expect(A.HP_LOSS_SURVIVOR_COEFF).toBe(1);
    expect(A.HP_LOSS_TIE_DIVISOR).toBe(2);
    expect(A.HP_LOSS_SURVIVOR_RANGE).toEqual([1, 6]);
  });

  it('AUTHORED values', () => {
    expect(A.MODULE_BUY_RARE).toBe(10);
    expect(A.MODULE_BUY_LEGENDARY).toBe(15);
    expect(A.ROUND_CAP).toBe(40);
    expect(A.PVP_WIN_TOKEN_BONUS).toBe(2);
    expect(A.PVP_WIN_TOKEN_BONUS_TIMING).toBe('atBattleResolution');
    expect(A.INTEREST_CAP).toBe(5);
    expect(A.SPEED_UP_TRIGGER).toBe('battleTimerZero');
    expect(A.PHASE_TIMERS_SECONDS).toEqual({
      draft: 40,
      module: 30,
      position: 20,
      battle: 40,
      speedUp: 20,
      reward: 30,
    });
  });

  it('records the per-hero combat-stats exception and the strengthen skeleton marker', () => {
    expect(A.AUTHORED_ELSEWHERE.perHeroCombatStats).toBe('heroes.json → combat');
    expect(A.STRENGTHEN_JSON_IS_SKELETON).toBe(true);
  });

  it('every authored value export carries a provenance note', () => {
    const documented = new Set(Object.keys(A.AUTHORED_PROVENANCE));
    for (const key of Object.keys(A)) {
      if (key === 'AUTHORED_PROVENANCE') continue;
      expect(documented.has(key), `authored export "${key}" needs an AUTHORED_PROVENANCE entry`).toBe(
        true,
      );
    }
    for (const key of documented) {
      expect(Object.prototype.hasOwnProperty.call(A, key), `stale provenance entry "${key}"`).toBe(
        true,
      );
    }
  });

  it('interest cap is isolated in authored.ts, not canonised in constants.ts', () => {
    expect(A.AUTHORED_PROVENANCE.INTEREST_CAP).toMatch(/NOT in the screenshot-CONFIRMED list/i);
    expect((C as Record<string, unknown>).INTEREST_CAP).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Strings — verbatim
// ---------------------------------------------------------------------------

describe('strings.ts (verbatim)', () => {
  it('preserves the deliberate punctuation quirks', () => {
    expect(S.LOCKED_MODULES_FOOTER).toBe(
      'Locked modules will not be refreshed in the next round',
    );
    expect(S.LOCKED_MODULES_FOOTER.endsWith('.')).toBe(false);

    expect(S.PURCHASED_MODULES_TOOLTIP).toBe(
      'The effects of purchased modules take effect in the next round.',
    );

    expect(S.SWAP_CONVERSION_FOOTNOTE.startsWith('*')).toBe(true);
    expect(S.SWAP_CONVERSION_FOOTNOTE.endsWith('.')).toBe(true);
  });

  it('parameterized strings are functions', () => {
    expect(S.lineup(0)).toBe('LINEUP (0/6)');
    expect(S.lineup(6)).toBe('LINEUP (6/6)');
    expect(S.roundPhase(1, 1)).toBe('1-1');
    expect(S.roundPhase(18, 1)).toBe('18-1');
    expect(S.xpMeter(16, 20)).toBe('16/20');
    expect(S.xpMeter(23, 40)).toBe('23/40');
    expect(S.selectNStrengthen(1)).toBe('Select 1 Strengthen Modules');
    expect(S.selectNStrengthen(2)).toBe('Select 2 Strengthen Modules');
    expect(S.chooseOneOfRandom(3, 'Vanguard')).toBe(
      'Choose One of 3 Random Vanguards to Replace a Current Hero',
    );
    expect(S.chooseOneOfRandom(6, 'Duelist')).toBe(
      'Choose One of 6 Random Duelists to Replace a Current Hero',
    );
    expect(S.roundBanner(1, S.PRACTICE_PROTOCOL)).toBe('ROUND 1 - PRACTICE PROTOCOL');
    expect(S.incomePreview(10, 16)).toBe('10 (+16)');
  });

  it('key canonical strings', () => {
    expect(S.TAGLINE).toBe(
      'Harness your superior intellect! Seek out the perfect solution within the simulation and eradicate all rival subprocesses.',
    );
    expect(S.HEROES_SWAPPED_SUBTITLE).toBe(
      'HEROES SWAPPED IN THIS PHASE WILL TAKE EFFECT IN THE NEXT ROUND.',
    );
    expect(S.XP_LEGEND).toBe('★ = XP+1 · ★ = XP+2 · ★ = XP+4');
    expect(S.OWNED_MODULES).toBe('Owned Modules:');
    expect(S.REFRESH_1_1).toBe('REFRESH 1/1');
    expect(S.ARENA_MAP_NAME).toBe('Age of Ultron: Digital Duel Grounds');
    expect(S.ARENA_MAP_NAME).toBe(C.ARENA_MAP); // strings.ts is the verbatim source; constants mirrors it
    expect([S.COL_RANK, S.COL_PLAYER_NAME, S.COL_DEPLOY, S.COL_INITIATE_PROTOCOL]).toEqual([
      'Rank',
      'Player Name',
      'Deploy',
      'Initiate Protocol',
    ]);
  });

  it('every string in strings.ts is locked (edit = loud failure)', () => {
    const statics: Record<string, unknown> = {};
    const functions: string[] = [];
    for (const [key, value] of Object.entries(S)) {
      if (typeof value === 'function') functions.push(key);
      else statics[key] = value;
    }
    const samples = {
      lineup: [S.lineup(0), S.lineup(6)],
      roundPhase: [S.roundPhase(1, 1), S.roundPhase(9, 3)],
      roundBanner: S.roundBanner(2, S.BATTLE_PROTOCOL),
      xpMeter: S.xpMeter(16, 20),
      selectNStrengthen: [S.selectNStrengthen(1), S.selectNStrengthen(2)],
      chooseOneOfRandom: [
        S.chooseOneOfRandom(3, 'Vanguard'),
        S.chooseOneOfRandom(6, 'Duelist'),
        S.chooseOneOfRandom(3, 'Strategist'),
      ],
      chooseRoleCardTitle: [
        S.chooseRoleCardTitle('Vanguard'),
        S.chooseRoleCardTitle('Duelist'),
        S.chooseRoleCardTitle('Strategist'),
      ],
      protocolPaneTitle: S.protocolPaneTitle('Fortress'),
      diamondCost: S.diamondCost(5),
      incomePreview: S.incomePreview(10, 16),
    };
    expect({ statics, functions: functions.sort(), samples }).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

describe('validate()', () => {
  it('returns zero problems', () => {
    const problems = validate();
    const detail = problems.map((p) => `${p.code}: ${p.message}`).join('\n');
    expect(problems, detail).toEqual([]);
  });

  it('has no side effects — importable at dev boot', () => {
    expect(typeof validate).toBe('function');
    expect(validate()).toEqual(validate());
  });
});
