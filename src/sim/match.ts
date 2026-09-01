/*
 * The round / phase machine: draft, the round loop, PvP pairing, the odd-count
 * rule, phantoms, health loss, elimination, placement, and the round cap.
 *
 * `runMatch(seed, actions, combatResolver, options?)` is the whole surface —
 * seed + an ordered list of player-0 actions in, the finished match plus every
 * phase-boundary snapshot out. Combat is injected (see `CombatResolver`); M2
 * ships `createStubCombatResolver` in `stubCombat.ts`.
 *
 * NUMBERS: every canonical / derived / authored value is imported from
 * `src/data`. Only genuinely M2-local knobs (the pairing attempt budget and the
 * "avoid opponents from the last N rounds" window) are declared here.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import {
  HERO_POOL_PER_ROLE,
  LINEUP_SIZE,
  PHASE_COUNT,
  PLAYER_COUNT,
  PRACTICE_ROUNDS,
  STARTING_HEALTH,
  STARTING_TOKENS,
} from '../data/constants';
import {
  HP_LOSS_ROUND_DIVISOR,
  HP_LOSS_SURVIVOR_COEFF,
  HP_LOSS_SURVIVOR_RANGE,
  HP_LOSS_TIE_DIVISOR,
  ROUND_CAP,
} from '../data/authored';
import heroesJson from '../data/heroes.json';
import type { Role } from '../data/types';

import { RngStream } from './rng';
import type { RngSnapshot, Substream } from './rng';
import { placeholderDraftLineup } from './botPolicy';
import { applyBattleResolution, applyRoundStartIncome } from './economy';
import { hashState } from './types';
import type {
  Action,
  BattleResult,
  CombatContext,
  CombatResolver,
  LineupSource,
  MatchResult,
  MatchState,
  MatchupKind,
  PhaseBoundary,
  PhaseKind,
  RoundType,
  RunMatchOptions,
  StreakKind,
} from './types';

// ---------------------------------------------------------------------------
// M2-local knobs (not values M1 owns)
// ---------------------------------------------------------------------------

/**
 * Bounded pairing attempts. A "shuffle, pair, retry if a rematch" loop can spin
 * forever (two survivors who have already faced each other twice), so we draw at
 * most this many candidate shuffles and keep the one with the fewest repeat
 * matchups. Deterministic tiebreak: the earliest such candidate.
 */
const PAIRING_MAX_ATTEMPTS = 24;

/** "Avoid an opponent faced in the previous N rounds" — the plan says two. */
const PAIRING_AVOID_WINDOW = 2;

/** How many opponent ids to retain per player (>= PAIRING_AVOID_WINDOW). */
const RECENT_OPPONENT_HISTORY = 8;

// ---------------------------------------------------------------------------
// Roster lookup (from the canonical data layer)
// ---------------------------------------------------------------------------

interface HeroLite {
  readonly id: string;
  readonly role: Role;
}

const HEROES = heroesJson as unknown as readonly HeroLite[];

const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];

const ROLE_OF: Readonly<Record<string, Role>> = Object.fromEntries(
  HEROES.map((h): [string, Role] => [h.id, h.role]),
);

const HEROES_BY_ROLE: Readonly<Record<Role, readonly string[]>> = {
  vanguard: HEROES.filter((h) => h.role === 'vanguard').map((h) => h.id).sort(),
  duelist: HEROES.filter((h) => h.role === 'duelist').map((h) => h.id).sort(),
  strategist: HEROES.filter((h) => h.role === 'strategist').map((h) => h.id).sort(),
};

// ---------------------------------------------------------------------------
// Round / phase helpers (exported — the M2 table tests hit these directly)
// ---------------------------------------------------------------------------

export function roundTypeOf(round: number): RoundType {
  return (PRACTICE_ROUNDS as readonly number[]).includes(round) ? 'practice' : 'battle';
}

export function phaseCountOf(round: number): number {
  return PHASE_COUNT[roundTypeOf(round)];
}

export function phaseKindOf(round: number, phase: number): PhaseKind {
  if (phase < 1 || phase > phaseCountOf(round)) {
    throw new RangeError(`phaseKindOf(): round ${round} has no phase ${phase}`);
  }
  if (phase === 1) return 'moduleDraw';
  if (phase === 2) return 'selectPosition';
  if (phase === 3) return 'battle';
  return 'reward'; // phase 4 — Practice rounds only
}

// ---------------------------------------------------------------------------
// Health loss — the DERIVED formula from authored.ts
// ---------------------------------------------------------------------------

