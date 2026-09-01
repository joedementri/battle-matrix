/*
 * M5 — the headless 30 Hz combat simulation core.
 *
 * `simulateBattle(ctx, opts?)` runs one battle to a `BattleTrace`;
 * `createCombatResolver(opts?)` wraps it in the M2 `CombatResolver` contract so
 * `match.ts` can inject the real sim in place of `createStubCombatResolver`
 * WITHOUT any edit to `match.ts` itself (combat has always been injected).
 *
 * DETERMINISM IS THE MILESTONE. Three rules, enforced here:
 *  1. No transcendental math. Only `+ - * /` and `Math.sqrt` (all IEEE-754
 *     exact). Direction is normalised vector math — never `Math.atan2` / angles.
 *     `Math.sin/cos/pow/hypot`, `**` etc. are banned (see tests/purity.spec.ts).
 *  2. Every ordering is a total order. Units iterate in stable id order
 *     (`field.units[i].id === i`); `chooseTargetId` breaks every tie by id;
 *     no `Set`/`Map` is iterated by timing-dependent insertion order.
 *  3. Two different limits, kept apart. `BATTLE_TIE_CAP_TICKS` is a GAME RULE
 *     (Speed Up runs, then the battle is a tie). `BATTLE_MAX_TICKS` is a bug
 *     guard that THROWS and is strictly larger, so it is unreachable in play.
 *
 * THE TICK — 30 Hz integer, this exact order, units in stable id order:
 *   effects -> target acquisition -> movement -> attacks -> abilities/ults ->
 *   damage & healing -> death checks
 * `dt` is `TICK_DT_SECONDS` from constants.ts. No wall clock anywhere.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import {
  BOARD,
  CRITICAL_DAMAGE_SHELL,
  DOUBLE_HEAL_RETRIGGER_CHANCE,
  INITIAL_ROUND_WINDOW_SECONDS,
  RAMPAGE_ATTACK_SPEED_AND_LIFESTEAL_PCT,
  SPEED_UP_DAMAGE_MULTIPLIER,
  TARGET_REACQUIRE_GRACE_SECONDS,
  TICK_DT_SECONDS,
  TICK_RATE_HZ,
} from '../data/constants';
import {
  ARENA_CELL_SIZE,
  ARENA_TEAM_SEPARATION,
  BATTLE_MAX_TICKS,
  BATTLE_TIE_CAP_TICKS,
  DRONE_MOVE_SPEED,
  DRONE_ONE_TIME_DAMAGE,
  DRONE_ONE_TIME_HEALING,
  DRONE_POLICY_LOW_HP_FRACTION,
  ENCEPHALO_RAY_DPS,
  RAMPAGE_DURATION_TICKS,
  SPEED_UP_TRIGGER_TICKS,
  ULT_ENERGY_PER_DAMAGE_DEALT,
  ULT_ENERGY_PER_DAMAGE_TAKEN,
  ULT_ENERGY_PER_HEALING_DONE,
} from '../data/authored';
import heroesJson from '../data/heroes.json';
import type { Role, Targeting, UltArchetype } from '../data/types';

import { castUlt } from './abilities';
import {
  beamHeldAt,
  decodeDroneMove,
} from './drone';
import type { DroneColour, DroneSpec } from './drone';
import { placeholderDronePolicy } from './dronePolicy';
import type { DroneCommand } from './dronePolicy';
import { galactaWave, resolvedFromGalacta } from './galacta';
import {
  applyVulnStack,
  backupRebirthFraction,
  cumulativeDualMultiplier,
  hasEffect,
  infiniteDriveKeepChance,
  lastStandMultiplier,
  maybeTriggerCriticalCounter,
  maybeTriggerCriticalDamageShell,
  steadyRecoveryHealPerTick,
} from './effects';
import type { Substream } from './rng';
import { emptySide, resolveUnits } from './stats';
import type { ResolvedUnit, SideModules } from './stats';
import type { BattleResult, CombatContext, CombatOutcome, CombatResolver } from './types';

// ---------------------------------------------------------------------------
// Derived tick constants (from the locked 30 Hz decision — no re-typed numbers)
// ---------------------------------------------------------------------------

const INITIAL_WINDOW_TICKS = INITIAL_ROUND_WINDOW_SECONDS * TICK_RATE_HZ;

/** Re-acquire only after the target has been out of range for MORE than 0.5 s. */
export const TARGET_REACQUIRE_GRACE_TICKS = Math.round(
  TARGET_REACQUIRE_GRACE_SECONDS * TICK_RATE_HZ,
);

/** Pooled per-tick event buffer capacity. 12 units cannot queue anywhere near this. */
const EVENT_CAP = 256;

const GRID_COLS = BOARD.cols;
const GRID_ROWS = BOARD.rows;
/** 6-column deploy grid, centre-out fill order (nearest the centre line first). */
const CENTRE_OUT_COLS: readonly number[] = [2, 3, 1, 4, 0, 5];

/**
 * The arena box the M6 Ultron Drone is clamped to — the exact footprint the
 * formation uses: `GRID_COLS` cells wide, side A's back row at `minY`, side B's
 * back row at `maxY`. "May cross the whole arena" = anywhere in this box.
 */
export const ARENA_BOUNDS = {
  minX: -(GRID_COLS * ARENA_CELL_SIZE) / 2,
  maxX: (GRID_COLS * ARENA_CELL_SIZE) / 2,
  minY: -((GRID_ROWS - 1) * ARENA_CELL_SIZE),
  maxY: ARENA_TEAM_SEPARATION + (GRID_ROWS - 1) * ARENA_CELL_SIZE,
} as const;

// ---------------------------------------------------------------------------
// Public event / trace shapes (the kill feed contract for M9)
// ---------------------------------------------------------------------------

/**
 * Damage-source union — designed now so the M9 kill feed can render
 * `KILLER ⟶ weapon ⟶ VICTIM` for every source:
 *   primary  — primary fire        ability — a named ability (incl. Strategist heal-fire)
 *   ultimate — an ultimate         module  — a Base Module effect (Deadly Healing, ...)
 *   drone    — the Ultron Drone (M6; combat never generates this itself)
 */
export type DamageSource = 'primary' | 'ability' | 'ultimate' | 'module' | 'drone';

export interface KillEvent {
  readonly tick: number;
  /** Unit id of the killer, or -1 for a sourceless kill (e.g. the drone). */
  readonly killerUnitId: number;
  readonly killerHeroId: string | null;
  readonly weapon: DamageSource;
  readonly victimUnitId: number;
  readonly victimHeroId: string;
}

