import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SPEED_UP_DAMAGE_MULTIPLIER } from '../src/data/constants';
import { BATTLE_MAX_TICKS, BATTLE_TIE_CAP_TICKS } from '../src/data/authored';
import {
  TARGET_REACQUIRE_GRACE_TICKS,
  assignFormation,
  chooseTargetId,
  createCombatResolver,
  simulateBattle,
  updateOutOfRangeTimer,
} from '../src/sim/combat';
import type { BattleField, SimulateOptions } from '../src/sim/combat';
import {
  BEHAVIOURAL_HANDLERS,
  behaviouralEffectIdsInData,
  missingBehaviouralHandlers,
  staleBehaviouralHandlers,
} from '../src/sim/effects';
import { runMatch } from '../src/sim/match';
import { RngStream } from '../src/sim/rng';
import { emptySide, resolveUnits } from '../src/sim/stats';
import type { SideModules } from '../src/sim/stats';
import type { OwnedModule, ProtocolLevels } from '../src/sim/modules';
import type { CombatContext, MatchupKind } from '../src/sim/types';
import type { Targeting } from '../src/data/types';

/*
 * M5 combat core. Every assertion in the milestone lives here (the 100× hash
 * also runs under `npm run test:determinism`). Reference arithmetic is inline in
 * a comment so a bug in the sim and a matching bug in a test cannot pass
 * together.
 */

// A FRESH context (fresh substream) each call — required for the 100× replay.
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
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

const MIXED_A = ['captain-america', 'hulk', 'wolverine', 'black-widow', 'mantis', 'loki'];
const MIXED_B = ['groot', 'thor', 'iron-fist', 'storm', 'adam-warlock', 'luna-snow'];