/** Surviving-enemy-unit count feeding the formula is clamped to the canonical range. */
export function clampSurvivors(n: number): number {
  const [lo, hi] = HP_LOSS_SURVIVOR_RANGE;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * `loss = floor((round - 1) / 5) + survivingEnemyUnits`;
 * `tie  = ceil(loss / 2)`. Constants live in `authored.ts`.
 */
export function healthLoss(round: number, survivingEnemyUnits: number, tie: boolean): number {
  const survivors = clampSurvivors(survivingEnemyUnits);
  const loss =
    Math.floor((round - 1) / HP_LOSS_ROUND_DIVISOR) + HP_LOSS_SURVIVOR_COEFF * survivors;
  return tie ? Math.ceil(loss / HP_LOSS_TIE_DIVISOR) : loss;
}

// ---------------------------------------------------------------------------
// Mutable working state (deep-cloned to the readonly public shape at boundaries)
// ---------------------------------------------------------------------------

interface WorkPlayer {
  id: number;
  name: string;
  isHuman: boolean;
  alive: boolean;
  health: number;
  eliminationHealth: number | null;
  tokens: number;
  placement: number | null;
  eliminatedRound: number | null;
  pool: string[];
  lineup: string[];
  reserve: string[];
  lineupSource: LineupSource;
  phantomLineup: string[] | null;
  recentOpponents: number[];
  lastRoundResult: BattleResult | 'none';
  streak: number;
  streakKind: StreakKind;
}

interface WorkMatchup {
  kind: MatchupKind;
  a: number;
  b: number;
  resultA: BattleResult | null;
  survivingUnits: number | null;
  healthLossA: number;
  healthLossB: number;
}

interface WorkState {
  seed: number;
  status: MatchState['status'];
  round: number;
  phase: number;
  phaseKind: PhaseKind;
  roundType: RoundType;
  humanConfirmedPhase: boolean;
  actionCursor: number;
  players: WorkPlayer[];
  matchups: WorkMatchup[];
  rng: RngSnapshot;
  winnerId: number | null;
}

function cloneState(w: WorkState): MatchState {
  return {
    seed: w.seed,
    status: w.status,
    round: w.round,
    phase: w.phase,
    phaseKind: w.phaseKind,
    roundType: w.roundType,
    humanConfirmedPhase: w.humanConfirmedPhase,
    actionCursor: w.actionCursor,
    winnerId: w.winnerId,
    players: w.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHuman: p.isHuman,
      alive: p.alive,
      health: p.health,
      eliminationHealth: p.eliminationHealth,
      tokens: p.tokens,
      placement: p.placement,
      eliminatedRound: p.eliminatedRound,
      pool: p.pool.slice(),
      lineup: p.lineup.slice(),
      reserve: p.reserve.slice(),
      lineupSource: p.lineupSource,
      phantomLineup: p.phantomLineup === null ? null : p.phantomLineup.slice(),
      recentOpponents: p.recentOpponents.slice(),
      lastRoundResult: p.lastRoundResult,
      streak: p.streak,
      streakKind: p.streakKind,
    })),
    matchups: w.matchups.map((m) => ({
      kind: m.kind,
      a: m.a,
      b: m.b,
      resultA: m.resultA,
      survivingUnits: m.survivingUnits,
      healthLossA: m.healthLossA,
      healthLossB: m.healthLossB,
    })),
    rng: { masterSeed: w.rng.masterSeed, substreams: { ...w.rng.substreams } },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function initState(seed: number): WorkState {
  const players: WorkPlayer[] = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    players.push({
      id: i,
      name: `Player ${i + 1}`,
      isHuman: i === 0,
      alive: true,
      health: STARTING_HEALTH,
      eliminationHealth: null,
      // Round-start income, HP compensation and the +2 PvP win bonus all move
      // `tokens` via `sim/economy.ts`, hooked in at the two seams below.
      tokens: STARTING_TOKENS,
      placement: null,
      eliminatedRound: null,
      pool: [],
      lineup: [],
      reserve: [],
      lineupSource: 'auto',
      phantomLineup: null,
      recentOpponents: [],
      lastRoundResult: 'none',
      streak: 0,
      streakKind: 'none',
    });
  }
  return {
    seed,
    status: 'drafting',
    round: 0,
    phase: 0,
    phaseKind: 'draft',
    roundType: roundTypeOf(0),
    humanConfirmedPhase: false,
    actionCursor: 0,
    players,
    matchups: [],
    rng: { masterSeed: seed, substreams: {} },
    winnerId: null,
  };
}

