import { describe, expect, it } from 'vitest';

import { DRONE_COLOURS } from '../src/data/constants';
import { DRONE_ONE_TIME_DAMAGE, DRONE_ONE_TIME_HEALING } from '../src/data/authored';
import { ARENA_BOUNDS, simulateBattle } from '../src/sim/combat';
import type { BattleField, BattleUnit } from '../src/sim/combat';
import {
  assignDroneColours,
  decodeDroneMove,
  encodeDroneMove,
  planMatchupDrones,
} from '../src/sim/drone';
import type { DroneInputStream, DroneSpec } from '../src/sim/drone';
import { placeholderDronePolicy } from '../src/sim/dronePolicy';
import { RngStream } from '../src/sim/rng';
import type { SideModules } from '../src/sim/stats';
import type { OwnedModule, ProtocolLevels } from '../src/sim/modules';
import type { CombatContext, MatchupKind } from '../src/sim/types';

/*
 * M6 — the Ultron Drone. The drone is INPUT: it enters the sim through a
 * deterministic, quantized per-tick stream (or the M7-placeholder policy), it is
 * NOT a `Unit`, it cannot be targeted or damaged, and its HP mirrors the owning
 * player's 50-based health for the whole battle.
 */

function makeCtx(
  seed: number,
  lineupA: readonly string[],
  lineupB: readonly string[],
  kind: MatchupKind = 'pvp',
): CombatContext {
  return {
    round: 3,
    roundType: 'battle',
    matchupKind: kind,
    sideA: { playerId: 0, lineup: [...lineupA], isPhantom: false, isGalactaBots: false },
    sideB: {
      playerId: 1,
      lineup: [...lineupB],
      isPhantom: kind === 'phantom',
      isGalactaBots: kind === 'pve',
    },
    rng: new RngStream(seed).stream('combat:spec', 3),
  };
}

function levels(p: Partial<ProtocolLevels> = {}): ProtocolLevels {
  return { fortress: 0, onslaught: 0, reboot: 0, equilibrium: 0, ...p };
}
function side(owned: OwnedModule[], protocolLevels: ProtocolLevels = levels()): SideModules {
  return { owned, protocolLevels };
}

const A6 = ['captain-america', 'hulk', 'wolverine', 'black-widow', 'mantis', 'loki'];
const B6 = ['groot', 'thor', 'iron-fist', 'storm', 'adam-warlock', 'luna-snow'];
/** Six non-healers so the ONLY healing in a battle is the drone's. */
const A_NO_HEAL = ['captain-america', 'hulk', 'wolverine', 'black-widow', 'hawkeye', 'iron-man'];

function stream(over: Partial<DroneInputStream> = {}): DroneInputStream {
  return { moves: [], oneTimeDamageTick: null, oneTimeHealTick: null, beamHeldRanges: [], ...over };
}
const beamAll = stream({ beamHeldRanges: [[1, 1_000_000]] });

function droneSpec(input: DroneInputStream | null, health = 50): DroneSpec {
  return { side: 0, playerId: 0, colour: 'Blue', health, input };
}

const droneBursts = (trace: ReturnType<typeof simulateBattle>): number[] =>
  trace.damageLog!.filter((e) => e.srcUnitId === -1 && e.source === 'drone').map((e) => e.tick);

// ---------------------------------------------------------------------------
// 1. One-time abilities: at most once per Battle Phase, reset next round
// ---------------------------------------------------------------------------

describe('one-time abilities', () => {
  it('a recorded press fires the ability exactly once and marks it spent', () => {
    const trace = simulateBattle(makeCtx(1, A6, B6), {
      trace: true,
      tieCapTicks: 400,
      drones: [droneSpec(stream({ oneTimeDamageTick: 5, oneTimeHealTick: 6 }))],
    });
    expect(new Set(droneBursts(trace))).toEqual(new Set([5])); // the only drone damage
    expect(trace.finalDrones[0]!.oneTimeDamageUsed).toBe(true);
    expect(trace.finalDrones[0]!.oneTimeHealUsed).toBe(true);
  });

  it('the placeholder policy would press every tick while enemies are low, but the `used` guard fires it once', () => {
    const lowerFourEnemies = (us: BattleUnit[]): void => {
      for (const u of us) {
        if (u.side === 1 && u.slot < 4) u.health = u.maxHealth * 0.2; // 4 enemies well below 40 %
      }
    };
    const trace = simulateBattle(makeCtx(1, A6, B6), {
      trace: true,
      tieCapTicks: 40,
      place: lowerFourEnemies,
      drones: [droneSpec(null)], // policy-driven
    });
    const ticks = new Set(droneBursts(trace));
    expect(ticks.size).toBe(1); // exactly one burst, ever
    expect([...ticks][0]).toBe(1); // on the first tick the condition holds
  });

  it('resets next round — a fresh battle fires the ability again', () => {
    const run = () =>
      simulateBattle(makeCtx(2, A6, B6), {
        trace: true,
        tieCapTicks: 200,
        drones: [droneSpec(stream({ oneTimeDamageTick: 4 }))],
      });
    for (const t of [run(), run()]) expect(droneBursts(t)).toContain(4);
  });
});