export interface ReviveEvent {
  readonly tick: number;
  readonly unitId: number;
  readonly heroId: string;
  readonly healthRestored: number;
}

export interface DamageLogEntry {
  readonly tick: number;
  readonly srcUnitId: number;
  readonly tgtUnitId: number;
  readonly amount: number;
  readonly source: DamageSource;
  readonly convertedToHeal: boolean;
}

/** A plain end-of-battle snapshot of one unit (for M9's HUD and for tests). */
export interface UnitSnapshot {
  readonly id: number;
  readonly side: 0 | 1;
  readonly heroId: string;
  /** True for a Galacta Bot — M9 draws it as a monster, not a hero token. */
  readonly isGalactaBot: boolean;
  readonly alive: boolean;
  readonly health: number;
  readonly overhealth: number;
  readonly maxHealth: number;
  readonly ultCasts: number;
  readonly x: number;
  readonly y: number;
}

/** End-of-battle snapshot of one Ultron Drone (for M9's HUD and for tests). */
export interface DroneSnapshot {
  readonly side: 0 | 1;
  readonly playerId: number;
  readonly colour: DroneColour;
  /** = the owning player's 50-based health, unchanged for the whole battle. */
  readonly health: number;
  readonly x: number;
  readonly y: number;
  /** `LSHIFT` spent this Battle Phase (greys out in the HUD; resets next round). */
  readonly oneTimeDamageUsed: boolean;
  /** `E` spent this Battle Phase. */
  readonly oneTimeHealUsed: boolean;
}

/**
 * M5 seam: a deterministic raw external-actor input stream. Kept for direct
 * tests; the M6 `drones` option (a full N-drone model with recorded / policy
 * input) is the real path. `simulateBattle` applies matching events at each
 * tick's damage & healing phase; combat NEVER reaches for input itself.
 */
export interface ExternalActorEvent {
  readonly tick: number;
  readonly kind: 'damageEnemiesOf' | 'healAlliesOf';
  /** The acting drone's own side (0 = side A, 1 = side B). */
  readonly side: 0 | 1;
  readonly amount: number;
}

export interface BattleTrace {
  readonly outcome: CombatOutcome;
  readonly tickCount: number;
  readonly endReason: 'elimination' | 'tieCap';
  /** 32-hex rolling digest of the whole tick-by-tick log. Equal iff the battle replays identically. */
  readonly digest: string;
  readonly kills: readonly KillEvent[];
  readonly revives: readonly ReviveEvent[];
  readonly speedUpStartedAtTick: number | null;
  readonly finalUnits: readonly UnitSnapshot[];
  readonly finalDrones: readonly DroneSnapshot[];
  /** Non-null only when `opts.trace` was set. */
  readonly damageLog: readonly DamageLogEntry[] | null;
}

export interface SimulateOptions {
  /** Bug-guard ceiling; the sim THROWS here. Default `BATTLE_MAX_TICKS`. */
  readonly maxTicks?: number;
  /** Game-rule ceiling; the battle ends as a tie here. Default `BATTLE_TIE_CAP_TICKS`. */
  readonly tieCapTicks?: number;
  /** When Speed Up flips its battle-level flag. Default `SPEED_UP_TRIGGER_TICKS`. */
  readonly speedUpTriggerTicks?: number;
  readonly sideAModules?: SideModules;
  readonly sideBModules?: SideModules;
  readonly externalActors?: readonly ExternalActorEvent[];
  /**
   * The Ultron Drones in this battle (M6). N drones, each with a `side` and an
   * input source that is either a recorded quantized stream or the placeholder
   * policy. Overrides `ctx.drones` when set; the resolver path uses `ctx.drones`.
   */
  readonly drones?: readonly DroneSpec[];
  /** Test/debug seam: reposition units after formation, before tick 1. Unused by `createCombatResolver`. */
  readonly place?: (units: BattleUnit[]) => void;
  /**
   * Test/debug seam (also an M9 render hook): called at the end of every tick,
   * after the digest has folded. Combat never calls this itself; read-only in
   * spirit — mutating here diverges the live state from the digest.
   */
  readonly onTick?: (field: BattleField) => void;
  /** Test/debug seam: collect a per-damage-event log (allocates). Off by default. */
  readonly trace?: boolean;
}

// ---------------------------------------------------------------------------
// Battle unit + field
// ---------------------------------------------------------------------------

export interface BattleUnit {
  /** Dense index into `field.units` (`field.units[id] === this`); side A first, then side B. */
  readonly id: number;
  readonly side: 0 | 1;
  /** Lineup index 0..5. */
  readonly slot: number;
  /** Hero id, or — for a Galacta Bot — its archetype id (e.g. `galacta-swarm`). */
  readonly heroId: string;
  /** True for a Galacta Bot: a team-agnostic PvE `Unit` (no protocols, no modules). */
  readonly isGalactaBot: boolean;
  readonly role: Role;
  readonly targeting: Targeting;
  readonly resolved: ResolvedUnit;
  readonly ultArchetype: UltArchetype;
  /** `resolved.dps / resolved.attackSpeed`. */
  readonly perHitBase: number;
  /** `resolved.healPerSecond` (0 for units that do not sustain-heal). */
  readonly perHealBase: number;

  x: number;
  y: number;

  /** Regular pool, always `<= maxHealth`. */
  health: number;
  /** Bonus-health pool on top of `health` (Reserve Armor, Overflow Recharge). Depleted first by damage. */
  overhealth: number;
  readonly maxHealth: number;
  /** `maxHealth + starting bonus health` — the reference for "health lost". */
  readonly startTotalHealth: number;
  alive: boolean;

  targetId: number;
  outOfRangeTicks: number;

  attackCooldownTicks: number;

  ultEnergy: number;
  ultCasts: number;

  lastDamagedBy: number;
  lastDamageSource: DamageSource;

  criticalDamageShellUsed: boolean;
  criticalDamageShellTicks: number;
  criticalCounterUsed: boolean;
  criticalCounterTicks: number;
  backupRebirthUsed: boolean;
  rampageTicks: number;
  beamTicks: number;
  beamBonusPct: number;
  selfBuffTicks: number;
  selfBuffDamagePct: number;
  selfBuffAttackSpeedPct: number;
  ultShieldTicks: number;
  ultShieldReductionPct: number;
  vulnStacks: number;
  vulnPerStackPct: number;
  vulnTicks: number;
}