function assignPools(work: WorkState, rng: RngStream): void {
  for (const p of work.players) {
    const sub = rng.stream(`pool:${p.id}`, 0);
    const pool: string[] = [];
    for (const role of ROLES) {
      pool.push(...sub.shuffle(HEROES_BY_ROLE[role]).slice(0, HERO_POOL_PER_ROLE));
    }
    p.pool = pool;
  }
}

function setLineup(p: WorkPlayer, lineup: readonly string[], source: LineupSource): void {
  const chosen = new Set(lineup);
  p.lineup = [...lineup];
  p.reserve = p.pool.filter((id) => !chosen.has(id));
  p.lineupSource = source;
}

function isValidLineup(lineup: readonly string[], pool: readonly string[]): boolean {
  if (lineup.length !== LINEUP_SIZE) return false;
  const set = new Set(lineup);
  if (set.size !== LINEUP_SIZE) return false;
  const poolSet = new Set(pool);
  return lineup.every((id) => poolSet.has(id));
}

// ---------------------------------------------------------------------------
// Action consumption
// ---------------------------------------------------------------------------

interface Cursor {
  i: number;
}

interface PhaseInput {
  /** true = player 0 confirmed; false = timed out / ran out of actions. */
  readonly confirmed: boolean;
  /** The last `selectLineup` seen this phase (draft only cares). */
  readonly lineup: readonly string[] | null;
}

/**
 * Consume actions for the current phase: apply any `selectLineup`, then stop on
 * the first `confirmPhase` (confirmed) or `advanceTimer` (timed out). Running
 * out of actions is an implicit timeout. Unrecognised action types are skipped.
 */
function consumeUntilPhaseEnd(actions: readonly Action[], cur: Cursor): PhaseInput {
  let lineup: readonly string[] | null = null;
  while (cur.i < actions.length) {
    const act = actions[cur.i]!;
    cur.i++;
    if (act.type === 'selectLineup') {
      lineup = act.heroes.slice();
      continue;
    }
    if (act.type === 'confirmPhase') return { confirmed: true, lineup };
    if (act.type === 'advanceTimer') return { confirmed: false, lineup };
    // future action types: skip and keep consuming
  }
  return { confirmed: false, lineup };
}

// ---------------------------------------------------------------------------
// Pairing — bounded, terminating, deterministic
// ---------------------------------------------------------------------------

export interface PairingInput {
  readonly living: readonly number[];
  readonly eliminated: readonly number[];
  /** Opponent history per player (most recent last). */
  readonly recentOpponents: (id: number) => readonly number[];
  readonly rng: Substream;
}

export interface PairingResult {
  readonly pairs: readonly (readonly [number, number])[];
  /**
   * The odd-one-out, when `living.length` is odd. `kind` is `phantom` if any
   * player is eliminated, else `mirror`; `source` is the phantom owner or the
   * living mirror source.
   */
  readonly solo: { readonly player: number; readonly kind: 'phantom' | 'mirror'; readonly source: number } | null;
}

function recentSet(recent: readonly number[]): Set<number> {
  return new Set(recent.slice(-PAIRING_AVOID_WINDOW));
}

function pairSequential(order: readonly number[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) {
    pairs.push([order[i]!, order[i + 1]!]);
  }
  return pairs;
}

function countRepeats(
  pairs: readonly (readonly [number, number])[],
  recentOpponents: (id: number) => readonly number[],
): number {
  let repeats = 0;
  for (const [a, b] of pairs) {
    if (recentSet(recentOpponents(a)).has(b) || recentSet(recentOpponents(b)).has(a)) {
      repeats++;
    }
  }
  return repeats;
}

/**
 * Shuffle the living players and pair them sequentially, preferring a pairing
 * that avoids a recent opponent. Bounded: at most `PAIRING_MAX_ATTEMPTS` draws
 * from the substream; keep the earliest candidate with the fewest repeats.
 */