// ---------------------------------------------------------------------------
// 2. One-Time Damage hits every living enemy and no allies; Heal the reverse
// ---------------------------------------------------------------------------

describe('one-time ability targeting', () => {
  const FAR = (us: BattleUnit[]): void => {
    for (const u of us) {
      u.x = 0;
      u.y = u.side === 0 ? 0 : 4000; // no combat between the teams at all
    }
  };

  it('One-Time Damage hits every living side-B unit for exactly the flat amount, no side-A unit', () => {
    const trace = simulateBattle(makeCtx(3, A6, B6), {
      trace: true,
      tieCapTicks: 6,
      place: FAR,
      drones: [droneSpec(stream({ oneTimeDamageTick: 3 }))],
    });
    const burst = trace.damageLog!.filter((e) => e.srcUnitId === -1 && e.source === 'drone');
    expect(burst.every((e) => e.tick === 3)).toBe(true);
    expect(new Set(burst.map((e) => e.tgtUnitId))).toEqual(new Set([6, 7, 8, 9, 10, 11])); // dense ids
    for (const e of burst) expect(e.amount).toBeCloseTo(DRONE_ONE_TIME_DAMAGE, 9); // no modules → ×1
  });

  it('One-Time Healing tops up every living ally and touches no enemy', () => {
    const HURT = (us: BattleUnit[]): void => {
      for (const u of us) {
        u.x = 0;
        u.y = u.side === 0 ? 0 : 4000;
        if (u.side === 0) u.health = u.maxHealth - 150; // room for a full 120 top-up, still alive
      }
    };
    let before: number[] = [];
    let after: number[] = [];
    let enemyBefore: number[] = [];
    let enemyAfter: number[] = [];
    simulateBattle(makeCtx(3, A_NO_HEAL, B6), {
      tieCapTicks: 6,
      place: HURT,
      drones: [droneSpec(stream({ oneTimeHealTick: 4 }))],
      onTick: (f: BattleField) => {
        if (f.tick === 3) {
          before = f.units.filter((u) => u.side === 0).map((u) => u.health);
          enemyBefore = f.units.filter((u) => u.side === 1).map((u) => u.health);
        }
        if (f.tick === 4) {
          after = f.units.filter((u) => u.side === 0).map((u) => u.health);
          enemyAfter = f.units.filter((u) => u.side === 1).map((u) => u.health);
        }
      },
    });
    expect(before).toHaveLength(6);
    for (let i = 0; i < 6; i++) expect(after[i]! - before[i]!).toBeCloseTo(DRONE_ONE_TIME_HEALING, 6);
    expect(enemyAfter).toEqual(enemyBefore);
  });
});

// ---------------------------------------------------------------------------
// 3. Encephalo-Ray budget — measured, < 0.1 % of a Duelist's whole-battle damage
// ---------------------------------------------------------------------------