// ---------------------------------------------------------------------------
// 1. Determinism — the whole milestone
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same seed + inputs => byte-identical tick-by-tick digest across 100 runs', () => {
    const runOne = (): ReturnType<typeof simulateBattle> =>
      simulateBattle(makeCtx(0x5eed, MIXED_A, MIXED_B), {
        sideAModules: side(
          [
            { moduleId: 'onslaught-life-steal', stars: 3 },
            { moduleId: 'fortress-health-expansion', stars: 4 },
            { moduleId: 'reboot-double-heal', stars: 1 },
            { moduleId: 'onslaught-infinite-drive', stars: 1 },
          ],
          levels({ onslaught: 2, fortress: 1, reboot: 1 }),
        ),
        sideBModules: side(
          [
            { moduleId: 'fortress-defensive-shell', stars: 3 },
            { moduleId: 'equilibrium-cumulative-dual-enhancement', stars: 1 },
          ],
          levels({ fortress: 1, equilibrium: 2 }),
        ),
      });

    const ref = runOne();
    expect(ref.tickCount).toBeGreaterThan(30);
    for (let i = 0; i < 100; i++) {
      const r = runOne();
      expect(r.digest, `run ${i} digest`).toBe(ref.digest);
      expect(r.tickCount, `run ${i} tickCount`).toBe(ref.tickCount);
      expect(r.outcome, `run ${i} outcome`).toEqual(ref.outcome);
      expect(r.kills, `run ${i} kills`).toEqual(ref.kills);
      expect(r.revives, `run ${i} revives`).toEqual(ref.revives);
    }
  });

  it('the digest responds to its inputs — seeds diverge once RNG is in play', () => {
    // Double Heal draws from ctx.rng on every Strategist heal, so the seed matters.
    const digests = new Set<string>();
    for (let s = 0; s < 20; s++) {
      digests.add(
        simulateBattle(makeCtx(s, MIXED_A, MIXED_B), {
          sideAModules: side([{ moduleId: 'reboot-double-heal', stars: 1 }], levels({ reboot: 2 })),
        }).digest,
      );
    }
    expect(digests.size).toBeGreaterThan(12);
  });

  it('a module-free battle is seed-independent BY DESIGN (nothing draws from ctx.rng)', () => {
    const d0 = simulateBattle(makeCtx(0, MIXED_A, MIXED_B)).digest;
    expect(simulateBattle(makeCtx(999, MIXED_A, MIXED_B)).digest).toBe(d0);
    // ...but the digest still tracks the actual inputs — swap the sides and it changes.
    expect(simulateBattle(makeCtx(0, MIXED_B, MIXED_A)).digest).not.toBe(d0);
  });

  it('a full headless match with the real resolver replays identically', () => {
    const run = (): string => {
      const res = runMatch(4242, [], createCombatResolver());
      return JSON.stringify({
        winnerId: res.finalState.winnerId,
        round: res.finalState.round,
        placements: res.finalState.players.map((p) => p.placement),
        boundaryHashes: res.boundaries.map((b) => b.hash),
      });
    };
    const first = run();
    for (let i = 0; i < 4; i++) expect(run()).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// 2. Targeting matrix — all three priorities, incl. the two named cases
// ---------------------------------------------------------------------------

describe('targeting', () => {
  const self = (targeting: Targeting) => ({ id: 0, side: 0 as const, x: 0, y: 0, targeting });
  const foe = (id: number, x: number, maxHealth: number, alive = true) => ({
    id,
    side: 1 as const,
    x,
    y: 0,
    maxHealth,
    alive,
  });

  it('nearest -> least distance, ties by id', () => {
    expect(chooseTargetId(self('nearest'), [foe(1, 10, 300), foe(2, 3, 300), foe(3, 20, 300)])).toBe(
      2,
    );
    expect(chooseTargetId(self('nearest'), [foe(5, 4, 300), foe(2, 4, 300)])).toBe(2);
  });

  it('lowest / highest max health -> extreme resolved max health, then nearer, then id', () => {
    const pool = [foe(1, 1, 700), foe(2, 50, 250), foe(3, 2, 400)];
    expect(chooseTargetId(self('lowestMaxHealth'), pool)).toBe(2);
    expect(chooseTargetId(self('highestMaxHealth'), pool)).toBe(1);
    // tie on maxHealth: nearer wins, then id
    expect(chooseTargetId(self('lowestMaxHealth'), [foe(4, 10, 250), foe(2, 3, 250)])).toBe(2);
    expect(chooseTargetId(self('lowestMaxHealth'), [foe(4, 3, 250), foe(2, 3, 250)])).toBe(2);
  });

  it('L / H target on RESOLVED max health, not current health — Wolverine picks 700, Venom picks 250', () => {
    const [groot, bw] = resolveUnits(['groot', 'black-widow'], emptySide(), [], emptySide());
    // groot resolves to 700 max health, black-widow to 250; place the 250 CLOSER.
    const pool = [
      { id: 6, side: 1 as const, x: 5, y: 0, maxHealth: groot!.maxHealth, alive: true },
      { id: 7, side: 1 as const, x: 2, y: 0, maxHealth: bw!.maxHealth, alive: true },
    ];
    expect(groot!.maxHealth).toBe(700);
    expect(bw!.maxHealth).toBe(250);
    // Wolverine = highestMaxHealth -> the 700, even though the 250 is nearer.
    expect(chooseTargetId(self('highestMaxHealth'), pool)).toBe(6);
    // Venom = lowestMaxHealth -> the 250.
    expect(chooseTargetId(self('lowestMaxHealth'), pool)).toBe(7);
  });

  it('a lowestMaxHealth attacker never flips target as the enemy takes damage', () => {
    // venom (lowestMaxHealth) with iron-fist (max 300) and black-widow (max 250) both inside
    // its melee range. venom must keep hitting black-widow (lower MAX) tick after tick, even
    // though iron-fist is right there and taking damage from its own side's fire is irrelevant.
    const trace = simulateBattle(makeCtx(7, ['venom'], ['iron-fist', 'black-widow']), {
      trace: true,
      tieCapTicks: 100,
      place: (us) => {
        us[0]!.x = 0;
        us[0]!.y = 0; // venom
        us[1]!.x = 0;
        us[1]!.y = 4; // iron-fist, in venom's melee range (higher MAX -> ignored)
        us[2]!.x = 0;
        us[2]!.y = 5; // black-widow, in venom's melee range
      },
    });
    const venomHits = trace.damageLog!.filter((e) => e.srcUnitId === 0);
    expect(venomHits.length).toBeGreaterThan(1);
    // 2 = black-widow (dense ids: side A gets 0, side B gets 1, 2)
    expect(venomHits.every((e) => e.tgtUnitId === 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. A 1v1 with known stats against a hand-computed time-to-kill
// ---------------------------------------------------------------------------

describe('1v1 hand-computed time-to-kill', () => {
  it('Black Widow kills Hawkeye on the expected tick (no modules, no movement)', () => {
    /*
     * Black Widow: dps 115, attackSpeed 0.9, range 32, health 250.
     *   per-hit = 115 / 0.9        = 127.7778
     *   interval = round(30 / 0.9) = round(33.33) = 33 ticks  -> shots at tick 1, 34, ...
     * Hawkeye:     dps 120, attackSpeed 0.8, range 34, health 250.
     *   per-hit = 120 / 0.8        = 150
     *   interval = round(30 / 0.8) = round(37.5) = 38 ticks   -> shots at tick 1, 39, ...
     * Placed 20 apart -> both in range, neither moves. No modules -> no multipliers.
     *   tick 1:  BW hits Hawkeye 250 -> 122.2222 ; Hawkeye hits BW 250 -> 100
     *   tick 34: BW's 2nd shot -> Hawkeye 122.2222 - 127.7778 = -5.5556  => KO at tick 34,
     *            BEFORE Hawkeye's 2nd shot at tick 39.
     */
    const trace = simulateBattle(makeCtx(1, ['black-widow'], ['hawkeye']), {
      place: (us) => {
        us[0]!.x = 0;
        us[0]!.y = 0;
        us[1]!.x = 0;
        us[1]!.y = 20;
      },
    });
    expect(trace.tickCount).toBeGreaterThanOrEqual(33);
    expect(trace.tickCount).toBeLessThanOrEqual(35);
    expect(trace.tickCount).toBe(34);
    expect(trace.outcome.result).toBe('win');
    expect(trace.outcome.survivingUnits).toBe(1);
    expect(trace.outcome.survivorsSideA).toBe(1);
    expect(trace.outcome.survivorsSideB).toBe(0);
    expect(trace.kills).toHaveLength(1);
    expect(trace.kills[0]).toMatchObject({
      killerHeroId: 'black-widow',
      victimHeroId: 'hawkeye',
      weapon: 'primary',
      tick: 34,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Speed Up Protocol — exact x2.2, applied once, non-compounding, tie at cap
// ---------------------------------------------------------------------------

describe('Speed Up Protocol', () => {
  it('multiplies damage by exactly 2.2, from a flag, without compounding over a 300-tick phase', () => {
    // doctor-strange (dps 62, as 1.1, range 16) vs magneto (dps 58, as 1.0, range 15), health 575/650.
    // per-hit DS = 62/1.1 = 56.3636; interval round(30/1.1) = 27.
    // Speed Up flipped at tick 10 -> every DS primary hit from tick 10 on should be
    // exactly 56.3636 * 2.2, and STAY that (never 2.2^2, 2.2^3, ...).
    const trace = simulateBattle(makeCtx(2, ['doctor-strange'], ['magneto']), {
      trace: true,
      speedUpTriggerTicks: 10,
      tieCapTicks: 400,
      place: (us) => {
        us[0]!.x = 0;
        us[0]!.y = 0;
        us[1]!.x = 0;
        us[1]!.y = 14;
      },
    });
    expect(trace.speedUpStartedAtTick).toBe(10);

    const dsHits = trace.damageLog!.filter((e) => e.srcUnitId === 0 && e.source === 'primary');
    const pre = dsHits.filter((e) => e.tick < 10).map((e) => e.amount);
    const post = dsHits.filter((e) => e.tick >= 10).map((e) => e.amount);
    expect(pre.length).toBeGreaterThanOrEqual(1);
    expect(post.length).toBeGreaterThanOrEqual(3);

    const perHit = 62 / 1.1;
    for (const a of pre) expect(a).toBeCloseTo(perHit, 6);
    for (const a of post) expect(a).toBeCloseTo(perHit * 2.2, 6);
    // non-compounding: every post-trigger hit is the SAME value
    expect(new Set(post.map((a) => a.toFixed(6))).size).toBe(1);
    expect(SPEED_UP_DAMAGE_MULTIPLIER).toBeCloseTo(2.2, 12);
  });

  it('ends the battle as a tie at the tie cap', () => {
    // two melee tanks 5000 apart never meet -> tie at the (shortened) cap.
    const trace = simulateBattle(makeCtx(1, ['groot'], ['the-thing']), {
      tieCapTicks: 60,
      place: (us) => {
        us[0]!.y = 0;
        us[1]!.y = 5000;
      },
    });
    expect(trace.endReason).toBe('tieCap');
    expect(trace.outcome.result).toBe('tie');
    expect(trace.tickCount).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 5. Bonus-health cap + excess healing + Overflow Recharge
// ---------------------------------------------------------------------------

describe('health caps and excess healing', () => {
  it('no unit exceeds resolved max health except through bonus-health effects', () => {
    let violations = 0;
    simulateBattle(makeCtx(11, MIXED_A, MIXED_B), {
      sideAModules: side([{ moduleId: 'reboot-healing-enhancement', stars: 6 }], levels({ reboot: 3 })),
      onTick: (f: BattleField) => {
        for (const u of f.units) if (u.health > u.maxHealth + 1e-6) violations++;
      },
    });
    expect(violations).toBe(0);
  });

  it('excess healing is discarded — unless Overflow Recharge is active', () => {
    // side A = [groot (id 0), mantis (id 1)]; groot spawns at 699/700 so it is always the
    // most-injured ally and, once full, keeps the id-0 tiebreak — every subsequent
    // mantis heal is pure overflow. side B jeff is parked 900 away and never engages.
    const scenario = (mods: SideModules): { grootOver: number; grootMax: boolean } => {
      let grootOver = 0;
      let exceededMax = false;
      simulateBattle(makeCtx(3, ['groot', 'mantis'], ['jeff-the-land-shark']), {
        sideAModules: mods,
        tieCapTicks: 80,
        place: (us) => {
          us[0]!.x = 0;
          us[0]!.y = 0;
          us[0]!.health = 699;
          us[1]!.x = 3;
          us[1]!.y = 0;
          us[2]!.x = 0;
          us[2]!.y = 900;
        },
        onTick: (f) => {
          const g = f.units[0]!;
          grootOver = g.overhealth;
          if (g.health > g.maxHealth + 1e-6) exceededMax = true;
        },
      });
      return { grootOver, grootMax: exceededMax };
    };

    const without = scenario(emptySide());
    const withRecharge = scenario(side([{ moduleId: 'reboot-overflow-recharge', stars: 3 }]));

    expect(without.grootOver).toBe(0); // overflow discarded
    expect(withRecharge.grootOver).toBeGreaterThan(1); // overflow -> bonus health
    expect(without.grootMax).toBe(false);
    expect(withRecharge.grootMax).toBe(false); // regular health still capped at max
  });
});

// ---------------------------------------------------------------------------
// 6. Reductions multiply, they do not sum
// ---------------------------------------------------------------------------

describe('damage-taken reductions are multiplicative', () => {
  it('a stack that would exceed 100% additively still leaves positive damage', () => {
    /*
     * groot (side B) carries Fortress Defensive Shell 6* (-42%) and, with a
     * 3-unique-role lineup, Equilibrium Defensive Shell 6* (7% * 3 = -21%).
     *   stats.ts folds these into damageTakenMultiplier = 0.58 * 0.79 = 0.4582.
     * Critical Damage Shell is forced active -> a further * (1 - 0.80).
     *   final = 0.4582 * 0.20 = 0.09164
     * Hawkeye per-hit = 150 (no modules) -> applied hit = 150 * 0.09164 = 13.746.
     * The ADDITIVE reading, 1 - (0.42 + 0.21 + 0.80) = -0.43, would "heal" for -64.5.
     */
    const trace = simulateBattle(
      makeCtx(4, ['hawkeye'], ['groot', 'black-widow', 'mantis']),
      {
        trace: true,
        tieCapTicks: 3,
        sideBModules: side([
          { moduleId: 'fortress-defensive-shell', stars: 6 },
          { moduleId: 'equilibrium-defensive-shell', stars: 6 },
        ]),
        place: (us) => {
          us[0]!.x = 0;
          us[0]!.y = 0; // hawkeye
          us[1]!.x = 0;
          us[1]!.y = 20; // groot (nearest -> hawkeye targets it)
          us[1]!.criticalDamageShellUsed = true;
          us[1]!.criticalDamageShellTicks = 9999;
          us[2]!.x = 0;
          us[2]!.y = 600;
          us[3]!.x = 0;
          us[3]!.y = 600;
        },
      },
    );
    const firstOnGroot = trace.damageLog!.find((e) => e.srcUnitId === 0 && e.tgtUnitId === 1);
    expect(firstOnGroot).toBeDefined();
    expect(firstOnGroot!.amount).toBeGreaterThan(0);
    expect(firstOnGroot!.amount).toBeCloseTo(150 * 0.4582 * 0.2, 3);
    expect(firstOnGroot!.amount).not.toBeCloseTo(150 * (1 - (0.42 + 0.21 + 0.8)), 3);
  });
});

// ---------------------------------------------------------------------------
// 7. Kill events
// ---------------------------------------------------------------------------

describe('kill events', () => {
  it('every KO emits exactly one kill event (revives are separate; a re-death emits a second)', () => {
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
      const trace = simulateBattle(makeCtx(seed, MIXED_A, MIXED_B), {
        sideAModules: side([{ moduleId: 'fortress-backup-rebirth', stars: 1 }], levels({ fortress: 2 })),
      });
      const koCount = new Map<number, number>();
      for (const k of trace.kills) koCount.set(k.victimUnitId, (koCount.get(k.victimUnitId) ?? 0) + 1);

      for (const u of trace.finalUnits) {
        const kos = koCount.get(u.id) ?? 0;
        const revived = trace.revives.some((r) => r.unitId === u.id);
        if (!revived) {
          expect(kos, `seed ${seed} unit ${u.id} (no revive)`).toBe(u.alive ? 0 : 1);
        } else {
          expect(kos, `seed ${seed} unit ${u.id} (revived)`).toBe(u.alive ? 1 : 2);
        }
      }
      // no two kill events for the same victim on the same tick
      const perTick = new Set(trace.kills.map((k) => `${k.victimUnitId}@${k.tick}`));
      expect(perTick.size).toBe(trace.kills.length);
    }
  });

  it('the kill feed carries a designed damage-source for every KO', () => {
    const trace = simulateBattle(makeCtx(9, MIXED_A, MIXED_B));
    for (const k of trace.kills) {
      expect(['primary', 'ability', 'ultimate', 'module', 'drone']).toContain(k.weapon);
      expect(k.victimHeroId.length).toBeGreaterThan(0);
      if (k.killerUnitId >= 0) expect(k.killerHeroId).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. maxTicks throws (it is strictly larger than the tie cap)
// ---------------------------------------------------------------------------

describe('maxTicks bug guard', () => {
  it('the paranoid ceiling is strictly larger than the game-rule tie cap', () => {
    expect(BATTLE_MAX_TICKS).toBeGreaterThan(BATTLE_TIE_CAP_TICKS);
  });

  it('throws rather than looping when a pathological config makes it reachable', () => {
    // tie cap raised above maxTicks + two tanks that never meet -> nothing resolves.
    expect(() =>
      simulateBattle(makeCtx(1, ['groot'], ['the-thing']), {
        maxTicks: 40,
        tieCapTicks: 100_000,
        place: (us) => {
          us[0]!.y = 0;
          us[1]!.y = 5000;
        },
      }),
    ).toThrow(/maxTicks/);
  });
});

// ---------------------------------------------------------------------------
// 9. Behavioural Base Modules — completeness + "each one measurably does something"
// ---------------------------------------------------------------------------

describe('behavioural Base Modules', () => {
  it('every behavioural effectId in the data has a registered handler and none is stale', () => {
    expect(missingBehaviouralHandlers()).toEqual([]);
    expect(staleBehaviouralHandlers()).toEqual([]);
    expect(behaviouralEffectIdsInData().length).toBe(12);
    expect(Object.keys(BEHAVIOURAL_HANDLERS).sort()).toEqual(behaviouralEffectIdsInData());
  });

  it('no reachable TODO in the M5 combat sources', () => {
    for (const f of ['combat.ts', 'effects.ts', 'abilities.ts']) {
      const src = readFileSync(join(process.cwd(), 'src', 'sim', f), 'utf8');
      expect(src.includes('TODO'), `${f} contains a TODO`).toBe(false);
    }
  });

  const CLUSTER: SimulateOptions['place'] = (us) => {
    us.forEach((u, i) => {
      u.x = (i % 3) * 3 - 3;
      u.y = u.side === 0 ? 0 : 10;
    });
  };
  const A3 = ['groot', 'wolverine', 'mantis'];
  const B3 = ['the-thing', 'iron-fist', 'luna-snow'];
  const baseline = simulateBattle(makeCtx(6, A3, B3), { tieCapTicks: 800, place: CLUSTER }).digest;

  const cases: ReadonlyArray<readonly [string, OwnedModule[], ProtocolLevels]> = [
    ['Last Stand Damage Enhancement', [{ moduleId: 'fortress-last-stand-damage-enhancement', stars: 3 }], levels({ fortress: 1 })],
    ['Steady Recovery', [{ moduleId: 'fortress-steady-recovery', stars: 3 }], levels({ fortress: 1 })],
    ['Initial Damage Enhancement (10s window)', [{ moduleId: 'onslaught-initial-damage-enhancement', stars: 3 }], levels({ onslaught: 1 })],
    ['Vulnerability Mark', [{ moduleId: 'onslaught-vulnerability-mark', stars: 3 }], levels({ onslaught: 1 })],
    ['Life Steal', [{ moduleId: 'onslaught-life-steal', stars: 3 }], levels({ onslaught: 1 })],
    ['Deadly Healing', [{ moduleId: 'reboot-deadly-healing', stars: 3 }], levels({ reboot: 1 })],
    ['Critical Damage Shell', [{ moduleId: 'fortress-critical-damage-shell', stars: 1 }], levels({ fortress: 2 })],
    ['Backup Rebirth (Fortress)', [{ moduleId: 'fortress-backup-rebirth', stars: 1 }], levels({ fortress: 2 })],
    ['Backup Rebirth (Onslaught)', [{ moduleId: 'onslaught-backup-rebirth', stars: 1 }], levels({ onslaught: 2 })],
    ['Backup Rebirth (Equilibrium)', [{ moduleId: 'equilibrium-backup-rebirth', stars: 1 }], levels({ equilibrium: 2 })],
    ['Infinite Drive (Onslaught)', [{ moduleId: 'onslaught-infinite-drive', stars: 1 }], levels({ onslaught: 2 })],
    ['Annihilator Fury (Rampage)', [{ moduleId: 'onslaught-annihilator-fury', stars: 1 }], levels({ onslaught: 2 })],
    ['Double Heal', [{ moduleId: 'reboot-double-heal', stars: 1 }], levels({ reboot: 2 })],
    ['Critical Counter', [{ moduleId: 'reboot-critical-counter', stars: 1 }], levels({ reboot: 2 })],
    ['Cumulative Dual Enhancement', [{ moduleId: 'equilibrium-cumulative-dual-enhancement', stars: 1 }], levels({ equilibrium: 2 })],
  ];

  it.each(cases)('%s measurably changes the simulated battle', (_name, owned, lv) => {
    const withModule = simulateBattle(makeCtx(6, A3, B3), {
      tieCapTicks: 800,
      place: CLUSTER,
      sideAModules: side(owned, lv),
    }).digest;
    expect(withModule).not.toBe(baseline);
  });
});

// ---------------------------------------------------------------------------
// 10. Infinite Drive rolls its no-consume at cast time, from the combat substream
// ---------------------------------------------------------------------------

describe('Infinite Drive', () => {
  it('keeps ult energy ~40% of casts (Fortress) — the roll comes from ctx.rng', () => {
    let kept = 0;
    const N = 400;
    for (let s = 0; s < N; s++) {
      simulateBattle(makeCtx(s, ['captain-america'], ['hawkeye']), {
        tieCapTicks: 2,
        sideAModules: side([{ moduleId: 'fortress-infinite-drive', stars: 1 }], levels({ fortress: 2 })),
        place: (us) => {
          us[0]!.x = 0;
          us[0]!.y = 0;
          us[0]!.ultEnergy = 1; // primed
          us[1]!.x = 0;
          us[1]!.y = 400; // far -> no damage -> energy only moves via the cast
        },
        onTick: (f) => {
          if (f.tick !== 1) return;
          const cap = f.units[0]!;
          expect(cap.ultCasts).toBe(1);
          if (cap.ultEnergy >= 1) kept++;
        },
      });
    }
    expect(kept / N).toBeGreaterThan(0.3);
    expect(kept / N).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 11. Target re-acquisition
// ---------------------------------------------------------------------------

describe('target re-acquisition', () => {
  it('the out-of-range timer fires only after MORE than the grace window', () => {
    const u = { outOfRangeTicks: 0 };
    for (let i = 0; i < TARGET_REACQUIRE_GRACE_TICKS; i++) {
      expect(updateOutOfRangeTimer(u, false), `tick ${i + 1}`).toBe(false);
    }
    expect(updateOutOfRangeTimer(u, false)).toBe(true);

    const v = { outOfRangeTicks: 0 };
    for (let i = 0; i < 9; i++) updateOutOfRangeTimer(v, false);
    updateOutOfRangeTimer(v, true);
    expect(v.outOfRangeTicks).toBe(0);
    for (let i = 0; i < TARGET_REACQUIRE_GRACE_TICKS; i++) {
      expect(updateOutOfRangeTimer(v, false)).toBe(false);
    }
  });

  it('re-acquires when the current target dies', () => {
    const seen: number[] = [];
    simulateBattle(makeCtx(3, ['hulk'], ['black-widow', 'squirrel-girl']), {
      tieCapTicks: 120,
      place: (us) => {
        us[0]!.x = 0;
        us[0]!.y = 0; // hulk
        us[1]!.x = 0;
        us[1]!.y = 3; // black-widow, point-blank
        us[2]!.x = 0;
        us[2]!.y = 400; // squirrel-girl, never engages in-window
      },
      onTick: (f) => {
        const t = f.units[0]!.targetId;
        if (seen[seen.length - 1] !== t) seen.push(t);
      },
    });
    expect(seen).toContain(1); // black-widow
    expect(seen).toContain(2); // squirrel-girl, after black-widow dies
  });
});

// ---------------------------------------------------------------------------
// 12. External-actor seam (M6 drone) — combat never reaches for input itself
// ---------------------------------------------------------------------------

describe('external actor input stream', () => {
  it('an injected drone damage event resolves a battle faster and shows in the kill feed', () => {
    const plain = simulateBattle(makeCtx(5, ['groot'], ['hawkeye']), {
      place: (us) => {
        us[0]!.y = 0;
        us[1]!.y = 20;
      },
    });
    const withDrone = simulateBattle(makeCtx(5, ['groot'], ['hawkeye']), {
      place: (us) => {
        us[0]!.y = 0;
        us[1]!.y = 20;
      },
      externalActors: [{ tick: 2, kind: 'damageEnemiesOf', side: 0, amount: 400 }],
    });
    expect(withDrone.tickCount).toBeLessThan(plain.tickCount);
    expect(withDrone.tickCount).toBe(2);
    expect(withDrone.kills.some((k) => k.weapon === 'drone' && k.victimHeroId === 'hawkeye')).toBe(
      true,
    );
    expect(withDrone.kills.find((k) => k.weapon === 'drone')!.killerUnitId).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 13. Arena geometry — range differentiates heroes
// ---------------------------------------------------------------------------

describe('arena geometry', () => {
  it('spawn distances make snipers engage almost immediately while melee / Strategists close ground', () => {
    let spawn: { id: number; x: number; y: number; range: number; role: string; side: 0 | 1 }[] = [];
    simulateBattle(makeCtx(1, MIXED_A, MIXED_B), {
      tieCapTicks: 1,
      place: (us) => {
        spawn = us.map((u) => ({
          id: u.id,
          x: u.x,
          y: u.y,
          range: u.resolved.attackRange,
          role: u.role,
          side: u.side,
        }));
      },
    });
    const sideB = spawn.filter((u) => u.side === 1);
    const minEnemyDist = (u: (typeof spawn)[number]): number =>
      Math.min(...sideB.map((e) => dist(u, e)));

    const bw = spawn.find((u) => u.id === 3)!; // black-widow, sniper (range 32)
    const wolv = spawn.find((u) => u.id === 2)!; // wolverine, melee (range 5)
    const mantis = spawn.find((u) => u.id === 4)!; // mantis, Strategist (range 20)

    expect(minEnemyDist(bw) - bw.range).toBeLessThan(10); // ~1 s of movement into range
    expect(minEnemyDist(wolv) - wolv.range).toBeGreaterThan(20); // seconds of closing
    expect(minEnemyDist(mantis)).toBeGreaterThan(mantis.range); // not in range at spawn
  });

  it('assignFormation keeps a side inside the 6-wide grid footprint and never on the enemy half', () => {
    let a: { x: number; y: number }[] = [];
    let b: { x: number; y: number }[] = [];
    simulateBattle(makeCtx(2, MIXED_A, MIXED_B), {
      tieCapTicks: 1,
      place: (us) => {
        a = us.filter((u) => u.side === 0).map((u) => ({ x: u.x, y: u.y }));
        b = us.filter((u) => u.side === 1).map((u) => ({ x: u.x, y: u.y }));
      },
    });
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(-16);
      expect(p.x).toBeLessThanOrEqual(16);
      expect(p.y).toBeLessThanOrEqual(0); // side A occupies y <= 0
    }
    for (const p of b) expect(p.y).toBeGreaterThan(0); // side B on the far half
    expect(a).toHaveLength(6);
    expect(b).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// 14. PvE placeholder + resolver contract
// ---------------------------------------------------------------------------

describe('resolver contract', () => {
  it('createCombatResolver returns a valid CombatOutcome for pvp / phantom / pve', () => {
    const r = createCombatResolver();
    for (const kind of ['pvp', 'phantom', 'mirror', 'pve'] as const) {
      const out = r.resolve(makeCtx(7, MIXED_A, MIXED_B, kind));
      expect(['win', 'loss', 'tie']).toContain(out.result);
      expect(out.survivingUnits).toBeGreaterThanOrEqual(1);
      expect(out.survivingUnits).toBeLessThanOrEqual(6);
      expect(out.survivorsSideA).toBeGreaterThanOrEqual(0);
      expect(out.survivorsSideB).toBeGreaterThanOrEqual(0);
    }
  });

  it('a PvE battle is deterministic and terminates', () => {
    const first = simulateBattle(makeCtx(9, MIXED_A, [], 'pve'));
    for (let i = 0; i < 5; i++) {
      const r = simulateBattle(makeCtx(9, MIXED_A, [], 'pve'));
      expect(r.digest).toBe(first.digest);
    }
    expect(first.tickCount).toBeLessThanOrEqual(BATTLE_TIE_CAP_TICKS);
  });

  it('assignFormation is idempotent-safe on the same units', () => {
    // (guards against accidental accumulation of position state)
    const trace1 = simulateBattle(makeCtx(1, MIXED_A, MIXED_B));
    const trace2 = simulateBattle(makeCtx(1, MIXED_A, MIXED_B));
    expect(trace1.digest).toBe(trace2.digest);
    expect(typeof assignFormation).toBe('function');
  });
});