/**
 * A live Ultron Drone inside a battle. NOT a `BattleUnit` and never in
 * `field.units`, so nothing can target or damage it. `health` is a frozen copy
 * of the owning player's 50-based health and never changes here.
 */
export interface DroneRuntime {
  readonly side: 0 | 1;
  readonly playerId: number;
  readonly colour: DroneColour;
  readonly health: number;
  readonly input: DroneSpec['input'];
  x: number;
  y: number;
  oneTimeDamageUsed: boolean;
  oneTimeHealUsed: boolean;
  beamHeldThisTick: boolean;
}

export interface BattleField {
  tick: number;
  speedUpActive: boolean;
  speedUpStartedAtTick: number | null;
  readonly units: BattleUnit[];
  /** The Ultron Drones over this battle (0..N). Not units — cannot be targeted or hurt. */
  readonly drones: DroneRuntime[];
  /** Unique role count (1..3) of each side's battle-start lineup — for Equilibrium behavioural scaling. */
  readonly sideUniqueRoles: readonly [number, number];
  readonly rng: Substream;
  readonly kills: KillEvent[];
  readonly revives: ReviveEvent[];
  readonly damageLog: DamageLogEntry[] | null;
  readonly hash: RollingHash;
  readonly queue: EventQueue;
}

interface RunOpts {
  readonly maxTicks: number;
  readonly tieCapTicks: number;
  readonly speedUpTriggerTicks: number;
  readonly externalActors: readonly ExternalActorEvent[] | undefined;
}

// ---------------------------------------------------------------------------
// Rolling hash — integer-only avalanche, no strings, no allocation per tick
// ---------------------------------------------------------------------------

class RollingHash {
  private a = 0x811c9dc5 | 0;
  private b = 0x1000193 | 0;
  private c = 0xdeadbeef | 0;
  private d = 0x41c64e6d | 0;

  mix(value: number): void {
    let x = value | 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = x ^ (x >>> 16);
    this.a = Math.imul(this.a ^ x, 0x9e3779b1);
    this.b = (Math.imul(this.b + x, 0x85ebca77) ^ (this.a >>> 13)) | 0;
    this.c = (Math.imul(this.c ^ x, 0xc2b2ae3d) + this.b) | 0;
    this.d = Math.imul(this.d ^ (x + this.c), 0x27d4eb2f);
    this.a = ((this.a << 7) | (this.a >>> 25)) | 0;
  }

  hex(): string {
    const lane = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
    return lane(this.a) + lane(this.b) + lane(this.c) + lane(this.d);
  }
}

// ---------------------------------------------------------------------------
// Pooled per-tick event buffer (allocation-free after construction)
// ---------------------------------------------------------------------------

const SRC_CODE: Readonly<Record<DamageSource, number>> = {
  primary: 1,
  ability: 2,
  ultimate: 3,
  module: 4,
  drone: 5,
};
const SRC_BY_CODE: readonly DamageSource[] = [
  'primary',
  'primary',
  'ability',
  'ultimate',
  'module',
  'drone',
];

class EventQueue {
  readonly dSrc = new Int32Array(EVENT_CAP);
  readonly dTgt = new Int32Array(EVENT_CAP);
  readonly dAmt = new Float64Array(EVENT_CAP);
  readonly dSrcCode = new Uint8Array(EVENT_CAP);
  dN = 0;

  readonly hSrc = new Int32Array(EVENT_CAP);
  readonly hTgt = new Int32Array(EVENT_CAP);
  readonly hAmt = new Float64Array(EVENT_CAP);
  hN = 0;

  reset(): void {
    this.dN = 0;
    this.hN = 0;
  }

  damage(src: number, tgt: number, amount: number, source: DamageSource): void {
    if (this.dN >= EVENT_CAP) throw new Error('combat: damage event buffer overflow — bug');
    this.dSrc[this.dN] = src;
    this.dTgt[this.dN] = tgt;
    this.dAmt[this.dN] = amount;
    this.dSrcCode[this.dN] = SRC_CODE[source];
    this.dN++;
  }

  heal(src: number, tgt: number, amount: number): void {
    if (this.hN >= EVENT_CAP) throw new Error('combat: heal event buffer overflow — bug');
    this.hSrc[this.hN] = src;
    this.hTgt[this.hN] = tgt;
    this.hAmt[this.hN] = amount;
    this.hN++;
  }
}

// ---------------------------------------------------------------------------
// Targeting — pure, total-ordered, id-tiebroken (the plan's targeting matrix)
// ---------------------------------------------------------------------------

export interface TargetCandidate {
  readonly id: number;
  readonly side: 0 | 1;
  readonly x: number;
  readonly y: number;
  /** RESOLVED max health — L/H target on this, not current health, so a target never flips as it is damaged. */
  readonly maxHealth: number;
  readonly alive: boolean;
}

export interface TargetingSelf {
  readonly id: number;
  readonly side: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly targeting: Targeting;
}

/**
 * Pick an enemy id by the canonical priority. `nearest` -> least distance;
 * `lowestMaxHealth` / `highestMaxHealth` -> extreme resolved max health, then
 * nearer, then lower id. Returns -1 when no living enemy exists.
 */
export function chooseTargetId(self: TargetingSelf, units: readonly TargetCandidate[]): number {
  let bestId = -1;
  let bestDistSq = 0;
  let bestMax = 0;
  for (const e of units) {
    if (e.side === self.side || !e.alive) continue;
    const dx = e.x - self.x;
    const dy = e.y - self.y;
    const distSq = dx * dx + dy * dy;
    if (bestId === -1) {
      bestId = e.id;
      bestDistSq = distSq;
      bestMax = e.maxHealth;
      continue;
    }
    let better: boolean;
    if (self.targeting === 'nearest') {
      better = distSq < bestDistSq || (distSq === bestDistSq && e.id < bestId);
    } else if (self.targeting === 'lowestMaxHealth') {
      better =
        e.maxHealth < bestMax ||
        (e.maxHealth === bestMax && distSq < bestDistSq) ||
        (e.maxHealth === bestMax && distSq === bestDistSq && e.id < bestId);
    } else {
      better =
        e.maxHealth > bestMax ||
        (e.maxHealth === bestMax && distSq < bestDistSq) ||
        (e.maxHealth === bestMax && distSq === bestDistSq && e.id < bestId);
    }
    if (better) {
      bestId = e.id;
      bestDistSq = distSq;
      bestMax = e.maxHealth;
    }
  }
  return bestId;
}