describe('Encephalo-Ray budget', () => {
  it('the beam held the entire battle does < 0.1 % of a Duelist total, and never flips the outcome', () => {
    const opts = {
      trace: true as const,
      sideAModules: side(
        [
          { moduleId: 'fortress-health-expansion', stars: 6 },
          { moduleId: 'onslaught-damage-enhancement', stars: 4 },
        ],
        levels({ fortress: 2, onslaught: 2 }),
      ),
      sideBModules: side([{ moduleId: 'fortress-health-expansion', stars: 6 }], levels({ fortress: 2 })),
    };

    const withBeam = simulateBattle(makeCtx(7, A6, B6), {
      ...opts,
      drones: [{ side: 0, playerId: 0, colour: 'Yellow', health: 50, input: beamAll }],
    });
    const withoutDrone = simulateBattle(makeCtx(7, A6, B6), opts);

    const beamTotal = withBeam
      .damageLog!.filter((e) => e.srcUnitId === -1 && e.source === 'drone')
      .reduce((s, e) => s + e.amount, 0);
    const duelistTotal = withBeam
      .damageLog!.filter((e) => e.srcUnitId === 3) // black-widow (sniper Duelist)
      .reduce((s, e) => s + e.amount, 0);

    expect(beamTotal).toBeGreaterThan(0);
    expect(duelistTotal).toBeGreaterThan(500);
    expect(beamTotal / duelistTotal).toBeLessThan(0.001); // < 0.1 %
    expect(withBeam.outcome.result).toBe(withoutDrone.outcome.result); // never a win condition
  });
});

// ---------------------------------------------------------------------------
// 4. The drone is never targeted and never takes damage
// ---------------------------------------------------------------------------

describe('the drone is not a Unit', () => {
  it('flies through the enemy formation without being acquired or damaged', () => {
    const straightUp = stream({ moves: Array.from({ length: 400 }, () => encodeDroneMove(0, 1)) });
    let ok = true;
    let unitCount = -1;
    const trace = simulateBattle(makeCtx(5, A6, B6), {
      tieCapTicks: 300,
      drones: [droneSpec(straightUp)],
      onTick: (f: BattleField) => {
        if (unitCount === -1) unitCount = f.units.length;
        if (f.units.length !== unitCount) ok = false;
        for (const u of f.units) {
          if (u.targetId !== -1 && (u.targetId < 0 || u.targetId >= f.units.length)) ok = false;
        }
        for (const d of f.drones) if (d.health !== 50) ok = false;
      },
    });
    expect(ok).toBe(true);
    expect(trace.finalDrones[0]!.health).toBe(50);
    expect(trace.finalDrones[0]!.y).toBeCloseTo(ARENA_BOUNDS.maxY, 6); // crossed to the far edge
  });
});

// ---------------------------------------------------------------------------
// 5. Drone HP tracks the player's health exactly
// ---------------------------------------------------------------------------