export function planPairing(input: PairingInput): PairingResult {
  const { living, eliminated, recentOpponents, rng } = input;

  let pool = living.slice();
  let solo: PairingResult['solo'] = null;

  if (pool.length % 2 === 1) {
    const odd = pool[rng.int(0, pool.length - 1)]!;
    pool = pool.filter((id) => id !== odd);
    if (eliminated.length > 0) {
      solo = { player: odd, kind: 'phantom', source: rng.pick(eliminated) };
    } else {
      // Not reachable in a 6-player match (odd living <=> >=1 eliminated), but
      // the branch is correct for an odd starting count / no-phantom config.
      solo = { player: odd, kind: 'mirror', source: rng.pick(pool) };
    }
  }

  let best: [number, number][] | null = null;
  let bestRepeats = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < PAIRING_MAX_ATTEMPTS && bestRepeats > 0; attempt++) {
    const candidate = pairSequential(rng.shuffle(pool));
    const repeats = countRepeats(candidate, recentOpponents);
    if (repeats < bestRepeats) {
      best = candidate;
      bestRepeats = repeats;
    }
  }

  return { pairs: best ?? pairSequential(pool), solo };
}

// ---------------------------------------------------------------------------
// Battle phase
// ---------------------------------------------------------------------------

function invert(result: BattleResult): BattleResult {
  return result === 'win' ? 'loss' : result === 'loss' ? 'win' : 'tie';
}

function pushRecentOpponent(p: WorkPlayer, opponentId: number): void {
  p.recentOpponents = [...p.recentOpponents, opponentId].slice(-RECENT_OPPONENT_HISTORY);
}

function buildMatchups(work: WorkState, rng: RngStream, round: number): WorkMatchup[] {
  const living = work.players.filter((p) => p.alive).map((p) => p.id);

  if (roundTypeOf(round) === 'practice') {
    return living.map((id) => blankMatchup('pve', id, -1));
  }

  const plan = planPairing({
    living,
    eliminated: work.players.filter((p) => !p.alive).map((p) => p.id),
    recentOpponents: (id) => work.players[id]!.recentOpponents,
    rng: rng.stream('pairing', round),
  });

  const matchups: WorkMatchup[] = [];
  if (plan.solo !== null) {
    matchups.push(blankMatchup(plan.solo.kind, plan.solo.player, plan.solo.source));
  }
  for (const [a, b] of plan.pairs) {
    matchups.push(blankMatchup('pvp', a, b));
  }
  return matchups;
}

function blankMatchup(kind: MatchupKind, a: number, b: number): WorkMatchup {
  return { kind, a, b, resultA: null, survivingUnits: null, healthLossA: 0, healthLossB: 0 };
}

function combatContextFor(
  work: WorkState,
  rng: RngStream,
  round: number,
  m: WorkMatchup,
): CombatContext {
  const a = work.players[m.a]!;
  const sideA = {
    playerId: m.a,
    lineup: a.lineup.slice(),
    isPhantom: false,
    isGalactaBots: false,
  };

  let sideB: CombatContext['sideB'];
  if (m.kind === 'pve') {
    sideB = { playerId: -1, lineup: [], isPhantom: false, isGalactaBots: true };
  } else if (m.kind === 'phantom') {
    const owner = work.players[m.b]!;
    sideB = {
      playerId: m.b,
      lineup: (owner.phantomLineup ?? owner.lineup).slice(),
      isPhantom: true,
      isGalactaBots: false,
    };
  } else {
    // pvp or mirror — a copy of the opponent/source's living lineup
    const other = work.players[m.b]!;
    sideB = {
      playerId: m.b,
      lineup: other.lineup.slice(),
      isPhantom: false,
      isGalactaBots: false,
    };
  }

  return {
    round,
    roundType: roundTypeOf(round),
    matchupKind: m.kind,
    sideA,
    sideB,
    rng: rng.stream(`combat:${m.kind}:${m.a}:${m.b}`, round),
  };
}

export interface EliminatedLike {
  readonly id: number;
  /** Raw health at elimination (`<= 0`, may be negative); `null` treated as 0. */
  readonly eliminationHealth: number | null;
}

/**
 * Best-first order for a simultaneously-eliminated batch — index 0 takes the
 * best (lowest) available placement.
 *
 * TIEBREAK (documented — see the report): the player who ended with MORE health
 * (closer to 0; every batch member is `<= 0`) ranks better, then lower player
 * id. This is the *fair* reading — someone blown deeper into the negative lost
 * by more. The plan's phrase "most negative health first", read literally, would
 * instead reward the most-blown-out player; to get that, flip `hy - hx` to
 * `hx - hy` below. Nothing else changes.
 */
export function orderEliminatedForPlacement(batch: readonly EliminatedLike[]): number[] {
  return batch
    .slice()
    .sort((x, y) => {
      const hx = x.eliminationHealth ?? 0;
      const hy = y.eliminationHealth ?? 0;
      if (hx !== hy) return hy - hx;
      return x.id - y.id;
    })
    .map((p) => p.id);
}