/**
 * The per-unit out-of-range re-acquire rule. Returns true when the target has
 * been out of range for MORE than the grace window (a timer, not a per-tick
 * distance check — see the plan's tick section).
 */
export function updateOutOfRangeTimer(
  u: Pick<BattleUnit, 'outOfRangeTicks'>,
  targetInRange: boolean,
): boolean {
  if (targetInRange) {
    u.outOfRangeTicks = 0;
    return false;
  }
  u.outOfRangeTicks++;
  return u.outOfRangeTicks > TARGET_REACQUIRE_GRACE_TICKS;
}

// ---------------------------------------------------------------------------
// Formation — a deterministic default deployment (M6/M8 let the player place)
// ---------------------------------------------------------------------------

/** Preferred grid row (front = GRID_ROWS-1). Vanguards front, then melee Duelists, ranged Duelists, Strategists. */
function preferredRow(u: BattleUnit): number {
  if (u.role === 'vanguard') return GRID_ROWS - 1;
  if (u.role === 'strategist') return 0;
  return u.resolved.attackRange <= 8 ? GRID_ROWS - 2 : GRID_ROWS - 3;
}

function placeCell(u: BattleUnit, col: number, row: number): void {
  u.x = (col - (GRID_COLS - 1) / 2) * ARENA_CELL_SIZE;
  const depthFromFront = (GRID_ROWS - 1 - row) * ARENA_CELL_SIZE;
  u.y = u.side === 0 ? -depthFromFront : ARENA_TEAM_SEPARATION + depthFromFront;
}

export function assignFormation(units: BattleUnit[]): void {
  for (const side of [0, 1] as const) {
    const group = units
      .filter((u) => u.side === side)
      .sort((p, q) => preferredRow(q) - preferredRow(p) || p.id - q.id);
    const nextCol: number[] = new Array<number>(GRID_ROWS).fill(0);
    for (const u of group) {
      let row = preferredRow(u);
      while (row >= 0 && (nextCol[row] ?? 0) >= CENTRE_OUT_COLS.length) row--;
      if (row < 0) {
        row = preferredRow(u);
        nextCol[row] = 0;
      }
      const idx = nextCol[row] ?? 0;
      nextCol[row] = idx + 1;
      placeCell(u, CENTRE_OUT_COLS[idx] ?? 0, row);
    }
  }
}

// ---------------------------------------------------------------------------
// Field construction
// ---------------------------------------------------------------------------

const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];

function uniqueRoleCount(units: readonly { readonly role: Role }[]): number {
  let n = 0;
  for (const r of ROLES) if (units.some((u) => u.role === r)) n++;
  return n;
}

interface HeroMeta {
  readonly role: Role;
  readonly targeting: Targeting;
  readonly ultArchetype: UltArchetype;
}

const HERO_META: ReadonlyMap<string, HeroMeta> = new Map(
  (
    heroesJson as unknown as readonly {
      id: string;
      role: Role;
      targeting: Targeting;
      ult: { archetype: UltArchetype };
    }[]
  ).map((h) => [h.id, { role: h.role, targeting: h.targeting, ultArchetype: h.ult.archetype }]),
);

function heroMeta(id: string): HeroMeta {
  const m = HERO_META.get(id);
  if (m === undefined) throw new RangeError(`combat: unknown hero id "${id}"`);
  return m;
}

function makeUnit(
  id: number,
  side: 0 | 1,
  slot: number,
  heroId: string,
  meta: HeroMeta,
  resolved: ResolvedUnit,
  isGalactaBot: boolean,
): BattleUnit {
  const maxHealth = resolved.maxHealth;
  const startBonus = resolved.bonusHealth;
  return {
    id,
    side,
    slot,
    heroId,
    isGalactaBot,
    role: meta.role,
    targeting: meta.targeting,
    resolved,
    ultArchetype: meta.ultArchetype,
    perHitBase: resolved.dps / resolved.attackSpeed,
    perHealBase: resolved.healPerSecond,
    x: 0,
    y: 0,
    health: maxHealth,
    overhealth: startBonus,
    maxHealth,
    startTotalHealth: maxHealth + startBonus,
    alive: true,
    targetId: -1,
    outOfRangeTicks: 0,
    attackCooldownTicks: 0,
    ultEnergy: resolved.ultEnergyAtRoundStartPct / 100,
    ultCasts: 0,
    lastDamagedBy: -1,
    lastDamageSource: 'primary',
    criticalDamageShellUsed: false,
    criticalDamageShellTicks: 0,
    criticalCounterUsed: false,
    criticalCounterTicks: 0,
    backupRebirthUsed: false,
    rampageTicks: 0,
    beamTicks: 0,
    beamBonusPct: 0,
    selfBuffTicks: 0,
    selfBuffDamagePct: 0,
    selfBuffAttackSpeedPct: 0,
    ultShieldTicks: 0,
    ultShieldReductionPct: 0,
    vulnStacks: 0,
    vulnPerStackPct: 0,
    vulnTicks: 0,
  };
}

function buildDroneRuntimes(specs: readonly DroneSpec[]): DroneRuntime[] {
  return specs.map((s) => ({
    side: s.side,
    playerId: s.playerId,
    colour: s.colour,
    health: s.health,
    input: s.input,
    x: 0,
    y: s.side === 0 ? ARENA_BOUNDS.minY : ARENA_BOUNDS.maxY,
    oneTimeDamageUsed: false,
    oneTimeHealUsed: false,
    beamHeldThisTick: false,
  }));
}

