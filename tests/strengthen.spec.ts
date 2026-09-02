import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import heroesJson from '../src/data/heroes.json';
import { simulateBattle } from '../src/sim/combat';
import {
  convertOnSwapOut,
  grantLootingLeviathanModules,
  lootingLeviathanRarityOdds,
  rollLootingLeviathanRarity,
  swapHeroAndConvertStrengthen,
  totalStrengthen,
} from '../src/sim/modules';
import type { StrengthenInventory, LineupState } from '../src/sim/modules';
import { RngStream } from '../src/sim/rng';
import {
  STRENGTHEN_ROWS,
  STRENGTHEN_SOURCING_GAPS,
  STRENGTHEN_SPECS,
  allStrengthenIds,
  missingStrengthenHandlers,
  staleStrengthenHandlers,
  stubStrengthenHandlers,
} from '../src/sim/strengthen';
import type { StrengthenSpec } from '../src/sim/strengthen';
import type { CombatContext } from '../src/sim/types';

/*
 * M10 — Strengthen Modules (78 total).
 *
 * Sourcing: 76 of 78 rows are populated (3 from the reward screenshot
 * verbatim, the rest from a secondary guide — see docs/FIDELITY.md). Emma
 * Frost's two rows could not be sourced and are `STRENGTHEN_SOURCING_GAPS`.
 */

const HERO_IDS = (heroesJson as unknown as readonly { id: string }[]).map((h) => h.id);

// ---------------------------------------------------------------------------
// 1. Shape — 78 modules, 2 per hero, ids unchanged from M1
// ---------------------------------------------------------------------------

describe('the 78 Strengthen Modules', () => {
  it('is exactly 78 rows, 2 per hero, every hero referenced exactly twice', () => {
    expect(STRENGTHEN_ROWS).toHaveLength(78);
    for (const heroId of HERO_IDS) {
      const rows = STRENGTHEN_ROWS.filter((r) => r.heroId === heroId);
      expect(
        rows.map((r) => r.slot).sort((a, b) => a - b),
        `${heroId}`,
      ).toEqual([1, 2]);
    }
    // every referenced heroId is a real hero
    for (const r of STRENGTHEN_ROWS) expect(HERO_IDS).toContain(r.heroId);
  });

  it('ids are UNCHANGED from the M1 skeleton (`${heroId}-s${slot}`) — renumbering breaks M4/M6', () => {
    const expected = HERO_IDS.flatMap((id) => [`${id}-s1`, `${id}-s2`]).sort();
    expect(allStrengthenIds()).toEqual(expected);
  });

  it('exactly two rows are unsourced, and they are the documented gaps', () => {
    const blank = STRENGTHEN_ROWS.filter((r) => r.name === '' || r.effect === '').map((r) => r.id);
    expect(blank.sort()).toEqual([...STRENGTHEN_SOURCING_GAPS].sort());
  });
});

// ---------------------------------------------------------------------------
// 2. Canonical text — locked character-for-character
// ---------------------------------------------------------------------------