/** Assign placements `livingAfter + 1, +2, ...` to a batch in best-first order. */
function assignBatchPlacements(batch: readonly WorkPlayer[], livingAfter: number): void {
  const byId = new Map(batch.map((p) => [p.id, p]));
  orderEliminatedForPlacement(batch).forEach((id, i) => {
    byId.get(id)!.placement = livingAfter + 1 + i;
  });
}

function resolveByHealth(work: WorkState): void {
  const living = work.players
    .filter((p) => p.alive)
    .slice()
    .sort((a, b) => b.health - a.health || a.id - b.id);
  living.forEach((p, i) => {
    p.placement = i + 1;
  });
  work.winnerId = living[0]?.id ?? null;
  work.status = 'complete';
}

function finishMatch(work: WorkState): void {
  const living = work.players.filter((p) => p.alive);
  if (living.length === 1) {
    const winner = living[0]!;
    winner.placement = 1;
    work.winnerId = winner.id;
  } else {
    // Final batch wiped everyone the same round — the batch is already placed
    // 1..k; placement 1 is the winner.
    work.winnerId = work.players.find((p) => p.placement === 1)?.id ?? null;
  }
  work.status = 'complete';
}

/** Returns true when the match has just finished. */
function runBattlePhase(
  work: WorkState,
  rng: RngStream,
  combat: CombatResolver,
  maxRounds: number,
): boolean {
  const round = work.round;
  const matchups = buildMatchups(work, rng, round);
  work.matchups = matchups;

  // Resolve via the injected resolver.
  for (const m of matchups) {
    const outcome = combat.resolve(combatContextFor(work, rng, round, m));
    m.resultA = outcome.result;
    m.survivingUnits = clampSurvivors(outcome.survivingUnits);
  }

  // Health deltas. The DERIVED formula depends only on round + survivors, so
  // order does not matter. PvE is health-neutral.
  for (const m of matchups) {
    if (m.kind === 'pve' || m.resultA === null || m.survivingUnits === null) continue;
    const survivors = m.survivingUnits;
    if (m.kind === 'pvp') {
      if (m.resultA === 'win') {
        m.healthLossB = healthLoss(round, survivors, false);
        // SEAM (M3): winner (a) gets +PVP_WIN_TOKEN_BONUS at battle resolution.
      } else if (m.resultA === 'loss') {
        m.healthLossA = healthLoss(round, survivors, false);
      } else {
        m.healthLossA = healthLoss(round, survivors, true);
        m.healthLossB = healthLoss(round, survivors, true);
      }
    } else if (m.resultA === 'loss') {
      m.healthLossA = healthLoss(round, survivors, false);
    } else if (m.resultA === 'tie') {
      m.healthLossA = healthLoss(round, survivors, true);
    }
    // mirror/phantom win -> nothing; beating one costs the source owner nothing.
  }

  // Apply health loss, then hand each side's result to the M3 economy engine
  // (streak progression, +2 PvP win bonus, HP compensation). Health may dip
  // <= 0 here; the batch step floors it. Compensation is against pre-loss
  // health, so capture it before `applyLoss`.
  for (const m of matchups) {
    const healthBeforeA = work.players[m.a]!.health;
    applyLoss(work, m.a, m.healthLossA);
    applyBattleResolution(work, {
      playerId: m.a,
      result: m.resultA,
      matchupKind: m.kind,
      healthBefore: healthBeforeA,
      rawHealthLoss: m.healthLossA,
    });
    if (m.kind === 'pvp') {
      const healthBeforeB = work.players[m.b]!.health;
      applyLoss(work, m.b, m.healthLossB);
      applyBattleResolution(work, {
        playerId: m.b,
        result: m.resultA === null ? null : invert(m.resultA),
        matchupKind: m.kind,
        healthBefore: healthBeforeB,
        rawHealthLoss: m.healthLossB,
      });
    }
  }

  // Results + opponent history.
  for (const m of matchups) {
    const a = work.players[m.a]!;
    a.lastRoundResult = m.resultA ?? 'none';
    pushRecentOpponent(a, m.kind === 'pve' ? -1 : m.b);
    if (m.kind === 'pvp') {
      const b = work.players[m.b]!;
      b.lastRoundResult = m.resultA === null ? 'none' : invert(m.resultA);
      pushRecentOpponent(b, m.a);
    }
  }

  // Batch elimination — everyone at <= 0 this round leaves together.
  const batch = work.players.filter((p) => p.alive && p.health <= 0);
  if (batch.length > 0) {
    for (const p of batch) {
      p.eliminationHealth = p.health; // raw, <= 0
      p.health = 0;
      p.alive = false;
      p.eliminatedRound = round;
      p.phantomLineup = p.lineup.slice();
    }
    assignBatchPlacements(batch, work.players.filter((p) => p.alive).length);
  }

  const livingCount = work.players.filter((p) => p.alive).length;
  if (livingCount <= 1) {
    finishMatch(work);
    return true;
  }
  if (round >= maxRounds) {
    resolveByHealth(work);
    return true;
  }
  return false;
}