function buildField(ctx: CombatContext, opts: SimulateOptions): BattleField {
  const lineupA = ctx.sideA.lineup;
  const isPve = ctx.sideB.isGalactaBots;
  const lineupB = ctx.sideB.lineup;

  if (lineupA.length === 0) throw new RangeError('combat: side A needs at least one hero');
  if (!isPve && lineupB.length === 0) throw new RangeError('combat: side B needs at least one hero');

  const modA = opts.sideAModules ?? emptySide();
  const units: BattleUnit[] = [];

  if (isPve) {
    // Galacta Bots (M6): team-agnostic Units built straight from the wave spec.
    const resolvedA = resolveUnits(lineupA, modA, [], emptySide());
    lineupA.forEach((heroId, slot) => {
      units.push(makeUnit(units.length, 0, slot, heroId, heroMeta(heroId), resolvedA[slot]!, false));
    });
    const wave = galactaWave(ctx.round);
    if (wave.length === 0) throw new RangeError(`combat: galactaWave(${ctx.round}) produced no units`);
    wave.forEach((spec, slot) => {
      const meta: HeroMeta = {
        role: spec.role,
        targeting: spec.targeting,
        ultArchetype: spec.ultArchetype,
      };
      units.push(makeUnit(units.length, 1, slot, spec.kind, meta, resolvedFromGalacta(spec), true));
    });
  } else {
    const modB = opts.sideBModules ?? emptySide();
    const resolvedA = resolveUnits(lineupA, modA, lineupB, modB);
    const resolvedB = resolveUnits(lineupB, modB, lineupA, modA);
    lineupA.forEach((heroId, slot) => {
      units.push(makeUnit(units.length, 0, slot, heroId, heroMeta(heroId), resolvedA[slot]!, false));
    });
    lineupB.forEach((heroId, slot) => {
      units.push(makeUnit(units.length, 1, slot, heroId, heroMeta(heroId), resolvedB[slot]!, false));
    });
  }

  assignFormation(units);
  if (opts.place !== undefined) opts.place(units);

  return {
    tick: 0,
    speedUpActive: false,
    speedUpStartedAtTick: null,
    units,
    drones: buildDroneRuntimes(opts.drones ?? ctx.drones ?? []),
    sideUniqueRoles: [
      uniqueRoleCount(units.filter((u) => u.side === 0)),
      uniqueRoleCount(units.filter((u) => u.side === 1)),
    ],
    rng: ctx.rng,
    kills: [],
    revives: [],
    damageLog: opts.trace === true ? [] : null,
    hash: new RollingHash(),
    queue: new EventQueue(),
  };
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

function currentAttackIntervalTicks(u: BattleUnit): number {
  let attackSpeed = u.resolved.attackSpeed;
  if (u.rampageTicks > 0) attackSpeed *= 1 + RAMPAGE_ATTACK_SPEED_AND_LIFESTEAL_PCT / 100;
  if (u.selfBuffTicks > 0) attackSpeed *= 1 + u.selfBuffAttackSpeedPct / 100;
  return Math.max(1, Math.round(TICK_RATE_HZ / attackSpeed));
}

function tickUnitEffects(field: BattleField, u: BattleUnit): void {
  if (u.rampageTicks > 0) u.rampageTicks--;
  if (u.beamTicks > 0) {
    u.beamTicks--;
    if (u.beamTicks === 0) u.beamBonusPct = 0;
  }
  if (u.selfBuffTicks > 0) {
    u.selfBuffTicks--;
    if (u.selfBuffTicks === 0) {
      u.selfBuffDamagePct = 0;
      u.selfBuffAttackSpeedPct = 0;
    }
  }
  if (u.ultShieldTicks > 0) {
    u.ultShieldTicks--;
    if (u.ultShieldTicks === 0) u.ultShieldReductionPct = 0;
  }
  if (u.criticalDamageShellTicks > 0) u.criticalDamageShellTicks--;
  if (u.criticalCounterTicks > 0) u.criticalCounterTicks--;
  if (u.vulnTicks > 0) {
    u.vulnTicks--;
    if (u.vulnTicks === 0) {
      u.vulnStacks = 0;
      u.vulnPerStackPct = 0;
    }
  }

  const regen = steadyRecoveryHealPerTick(u);
  if (regen > 0) field.queue.heal(u.id, u.id, regen);
}

function acquireTarget(field: BattleField, u: BattleUnit): void {
  const cur = u.targetId >= 0 ? field.units[u.targetId] : undefined;
  if (cur === undefined || !cur.alive) {
    u.targetId = chooseTargetId(u, field.units);
    u.outOfRangeTicks = 0;
    return;
  }
  const dx = cur.x - u.x;
  const dy = cur.y - u.y;
  const range = u.resolved.attackRange;
  const inRange = dx * dx + dy * dy <= range * range;
  if (updateOutOfRangeTimer(u, inRange)) {
    u.targetId = chooseTargetId(u, field.units);
    u.outOfRangeTicks = 0;
  }
}

function moveUnit(field: BattleField, u: BattleUnit): void {
  if (u.targetId < 0) return;
  const tgt = field.units[u.targetId];
  if (tgt === undefined || !tgt.alive) return;
  const dx = tgt.x - u.x;
  const dy = tgt.y - u.y;
  const distSq = dx * dx + dy * dy;
  const range = u.resolved.attackRange;
  if (distSq <= range * range) return;
  const dist = Math.sqrt(distSq);
  if (dist <= 1e-9) return;
  const step = Math.min(u.resolved.moveSpeed * TICK_DT_SECONDS, dist - range);
  u.x += (dx / dist) * step;
  u.y += (dy / dist) * step;
}

function inAttackRange(u: BattleUnit, tgt: BattleUnit): boolean {
  const dx = tgt.x - u.x;
  const dy = tgt.y - u.y;
  const range = u.resolved.attackRange;
  return dx * dx + dy * dy <= range * range;
}

function doPrimaryAttack(field: BattleField, u: BattleUnit): void {
  if (u.attackCooldownTicks > 0) u.attackCooldownTicks--;
  if (u.attackCooldownTicks > 0) return;
  if (u.targetId < 0) return;
  const tgt = field.units[u.targetId];
  if (tgt === undefined || !tgt.alive || !inAttackRange(u, tgt)) return;
  field.queue.damage(u.id, u.targetId, u.perHitBase, 'primary');
  u.attackCooldownTicks = currentAttackIntervalTicks(u);
}

function healingAmplifier(field: BattleField, u: BattleUnit): number {
  let m = 1;
  if (field.tick <= INITIAL_WINDOW_TICKS) m *= 1 + u.resolved.roundStartHealingPct / 100;
  m *= cumulativeDualMultiplier(field, u);
  return m;
}

function doSustainedHeal(field: BattleField, u: BattleUnit): void {
  if (u.perHealBase <= 0) return;
  let tgt: BattleUnit | undefined;
  let bestRatio = Number.POSITIVE_INFINITY;
  for (const a of field.units) {
    if (a.side !== u.side || !a.alive) continue;
    const ratio = a.health / a.maxHealth;
    if (ratio < bestRatio || (ratio === bestRatio && (tgt === undefined || a.id < tgt.id))) {
      bestRatio = ratio;
      tgt = a;
    }
  }
  if (tgt === undefined) return;

  const amount = u.perHealBase * TICK_DT_SECONDS * healingAmplifier(field, u);
  emitHeal(field, u, tgt.id, amount);
  if (hasEffect(u, 'reboot-double-heal') && field.rng.next() < DOUBLE_HEAL_RETRIGGER_CHANCE) {
    emitHeal(field, u, tgt.id, amount);
  }
}

/** Queue a heal, plus its Deadly Healing damage to the Strategist's current enemy. */
function emitHeal(field: BattleField, healer: BattleUnit, tgtId: number, amount: number): void {
  field.queue.heal(healer.id, tgtId, amount);
  const dh = healer.resolved.healingAsDamagePct;
  if (dh > 0 && healer.targetId >= 0) {
    const enemy = field.units[healer.targetId];
    if (enemy !== undefined && enemy.alive) {
      field.queue.damage(healer.id, enemy.id, amount * (dh / 100), 'module');
    }
  }
}

function maybeCastUlt(field: BattleField, u: BattleUnit): void {
  if (u.ultEnergy < 1) return;
  const keepChance = infiniteDriveKeepChance(u);
  if (keepChance > 0 && field.rng.next() < keepChance) {
    u.ultEnergy = 1; // Infinite Drive — no consume; clamp the overflow away
  } else {
    u.ultEnergy -= 1; // carry any overflow toward the next cast
  }
  u.ultCasts++;
  castUlt(field, u);
}

function applyExternalActors(
  field: BattleField,
  events: readonly ExternalActorEvent[] | undefined,
  tick: number,
): void {
  if (events === undefined) return;
  for (const e of events) {
    if (e.tick !== tick) continue;
    for (const target of field.units) {
      if (!target.alive) continue;
      if (e.kind === 'damageEnemiesOf' && target.side !== e.side) {
        field.queue.damage(-1, target.id, e.amount, 'drone');
      } else if (e.kind === 'healAlliesOf' && target.side === e.side) {
        field.queue.heal(-1, target.id, e.amount);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ultron Drones (M6) — input enters the sim here, never generated by combat
// ---------------------------------------------------------------------------

function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Nearest living enemy unit id to a point, id-tiebroken. -1 if none. */
function nearestEnemyUnitToPoint(field: BattleField, side: 0 | 1, x: number, y: number): number {
  let bestId = -1;
  let bestDistSq = 0;
  for (const u of field.units) {
    if (!u.alive || u.side === side) continue;
    const dx = u.x - x;
    const dy = u.y - y;
    const distSq = dx * dx + dy * dy;
    if (bestId === -1 || distSq < bestDistSq || (distSq === bestDistSq && u.id < bestId)) {
      bestId = u.id;
      bestDistSq = distSq;
    }
  }
  return bestId;
}

/** Living units on `side` whose regular health is below `frac` of max. */
function countUnitsBelowFraction(field: BattleField, side: 0 | 1, frac: number): number {
  let n = 0;
  for (const u of field.units) {
    if (u.alive && u.side === side && u.health < frac * u.maxHealth) n++;
  }
  return n;
}

/** One tick of control for a drone: recorded stream if present, else the M7-placeholder policy. */
function droneCommand(field: BattleField, d: DroneRuntime, tick: number): DroneCommand {
  if (d.input !== null) {
    return {
      move: decodeDroneMove(d.input, tick),
      beam: beamHeldAt(d.input, tick),
      pressOneTimeDamage: d.input.oneTimeDamageTick === tick,
      pressOneTimeHeal: d.input.oneTimeHealTick === tick,
    };
  }
  const enemySide: 0 | 1 = d.side === 0 ? 1 : 0;
  return placeholderDronePolicy({
    enemiesBelowLowHp: countUnitsBelowFraction(field, enemySide, DRONE_POLICY_LOW_HP_FRACTION),
    alliesBelowLowHp: countUnitsBelowFraction(field, d.side, DRONE_POLICY_LOW_HP_FRACTION),
    oneTimeDamageUsed: d.oneTimeDamageUsed,
    oneTimeHealUsed: d.oneTimeHealUsed,
  });
}

/**
 * Move each drone, hold/release the Encephalo-Ray, and fire the two one-time
 * abilities — queueing every effect into the same batch the units use. Drones
 * are never in `field.units`, so this is the ONLY place they act. Kill events
 * from a drone carry `killerUnitId = -1` (the existing `-1` source path).
 */
function tickDrones(field: BattleField, tick: number): void {
  if (field.drones.length === 0) return;
  for (const d of field.drones) {
    const cmd = droneCommand(field, d, tick);

    if (cmd.move !== null) {
      d.x = clampRange(
        d.x + cmd.move.x * DRONE_MOVE_SPEED * TICK_DT_SECONDS,
        ARENA_BOUNDS.minX,
        ARENA_BOUNDS.maxX,
      );
      d.y = clampRange(
        d.y + cmd.move.y * DRONE_MOVE_SPEED * TICK_DT_SECONDS,
        ARENA_BOUNDS.minY,
        ARENA_BOUNDS.maxY,
      );
    }

    d.beamHeldThisTick = cmd.beam;
    if (cmd.beam) {
      const tgt = nearestEnemyUnitToPoint(field, d.side, d.x, d.y);
      if (tgt >= 0) field.queue.damage(-1, tgt, ENCEPHALO_RAY_DPS * TICK_DT_SECONDS, 'drone');
    }

    if (cmd.pressOneTimeDamage && !d.oneTimeDamageUsed) {
      d.oneTimeDamageUsed = true;
      for (const u of field.units) {
        if (u.alive && u.side !== d.side) field.queue.damage(-1, u.id, DRONE_ONE_TIME_DAMAGE, 'drone');
      }
    }
    if (cmd.pressOneTimeHeal && !d.oneTimeHealUsed) {
      d.oneTimeHealUsed = true;
      for (const u of field.units) {
        if (u.alive && u.side === d.side) field.queue.heal(-1, u.id, DRONE_ONE_TIME_HEALING);
      }
    }
  }
}

function dealHealthLoss(u: BattleUnit, amount: number): void {
  if (amount <= 0) return;
  let remaining = amount;
  if (u.overhealth > 0) {
    const fromOver = Math.min(u.overhealth, remaining);
    u.overhealth -= fromOver;
    remaining -= fromOver;
  }
  if (remaining > 0) u.health -= remaining;
}

function applyOneDamage(
  field: BattleField,
  srcId: number,
  tgtId: number,
  base: number,
  source: DamageSource,
): void {
  const tgt = field.units[tgtId];
  if (tgt === undefined || !tgt.alive) return;
  const src = srcId >= 0 ? field.units[srcId] : undefined;

  let amt = base;

  // Attacker-side amplifiers — each its own multiplicative factor.
  if (src !== undefined) {
    amt *= lastStandMultiplier(src);
    if (src.beamTicks > 0) amt *= 1 + src.beamBonusPct / 100;
    if (src.selfBuffTicks > 0 && source === 'primary') amt *= 1 + src.selfBuffDamagePct / 100;
    amt *= cumulativeDualMultiplier(field, src);
    if (field.tick <= INITIAL_WINDOW_TICKS) amt *= 1 + src.resolved.roundStartDamagePct / 100;
  }

  // Battle-level Speed Up — "+120% damage to all HEROES", a flag applied ONCE,
  // never re-applied per tick. The Ultron Drone is not a hero, so its
  // Encephalo-Ray / one-time abilities are exempt (keeps the beam-budget
  // assertion clean regardless of when the drone fires).
  if (field.speedUpActive && source !== 'drone') amt *= SPEED_UP_DAMAGE_MULTIPLIER;

  // Target-side amplifier: Vulnerability Mark stacks.
  if (tgt.vulnStacks > 0) amt *= 1 + (tgt.vulnStacks * tgt.vulnPerStackPct) / 100;

  // Target-side reductions — MULTIPLICATIVE, never summed:
  //   `damageTakenMultiplier` already folds Defensive Shell + protocol Defensive
  //   Shell (a product of (1 - r) from stats.ts); Critical Damage Shell and the
  //   ult damage-reduction shield are further separate factors.
  amt *= tgt.resolved.damageTakenMultiplier;
  if (tgt.criticalDamageShellTicks > 0) amt *= 1 - CRITICAL_DAMAGE_SHELL.reductionPct / 100;
  if (tgt.ultShieldTicks > 0) amt *= 1 - tgt.ultShieldReductionPct / 100;
  if (amt < 0) amt = 0;

  // Critical Counter — while active, incoming damage becomes healing instead.
  if (tgt.criticalCounterTicks > 0) {
    field.queue.heal(tgt.id, tgt.id, amt);
    if (src !== undefined) {
      src.ultEnergy += amt * ULT_ENERGY_PER_DAMAGE_DEALT * src.resolved.ultChargeRate;
    }
    logDamage(field, srcId, tgt.id, amt, source, true);
    return;
  }

  dealHealthLoss(tgt, amt);
  tgt.lastDamagedBy = srcId;
  tgt.lastDamageSource = source;

  if (src !== undefined) {
    const lifesteal =
      src.resolved.lifestealPct +
      (src.rampageTicks > 0 ? RAMPAGE_ATTACK_SPEED_AND_LIFESTEAL_PCT : 0);
    if (lifesteal > 0 && src.alive) field.queue.heal(src.id, src.id, amt * (lifesteal / 100));
    if (source === 'primary' && src.resolved.vulnerabilityOnHitPct > 0) {
      applyVulnStack(tgt, src.resolved.vulnerabilityOnHitPct);
    }
    src.ultEnergy += amt * ULT_ENERGY_PER_DAMAGE_DEALT * src.resolved.ultChargeRate;
  }
  tgt.ultEnergy += amt * ULT_ENERGY_PER_DAMAGE_TAKEN * tgt.resolved.ultChargeRate;

  maybeTriggerCriticalDamageShell(tgt);
  maybeTriggerCriticalCounter(tgt);
  logDamage(field, srcId, tgt.id, amt, source, false);
}

function applyOneHeal(field: BattleField, srcId: number, tgtId: number, amount: number): void {
  const tgt = field.units[tgtId];
  if (tgt === undefined || !tgt.alive || amount <= 0) return;
  const src = srcId >= 0 ? field.units[srcId] : undefined;
  const room = tgt.maxHealth - tgt.health;
  const toRegular = room > 0 ? Math.min(amount, room) : 0;
  tgt.health += toRegular;
  const overflow = amount - toRegular;
  if (overflow > 0 && src !== undefined && src.resolved.overflowToBonusHealthPct > 0) {
    tgt.overhealth += overflow * (src.resolved.overflowToBonusHealthPct / 100);
  }
  if (src !== undefined) {
    src.ultEnergy += amount * ULT_ENERGY_PER_HEALING_DONE * src.resolved.ultChargeRate;
  }
}

function logDamage(
  field: BattleField,
  srcUnitId: number,
  tgtUnitId: number,
  amount: number,
  source: DamageSource,
  convertedToHeal: boolean,
): void {
  if (field.damageLog === null) return;
  field.damageLog.push({ tick: field.tick, srcUnitId, tgtUnitId, amount, source, convertedToHeal });
}

function applyQueuedEvents(field: BattleField): void {
  const q = field.queue;
  for (let i = 0; i < q.dN; i++) {
    applyOneDamage(
      field,
      q.dSrc[i]!,
      q.dTgt[i]!,
      q.dAmt[i]!,
      SRC_BY_CODE[q.dSrcCode[i]!] ?? 'primary',
    );
  }
  // `q.hN` may have grown during the damage pass (lifesteal, Critical Counter).
  for (let i = 0; i < q.hN; i++) {
    applyOneHeal(field, q.hSrc[i]!, q.hTgt[i]!, q.hAmt[i]!);
  }
  q.reset();
}

function deathChecks(field: BattleField): void {
  for (const u of field.units) {
    if (!u.alive || u.health > 0) continue;

    const killerId = u.lastDamagedBy;
    const killer = killerId >= 0 ? field.units[killerId] : undefined;
    field.kills.push({
      tick: field.tick,
      killerUnitId: killerId,
      killerHeroId: killer !== undefined ? killer.heroId : null,
      weapon: u.lastDamageSource,
      victimUnitId: u.id,
      victimHeroId: u.heroId,
    });
    field.hash.mix(0x4b494c4c);
    field.hash.mix(killerId + 1);
    field.hash.mix(u.id);
    field.hash.mix(SRC_CODE[u.lastDamageSource]);

    // Annihilator Fury — a Final Hit puts the killer into (or refreshes) Rampage.
    if (killer !== undefined && killer.alive && hasEffect(killer, 'onslaught-annihilator-fury')) {
      killer.health = killer.maxHealth;
      killer.rampageTicks = RAMPAGE_DURATION_TICKS;
    }

    // Backup Rebirth — first KO only. The KO still emitted one kill event above;
    // the revive is a separate event; a second death emits a second kill event.
    const reviveFraction = u.backupRebirthUsed
      ? 0
      : backupRebirthFraction(u, field.sideUniqueRoles[u.side]);
    if (reviveFraction > 0) {
      u.backupRebirthUsed = true;
      u.health = Math.min(u.maxHealth, reviveFraction * u.maxHealth);
      u.overhealth = 0;
      u.alive = true;
      u.targetId = -1;
      u.outOfRangeTicks = 0;
      u.attackCooldownTicks = 0;
      field.revives.push({
        tick: field.tick,
        unitId: u.id,
        heroId: u.heroId,
        healthRestored: u.health,
      });
      field.hash.mix(0x52455649);
      field.hash.mix(u.id);
      field.hash.mix(Math.round(u.health * 1000) | 0);
    } else {
      u.alive = false;
      u.health = 0;
      u.overhealth = 0;
    }
  }
}

function foldTickIntoHash(field: BattleField): void {
  const h = field.hash;
  h.mix(field.tick);
  h.mix(field.speedUpActive ? 1 : 0);
  for (const u of field.units) {
    h.mix(u.id);
    h.mix(Math.round(u.x * 1000) | 0);
    h.mix(Math.round(u.y * 1000) | 0);
    h.mix(Math.round(u.health * 1000) | 0);
    h.mix(Math.round(u.overhealth * 1000) | 0);
    h.mix(u.alive ? 1 : 0);
    h.mix(u.targetId + 1);
    h.mix(Math.round(u.ultEnergy * 1_000_000) | 0);
    h.mix(u.attackCooldownTicks);
    h.mix(
      u.rampageTicks * 8 +
        (u.beamTicks > 0 ? 4 : 0) +
        (u.selfBuffTicks > 0 ? 2 : 0) +
        (u.ultShieldTicks > 0 ? 1 : 0),
    );
    h.mix(u.vulnStacks * 64 + u.criticalDamageShellTicks);
  }
  // Drone state — so the digest tracks drone INPUT (movement, beam, one-time
  // presses). Same-seed + same input stream ⇒ identical digest, and any change
  // to the input changes it.
  for (const d of field.drones) {
    h.mix(d.side + 1);
    h.mix(Math.round(d.x * 1000) | 0);
    h.mix(Math.round(d.y * 1000) | 0);
    h.mix(
      (d.oneTimeDamageUsed ? 1 : 0) +
        (d.oneTimeHealUsed ? 2 : 0) +
        (d.beamHeldThisTick ? 4 : 0),
    );
  }
}

function runTick(field: BattleField, opts: RunOpts): void {
  const t = ++field.tick;

  if (!field.speedUpActive && t >= opts.speedUpTriggerTicks) {
    field.speedUpActive = true;
    field.speedUpStartedAtTick = t;
  }

  for (const u of field.units) if (u.alive) tickUnitEffects(field, u);
  for (const u of field.units) if (u.alive) acquireTarget(field, u);
  for (const u of field.units) if (u.alive) moveUnit(field, u);
  for (const u of field.units) {
    if (!u.alive) continue;
    doPrimaryAttack(field, u);
    doSustainedHeal(field, u);
  }
  for (const u of field.units) if (u.alive) maybeCastUlt(field, u);
  tickDrones(field, t);
  applyExternalActors(field, opts.externalActors, t);
  applyQueuedEvents(field);
  deathChecks(field);
  foldTickIntoHash(field);
}

function countAlive(field: BattleField, side: 0 | 1): number {
  let n = 0;
  for (const u of field.units) if (u.side === side && u.alive) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function simulateBattle(ctx: CombatContext, opts: SimulateOptions = {}): BattleTrace {
  const maxTicks = opts.maxTicks ?? BATTLE_MAX_TICKS;
  const tieCapTicks = opts.tieCapTicks ?? BATTLE_TIE_CAP_TICKS;
  const speedUpTriggerTicks = opts.speedUpTriggerTicks ?? SPEED_UP_TRIGGER_TICKS;

  const field = buildField(ctx, opts);
  const runOpts: RunOpts = {
    maxTicks,
    tieCapTicks,
    speedUpTriggerTicks,
    externalActors: opts.externalActors,
  };

  for (;;) {
    runTick(field, runOpts);
    if (opts.onTick !== undefined) opts.onTick(field);

    const aliveA = countAlive(field, 0);
    const aliveB = countAlive(field, 1);

    let result: BattleResult | null = null;
    let reason: 'elimination' | 'tieCap' | null = null;

    if (aliveA === 0 || aliveB === 0) {
      result = aliveA > 0 ? 'win' : aliveB > 0 ? 'loss' : 'tie';
      reason = 'elimination';
    } else if (field.tick >= tieCapTicks) {
      result = 'tie';
      reason = 'tieCap';
    } else if (field.tick >= maxTicks) {
      throw new Error(
        `combat: exceeded maxTicks=${maxTicks} at tick ${field.tick} without resolving — this is a bug report, not a game outcome`,
      );
    }

    if (result !== null && reason !== null) {
      const survivors =
        result === 'win' ? aliveA : result === 'loss' ? aliveB : Math.max(aliveA, aliveB);
      return {
        outcome: {
          result,
          survivingUnits: Math.min(6, Math.max(1, survivors)),
          survivorsSideA: aliveA,
          survivorsSideB: aliveB,
        },
        tickCount: field.tick,
        endReason: reason,
        digest: field.hash.hex(),
        kills: field.kills,
        revives: field.revives,
        speedUpStartedAtTick: field.speedUpStartedAtTick,
        finalUnits: field.units.map((u) => ({
          id: u.id,
          side: u.side,
          heroId: u.heroId,
          isGalactaBot: u.isGalactaBot,
          alive: u.alive,
          health: u.health,
          overhealth: u.overhealth,
          maxHealth: u.maxHealth,
          ultCasts: u.ultCasts,
          x: u.x,
          y: u.y,
        })),
        finalDrones: field.drones.map((d) => ({
          side: d.side,
          playerId: d.playerId,
          colour: d.colour,
          health: d.health,
          x: d.x,
          y: d.y,
          oneTimeDamageUsed: d.oneTimeDamageUsed,
          oneTimeHealUsed: d.oneTimeHealUsed,
        })),
        damageLog: field.damageLog,
      };
    }
  }
}

/**
 * The real M2 `CombatResolver`. `match.ts` injects this in place of
 * `createStubCombatResolver()` — nothing else in `match.ts` changes.
 */
export function createCombatResolver(baseOpts: SimulateOptions = {}): CombatResolver {
  return {
    resolve(ctx: CombatContext): CombatOutcome {
      return simulateBattle(ctx, baseOpts).outcome;
    },
  };
}