describe('canonical name / effect / keybind text', () => {
  it('is locked character-for-character (an accidental edit fails loudly)', () => {
    const table = [...STRENGTHEN_ROWS]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id, name: r.name, effect: r.effect, keybind: r.keybind }));
    expect(table).toMatchSnapshot();
  });

  it('the three screenshot-verbatim rows match the reward screen exactly', () => {
    const byId = new Map(STRENGTHEN_ROWS.map((r) => [r.id, r]));
    expect(byId.get('loki-s2')).toMatchObject({
      name: "Loki's Sanctuary",
      effect: 'Reduce Regeneration Domain cooldown by 18s, and increase Force Field Core health by 100.',
      keybind: 'LSHIFT',
    });
    expect(byId.get('hela-s1')).toMatchObject({
      name: 'Soul Reaper',
      effect: 'Increase Nightsword Thorn fire rate and magazine capacity by 70%.',
      keybind: 'LMB',
    });
    expect(byId.get('groot-s2')).toMatchObject({
      name: 'Ghost Thornlash Wall',
      effect:
        'Reduce Thornlash Wall cooldown by 4s and passive trigger interval by 0.2s; Increase Thornlash Wall max count by 1.',
      keybind: 'LSHIFT',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Completeness — every sourced module has a registered, non-stub handler
// ---------------------------------------------------------------------------

describe('implementation completeness', () => {
  it('every sourced module id has a registered spec; none is stale', () => {
    expect(missingStrengthenHandlers()).toEqual([]);
    expect(staleStrengthenHandlers()).toEqual([]);
    // registered specs ∪ gaps == all 78 ids, and the two sets are disjoint
    const registered = Object.keys(STRENGTHEN_SPECS).sort();
    expect([...registered, ...STRENGTHEN_SOURCING_GAPS].sort()).toEqual(allStrengthenIds());
    expect(registered.filter((id) => STRENGTHEN_SOURCING_GAPS.includes(id))).toEqual([]);
  });

  it('no registered spec is a no-op stub (each carries a real passive mod or ult buff)', () => {
    expect(stubStrengthenHandlers()).toEqual([]);
  });

  it('every registered spec carries an approximation note (no module is a literal reproduction)', () => {
    for (const spec of Object.values(STRENGTHEN_SPECS)) {
      expect(typeof spec.approximation, spec.moduleId).toBe('string');
      expect(spec.approximation.length, spec.moduleId).toBeGreaterThan(10);
    }
  });

  it('no reachable TODO in src/sim/strengthen.ts', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'sim', 'strengthen.ts'), 'utf8');
    expect(src.includes('TODO')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The per-module "it does something" harness — one forced case per module
// ---------------------------------------------------------------------------

function ctxFor(spec: StrengthenSpec): CombatContext {
  const s = spec.scenario;
  return {
    round: 3,
    roundType: 'battle',
    matchupKind: 'pvp',
    sideA: { playerId: 0, lineup: [...s.lineupA], isPhantom: false, isGalactaBots: false },
    sideB: { playerId: 1, lineup: [...s.lineupB], isPhantom: false, isGalactaBots: false },
    rng: new RngStream(s.seed >>> 0).stream('strengthen-harness', 3),
  };
}

interface Outcome {
  readonly digest: string;
  readonly value: number;
}

function runScenario(spec: StrengthenSpec, active: boolean): Outcome {
  const s = spec.scenario;
  const trace = simulateBattle(ctxFor(spec), {
    trace: true,
    tieCapTicks: s.battleTicks,
    sideAStrengthen: active ? { [spec.heroId]: [spec.moduleId] } : {},
    place: (units) => {
      for (const u of units) {
        u.x = 0;
        u.y = u.side === 0 ? 0 : s.spawnGap;
      }
      if (s.parkBackUnits) {
        const back = units.filter((u) => u.side === 1);
        for (let i = 1; i < back.length; i++) back[i]!.y = s.spawnGap + 80;
      }
      const owner = units[0]!;
      if (s.primeUlt) owner.ultEnergy = 1;
      if (s.ownerHealthFraction !== 1) owner.health = owner.maxHealth * s.ownerHealthFraction;
      const second = units[1];
      if (second !== undefined && second.side === 0 && s.allyHealthFraction !== 1) {
        second.health = second.maxHealth * s.allyHealthFraction;
      }
    },
  });

  let value: number;
  if (s.measure === 'ticksToResolve') {
    value = trace.tickCount;
  } else if (s.measure === 'ownerDamageDealt') {
    value = (trace.damageLog ?? [])
      .filter((e) => e.srcUnitId === 0)
      .reduce((sum, e) => sum + e.amount, 0);
  } else if (s.measure === 'ownerDamageTaken') {
    value = (trace.damageLog ?? [])
      .filter((e) => e.tgtUnitId === 0)
      .reduce((sum, e) => sum + e.amount, 0);
  } else if (s.measure === 'ownerHealthRemaining') {
    const owner = trace.finalUnits.find((u) => u.id === 0);
    value = owner ? owner.health + owner.overhealth : 0;
  } else {
    const ally = trace.finalUnits.find((u) => u.id === 1);
    value = ally ? ally.health + ally.overhealth : 0;
  }
  return { digest: trace.digest, value };
}

describe('per-module scenario harness — each module measurably changes its hero', () => {
  const CASES = allStrengthenIds().filter((id) => !STRENGTHEN_SOURCING_GAPS.includes(id));

  it('runs one case for every sourced module', () => {
    expect(CASES).toHaveLength(76);
  });

  it.each(CASES)('%s produces a measurable delta in its forced scenario', (moduleId) => {
    const spec = STRENGTHEN_SPECS[moduleId]!;
    const on = runScenario(spec, true);
    const off = runScenario(spec, false);

    // (a) the digest must move — catches a silently-unwired module
    expect(on.digest, `${moduleId}: digest identical with vs without the module`).not.toBe(off.digest);

    // (b) the tracked aggregate must move in the module's favour by a real margin
    const delta = on.value - off.value;
    const floor = 1e-6 * (Math.abs(off.value) + 1);
    const label = `${moduleId}: ${spec.scenario.measure} ${off.value.toFixed(3)} -> ${on.value.toFixed(3)}`;
    if (spec.scenario.expect === 'increase') {
      expect(delta, `${label} (want increase)`).toBeGreaterThan(floor);
    } else {
      expect(delta, `${label} (want decrease)`).toBeLessThan(-floor);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Jeff's *Looting Leviathan* — its own rarity table, its own substream
// ---------------------------------------------------------------------------

describe("Jeff's Looting Leviathan", () => {
  it('has its own path and never touches modules.rarityOdds', () => {
    // 4 -> 90/8/2, 5 -> 60/30/10, 6+ -> 0/70/30 (the plan's table, verbatim)
    expect(lootingLeviathanRarityOdds(4)).toEqual({ common: 90, rare: 8, legendary: 2 });
    expect(lootingLeviathanRarityOdds(5)).toEqual({ common: 60, rare: 30, legendary: 10 });
    expect(lootingLeviathanRarityOdds(6)).toEqual({ common: 0, rare: 70, legendary: 30 });
    expect(lootingLeviathanRarityOdds(9)).toEqual({ common: 0, rare: 70, legendary: 30 }); // "6+"
    // it grants (devoured - 2) modules, none below the 3-enemy floor
    const rng = new RngStream(1).stream('looting-leviathan', 0);
    expect(grantLootingLeviathanModules(2, rng)).toEqual([]);
    expect(grantLootingLeviathanModules(4, rng)).toHaveLength(2);
    expect(grantLootingLeviathanModules(6, rng)).toHaveLength(4);
  });

  it('distribution over 100,000 seeded rolls is within ±1% of each of the three tables', () => {
    for (const devoured of [4, 5, 6, 8] as const) {
      // its OWN named substream — cannot shift the shop / any AI roll
      const rng = new RngStream(0xb0a7).stream('looting-leviathan', devoured);
      const counts: Record<'common' | 'rare' | 'legendary', number> = {
        common: 0,
        rare: 0,
        legendary: 0,
      };
      const N = 100_000;
      for (let i = 0; i < N; i++) counts[rollLootingLeviathanRarity(devoured, rng)]++;

      const expected = lootingLeviathanRarityOdds(devoured);
      for (const rarity of ['common', 'rare', 'legendary'] as const) {
        const pct = (counts[rarity] / N) * 100;
        expect(
          Math.abs(pct - expected[rarity]),
          `devour ${devoured} ${rarity}: observed ${pct.toFixed(2)}% vs table ${expected[rarity]}%`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Swap-conversion count invariant — with real granted modules
// ---------------------------------------------------------------------------

describe('hero swap converts equipped Strengthen back to selectable', () => {
  it('outgoing hero\'s equipped modules return to the pool; total count is unchanged', () => {
    const inv: StrengthenInventory = {
      equipped: { loki: ['loki-s1', 'loki-s2'], hela: ['hela-s1'] },
      selectable: ['groot-s2'],
    };
    const before = totalStrengthen(inv); // 3 equipped + 1 selectable
    const after = convertOnSwapOut(inv, 'loki');

    expect(after.equipped).not.toHaveProperty('loki');
    expect(after.equipped).toHaveProperty('hela'); // untouched
    for (const id of ['groot-s2', 'loki-s1', 'loki-s2']) expect(after.selectable).toContain(id);
    expect(totalStrengthen(after)).toBe(before);
  });

  it('swap + conversion together preserve lineup size AND total Strengthen count', () => {
    const lineup: LineupState = {
      lineup: ['loki', 'hela', 'groot', 'iron-man', 'wolverine', 'mantis'],
      reserve: ['storm', 'namor'],
    };
    const inv: StrengthenInventory = {
      equipped: { loki: ['loki-s1', 'loki-s2'], wolverine: ['wolverine-s1'] },
      selectable: [],
    };
    const before = totalStrengthen(inv);

    const { lineup: nextLineup, strengthen: nextInv } = swapHeroAndConvertStrengthen(
      lineup,
      inv,
      'storm',
      'loki',
    );

    expect(nextLineup.lineup).toHaveLength(6);
    expect(nextLineup.lineup).toContain('storm');
    expect(nextLineup.lineup).not.toContain('loki');
    expect(nextInv.equipped).not.toHaveProperty('loki');
    expect(nextInv.selectable).toEqual(expect.arrayContaining(['loki-s1', 'loki-s2']));
    expect(totalStrengthen(nextInv)).toBe(before); // M10's invariant
  });
});