describe('drone HP = player health', () => {
  it('the drone reports exactly the health it was built with and combat never changes it', () => {
    let moved = false;
    const trace = simulateBattle(makeCtx(9, A6, B6), {
      tieCapTicks: 120,
      drones: [droneSpec(beamAll, 37)],
      onTick: (f: BattleField) => {
        if (f.drones[0]!.health !== 37) moved = true;
      },
    });
    expect(moved).toBe(false);
    expect(trace.finalDrones[0]!.health).toBe(37);
  });

  it('planMatchupDrones copies each side\'s player health onto its drone', () => {
    const drones = planMatchupDrones({
      matchupKind: 'pvp',
      a: { playerId: 0, colour: 'Blue', health: 42 },
      b: { playerId: 1, colour: 'Red', health: 19 },
    });
    expect(drones.map((d) => [d.side, d.playerId, d.health])).toEqual([
      [0, 0, 42],
      [1, 1, 19],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism — same seed + same input stream ⇒ identical digest
// ---------------------------------------------------------------------------

describe('determinism including drone inputs', () => {
  const rich = stream({
    moves: Array.from({ length: 120 }, (_, i) => encodeDroneMove(0.3, i % 2 === 0 ? 1 : -0.5)),
    oneTimeDamageTick: 40,
    oneTimeHealTick: 55,
    beamHeldRanges: [
      [1, 30],
      [60, 90],
    ],
  });

  const run = (s: DroneInputStream): string =>
    simulateBattle(makeCtx(0x5eed, A6, B6), { tieCapTicks: 200, drones: [droneSpec(s)] }).digest;

  it('30 runs of the same seed + stream hash identically', () => {
    const ref = run(rich);
    for (let i = 0; i < 30; i++) expect(run(rich)).toBe(ref);
  });

  it('a one-quant change to a single move frame changes the digest', () => {
    const nudged = stream({
      ...rich,
      moves: rich.moves.map((m, i) => (i === 10 ? { qx: m.qx + 1, qy: m.qy } : m)),
    });
    expect(run(nudged)).not.toBe(run(rich));
  });

  it('moving a press tick changes the digest', () => {
    expect(run(stream({ ...rich, oneTimeDamageTick: 41 }))).not.toBe(run(rich));
  });

  it('removing the drone entirely changes the digest', () => {
    const noDrone = simulateBattle(makeCtx(0x5eed, A6, B6), { tieCapTicks: 200 }).digest;
    expect(noDrone).not.toBe(run(rich));
  });
});

// ---------------------------------------------------------------------------
// 7. Colour draw + matchup drone plan
// ---------------------------------------------------------------------------

describe('drone colour', () => {
  it('one canonical colour per player, distinct for six, deterministic per seed', () => {
    const draw = (): readonly string[] =>
      assignDroneColours(new RngStream(12345).stream('drone-colour', 0), 6);
    const cols = draw();
    expect(cols).toHaveLength(6);
    for (const c of cols) expect(DRONE_COLOURS).toContain(c);
    expect(new Set(cols).size).toBe(6);
    expect(draw()).toEqual(cols);
  });
});

describe('planMatchupDrones', () => {
  const a = { playerId: 0, colour: 'Blue' as const, health: 50 };
  const b = { playerId: 1, colour: 'Red' as const, health: 50 };

  it('pvp → both drones; mirror → both (authored); phantom / pve → player only', () => {
    expect(planMatchupDrones({ matchupKind: 'pvp', a, b }).map((d) => d.side)).toEqual([0, 1]);
    expect(planMatchupDrones({ matchupKind: 'mirror', a, b }).map((d) => d.side)).toEqual([0, 1]);
    expect(planMatchupDrones({ matchupKind: 'phantom', a, b }).map((d) => d.side)).toEqual([0]);
    expect(planMatchupDrones({ matchupKind: 'pve', a, b: null }).map((d) => d.side)).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// 8. Movement quantization round-trip
// ---------------------------------------------------------------------------

describe('quantized movement', () => {
  it('encode → decode round-trips a unit vector and normalises anything longer', () => {
    // a already-unit-length direction survives the fixed-point round trip
    const u = decodeDroneMove(stream({ moves: [encodeDroneMove(0.6, 0.8)] }), 1)!;
    expect(u.x).toBeCloseTo(0.6, 6);
    expect(u.y).toBeCloseTo(0.8, 6);
    // an over-long stored vector (both components clamped to ±QUANT) decodes normalised, magnitude ≤ 1
    const clamped = decodeDroneMove(stream({ moves: [encodeDroneMove(3, 4)] }), 1)!;
    expect(Math.sqrt(clamped.x * clamped.x + clamped.y * clamped.y)).toBeLessThanOrEqual(1 + 1e-9);
    expect(decodeDroneMove(stream(), 1)).toBeNull();
    expect(decodeDroneMove(stream({ moves: [{ qx: 0, qy: 0 }] }), 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Placeholder drone policy (M7 replaces this)
// ---------------------------------------------------------------------------

describe('placeholder drone policy', () => {
  const base = { oneTimeDamageUsed: false, oneTimeHealUsed: false };

  it('fires One-Time Damage only at ≥ 3 low enemies, One-Time Heal only at ≥ 2 low allies', () => {
    expect(placeholderDronePolicy({ ...base, enemiesBelowLowHp: 3, alliesBelowLowHp: 0 }).pressOneTimeDamage).toBe(true);
    expect(placeholderDronePolicy({ ...base, enemiesBelowLowHp: 2, alliesBelowLowHp: 0 }).pressOneTimeDamage).toBe(false);
    expect(placeholderDronePolicy({ ...base, enemiesBelowLowHp: 0, alliesBelowLowHp: 2 }).pressOneTimeHeal).toBe(true);
    expect(placeholderDronePolicy({ ...base, enemiesBelowLowHp: 0, alliesBelowLowHp: 1 }).pressOneTimeHeal).toBe(false);
  });

  it('never re-fires a spent ability, and leaves movement / beam to M7', () => {
    const cmd = placeholderDronePolicy({
      enemiesBelowLowHp: 6,
      alliesBelowLowHp: 6,
      oneTimeDamageUsed: true,
      oneTimeHealUsed: true,
    });
    expect(cmd.pressOneTimeDamage).toBe(false);
    expect(cmd.pressOneTimeHeal).toBe(false);
    expect(cmd.move).toBeNull();
    expect(cmd.beam).toBe(false);
  });
});