function applyLoss(work: WorkState, id: number, loss: number): void {
  if (loss <= 0) return;
  const p = work.players[id];
  if (p === undefined || !p.alive) return;
  p.health -= loss;
}

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

function pushBoundary(
  out: PhaseBoundary[],
  work: WorkState,
  rng: RngStream,
  round: number,
  phase: number,
  kind: PhaseKind,
): void {
  work.rng = rng.getState();
  const state = cloneState(work);
  out.push({
    round,
    phase,
    label: kind === 'draft' ? 'draft' : `${round}-${phase}`,
    kind,
    hash: hashState(state),
    state,
  });
}

// ---------------------------------------------------------------------------
// runMatch
// ---------------------------------------------------------------------------

export function runMatch(
  seed: number,
  actions: readonly Action[],
  combat: CombatResolver,
  options: RunMatchOptions = {},
): MatchResult {
  const masterSeed = seed >>> 0;
  const maxRounds = options.maxRounds ?? ROUND_CAP;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new RangeError(`runMatch(): maxRounds must be a positive integer, got ${maxRounds}`);
  }

  const rng = new RngStream(masterSeed);
  const work = initState(masterSeed);
  const boundaries: PhaseBoundary[] = [];
  const cursor: Cursor = { i: 0 };

  // ---- Draft ----
  assignPools(work, rng);
  for (const p of work.players) {
    if (!p.isHuman) {
      setLineup(p, placeholderDraftLineup(p.pool, ROLE_OF, rng.stream(`ai:${p.id}`, 0)), 'auto');
    }
  }
  const draftInput = consumeUntilPhaseEnd(actions, cursor);
  work.humanConfirmedPhase = draftInput.confirmed;
  const human = work.players[0]!;
  if (draftInput.lineup !== null && isValidLineup(draftInput.lineup, human.pool)) {
    setLineup(human, draftInput.lineup, 'human');
  } else {
    setLineup(human, placeholderDraftLineup(human.pool, ROLE_OF, rng.stream('human', 0)), 'auto');
  }
  work.actionCursor = cursor.i;
  pushBoundary(boundaries, work, rng, 0, 0, 'draft');

  // ---- Round loop ----
  work.status = 'inRound';
  for (let round = 1; round <= maxRounds; round++) {
    work.round = round;
    work.roundType = roundTypeOf(round);
    const phases = phaseCountOf(round);

    for (let phase = 1; phase <= phases; phase++) {
      work.phase = phase;
      work.phaseKind = phaseKindOf(round, phase);
      work.humanConfirmedPhase = false;
      work.matchups = [];

      if (work.phaseKind === 'moduleDraw') {
        // SEAM (M3): base -> interest -> streak income for every living player.
        // No-op on round 1 (the `1-1` screenshot shows every player at <>10).
        applyRoundStartIncome(work);
      }

      const matchFinished = work.phaseKind === 'battle'
        ? runBattlePhase(work, rng, combat, maxRounds)
        : false;
      // moduleDraw: SEAM (M4 shop) — round-start income applied just above.
      // selectPosition: SEAM (M6 deploy).
      // reward: SEAM (M6 — grants PRACTICE_REWARD_COUNTS[...] Strengthen picks).

      const input = consumeUntilPhaseEnd(actions, cursor);
      work.humanConfirmedPhase = input.confirmed;
      work.actionCursor = cursor.i;

      pushBoundary(boundaries, work, rng, round, phase, work.phaseKind);

      if (matchFinished) {
        return { finalState: cloneState(work), boundaries };
      }
    }
  }

  // The battle phase of round `maxRounds` always finishes the match (elimination
  // or resolve-by-health), so this is unreachable.
  throw new Error(`runMatch(): match did not resolve by round ${maxRounds}`);
}
