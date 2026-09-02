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
  CHANGE_HERO_COST,
  HERO_POOL_PER_ROLE,
  LINEUP_SIZE,
  PHASE_COUNT,
  PLAYER_COUNT,
  PRACTICE_REWARD_COUNTS,
  PRACTICE_ROUNDS,
  SHOP_REFRESH_COST,
  STARTING_HEALTH,
  STARTING_TOKENS,
} from '../data/constants';
import {
  HP_LOSS_ROUND_DIVISOR,
  HP_LOSS_SURVIVOR_COEFF,
  HP_LOSS_SURVIVOR_RANGE,
  HP_LOSS_TIE_DIVISOR,
  PVE_LOSS_COSTS_HEALTH,
  ROUND_CAP,
  STRENGTHEN_REWARD_REQUIRES_WIN,
} from '../data/authored';
import heroesJson from '../data/heroes.json';
import type { Role } from '../data/types';

import { balancedDraft } from '../ai/draft';
import { resolvePolicy, seatArchetypes } from '../ai/archetypes';
import { ARCHETYPES } from '../ai/types';
import type { AiPolicy, ArchetypeName } from '../ai/types';

import { RngStream } from './rng';
import type { RngSnapshot, Substream } from './rng';
import { isValidDeployment } from './board';
import type { DeployCell, Deployment } from './board';
import { assignDroneColours, planMatchupDrones } from './drone';
import type { DroneColour, DroneInputStream, DroneSpec } from './drone';
import { applyBattleResolution, applyRoundStartIncome } from './economy';
import {
  accountLevels,
  buyModule,
  canRefreshShop,
  levelsFromXp,
  lockShop,
  openShop,
  refreshShop,
  sellModule,
  spendHeroSwap,
  spendShopRefresh,
  swapHeroAndConvertStrengthen,
  unlockShop,
  zeroProtocolXp,
} from './modules';
import type { ModuleAccount, OwnedModule, ProtocolXp, ShopState, StrengthenInventory } from './modules';
import {
  autoFillStrengthenReward,
  grantStrengthenPicks,
  openStrengthenReward,
  pickStrengthenReward,
  refreshStrengthenReward,
  strengthenOwnedIds,
} from './practice';
import type { SideModules } from './stats';
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
  droneColour: DroneColour;
  strengthen: StrengthenInventory;
  // M7 — module economy + deployment (plain JSON on the public state).
  ownedModules: OwnedModule[];
  protocolXp: ProtocolXp;
  shop: ShopState | null;
  tokenLedger: { earned: number; spent: number; refunded: number };
  deployment: DeployCell[] | null;
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
      droneColour: p.droneColour,
      strengthen: {
        equipped: Object.fromEntries(
          Object.entries(p.strengthen.equipped).map(([k, v]) => [k, v.slice()]),
        ),
        selectable: p.strengthen.selectable.slice(),
      },
      ownedModules: p.ownedModules.map((o) => ({ moduleId: o.moduleId, stars: o.stars })),
      protocolXp: { ...p.protocolXp },
      shop:
        p.shop === null
          ? null
          : {
              round: p.shop.round,
              locked: p.shop.locked,
              slots: p.shop.slots.map((c) => (c === null ? null : { ...c })),
            },
      tokenLedger: { ...p.tokenLedger },
      deployment:
        p.deployment === null ? null : p.deployment.map((c) => ({ col: c.col, row: c.row })),
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

/**
 * Resolve `RunMatchOptions.ai` into a per-seat AI policy map + the human seat
 * id (`-1` when every seat is a bot). Seats not pinned by an explicit map fall
 * back to the seed rotation (`seatArchetypes`); seat 0 stays human unless
 * `'aiOnly'`, or an explicit map, names it.
 */
function resolveSeatPolicies(
  masterSeed: number,
  ai: RunMatchOptions['ai'],
): { policies: ReadonlyMap<number, AiPolicy>; humanSeat: number } {
  const rotation = seatArchetypes(masterSeed);
  const explicit: Readonly<Record<number, string>> | null =
    ai !== undefined && ai !== 'aiOnly' ? ai : null;

  const nameFor = (id: number): ArchetypeName | null => {
    if (explicit !== null) {
      const pinned = explicit[id];
      if (pinned !== undefined) {
        if (!(ARCHETYPES as readonly string[]).includes(pinned)) {
          throw new RangeError(`runMatch(): unknown AI archetype "${pinned}" for seat ${id}`);
        }
        return pinned as ArchetypeName;
      }
      return id === 0 ? null : (rotation[id] ?? null);
    }
    if (ai === 'aiOnly') return rotation[id] ?? null;
    return id === 0 ? null : (rotation[id] ?? null);
  };

  const policies = new Map<number, AiPolicy>();
  let humanSeat = -1;
  for (let id = 0; id < PLAYER_COUNT; id++) {
    const name = nameFor(id);
    if (name === null) {
      if (humanSeat === -1) humanSeat = id;
    } else {
      policies.set(id, resolvePolicy(name));
    }
  }
  return { policies, humanSeat };
}

function initState(seed: number, humanSeat: number): WorkState {
  const players: WorkPlayer[] = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    players.push({
      id: i,
      name: `Player ${i + 1}`,
      isHuman: i === humanSeat,
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
      // Overwritten by `assignDroneColours` right after pool assignment.
      droneColour: 'Default',
      strengthen: { equipped: {}, selectable: [] },
      // M7 — module economy. `tokenLedger.earned` seeds with the starting
      // tokens so `conserves` (earned + refunded === spent + tokens) holds
      // from the draft boundary on.
      ownedModules: [],
      protocolXp: zeroProtocolXp(),
      shop: null,
      tokenLedger: { earned: STARTING_TOKENS, spent: 0, refunded: 0 },
      deployment: null,
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
// M7 — module economy adapter + ledger
// ---------------------------------------------------------------------------

/**
 * Project a `WorkPlayer` into the `ModuleAccount` shape `modules.ts` /
 * `economy.ts` already operate on. `owned` and `protocolXp` are shared BY
 * REFERENCE — `buyModule` / `sellModule` mutate them in place, writing straight
 * through to the player — so only `tokens` and the three ledger counters need
 * `commitAccount` to copy back. `PlayerState.tokens` therefore stays the one
 * balance; there are never two.
 */
function asAccount(p: WorkPlayer): ModuleAccount {
  return {
    tokens: p.tokens,
    owned: p.ownedModules,
    protocolXp: p.protocolXp,
    earned: p.tokenLedger.earned,
    spent: p.tokenLedger.spent,
    refunded: p.tokenLedger.refunded,
  };
}

function commitAccount(p: WorkPlayer, acc: ModuleAccount): void {
  p.tokens = acc.tokens;
  p.tokenLedger = { earned: acc.earned, spent: acc.spent, refunded: acc.refunded };
}

/**
 * Fold each player's token delta from an economy CREDIT-only step
 * (`applyRoundStartIncome`, `applyBattleResolution`) into their ledger's
 * `earned`, so `conserves` stays true at every boundary. Those two functions
 * only ever add to `tokens`; module debits / refunds go through `asAccount`.
 */
function creditLedger(work: WorkState, before: readonly number[]): void {
  work.players.forEach((p, i) => {
    const delta = p.tokens - (before[i] ?? 0);
    if (delta !== 0) {
      p.tokenLedger = { ...p.tokenLedger, earned: p.tokenLedger.earned + delta };
    }
  });
}

/** This player's owned Base Modules + protocol levels, as combat consumes them. */
function sideModulesOf(p: WorkPlayer): SideModules {
  return {
    owned: p.ownedModules.map((o) => ({ moduleId: o.moduleId, stars: o.stars })),
    protocolLevels: levelsFromXp(p.protocolXp),
  };
}

/** A fresh copy of this player's board deployment (or `null` = engine formation). */
function deploymentOf(p: WorkPlayer): Deployment | null {
  return p.deployment === null ? null : p.deployment.map((c) => ({ col: c.col, row: c.row }));
}

/**
 * Open every living player's shop for `round` from their own per-round
 * substream (`shop:<id>#round`), honouring `SHOP_LOCK_BEHAVIOUR` carry-over
 * from `p.shop`. Runs on the Module Draw phase, right after round-start income.
 * A bot then runs its archetype's shop turn against the same substream —
 * per-player and per-round, so adding a bot or changing one's archetype cannot
 * shift another seat's rolls (the M7 isolation invariant).
 */
function openShopsForRound(
  work: WorkState,
  rng: RngStream,
  round: number,
  policies: ReadonlyMap<number, AiPolicy>,
): void {
  for (const p of work.players) {
    if (!p.alive) continue;
    const sub = rng.stream(`shop:${p.id}`, round);
    const acc = asAccount(p);
    let shop = openShop(round, accountLevels(acc), acc.owned, sub, p.shop);

    const policy = policies.get(p.id);
    if (policy !== undefined) {
      shop = policy.runShopTurn({
        round,
        account: acc,
        shop,
        rng: sub,
        streakKind: p.streakKind,
        streak: p.streak,
        lineup: p.lineup.slice(),
        roleOf: ROLE_OF,
      });
    }

    commitAccount(p, acc);
    p.shop = shop;
  }
}

/** The lineup of the last living opponent this player faced (`null` if none). */
function lastOpponentLineupOf(work: WorkState, p: WorkPlayer): readonly string[] | null {
  for (let i = p.recentOpponents.length - 1; i >= 0; i--) {
    const id = p.recentOpponents[i]!;
    if (id >= 0) return work.players[id]!.lineup.slice();
  }
  return null;
}

/**
 * Each bot places its lineup on the 6×4 board from its own per-round substream
 * (`ai:<id>:deploy#round`). The human keeps `deployment = null` (the engine
 * formation) unless a `deploy` action is supplied.
 */
function runBotDeploys(
  work: WorkState,
  rng: RngStream,
  round: number,
  policies: ReadonlyMap<number, AiPolicy>,
): void {
  for (const p of work.players) {
    if (!p.alive) continue;
    const policy = policies.get(p.id);
    if (policy === undefined) continue;
    const cells = policy.deploy({
      lineup: p.lineup.slice(),
      roleOf: ROLE_OF,
      protocolLevels: levelsFromXp(p.protocolXp),
      ownedModules: p.ownedModules.map((o) => ({ moduleId: o.moduleId, stars: o.stars })),
      lastOpponentLineup: lastOpponentLineupOf(work, p),
      rng: rng.stream(`ai:${p.id}:deploy`, round),
    });
    p.deployment = cells.map((c) => ({ col: c.col, row: c.row }));
  }
}

/** Apply the human seat's Module Draw actions to their open shop / account. */
function applyHumanShopActions(
  work: WorkState,
  actions: readonly HumanShopAction[],
  rng: RngStream,
  round: number,
): void {
  if (actions.length === 0) return;
  const p = work.players.find((pp) => pp.isHuman);
  if (p === undefined || !p.alive || p.shop === null) return;
  const acc = asAccount(p);
  let shop: ShopState = p.shop;
  for (const a of actions) {
    if (a.type === 'buyModule') {
      // `buyModule` refuses an illegal ask without changing state — the human
      // seat is free to fumble; a bot's policy is not (M7).
      shop = buyModule(acc, shop, a.slot).shop;
    } else if (a.type === 'sellModule') {
      sellModule(acc, a.moduleId);
    } else if (a.type === 'refreshShop') {
      if (
        canRefreshShop(shop) &&
        acc.tokens >= SHOP_REFRESH_COST &&
        spendShopRefresh(acc, SHOP_REFRESH_COST)
      ) {
        shop = refreshShop(shop, accountLevels(acc), acc.owned, rng.stream(`shop:${p.id}`, round));
      }
    } else if (a.type === 'swapHero') {
      // Change-Hero swap-out (M8). Legal only if `outgoing` is active, `incoming`
      // is not, and the swap cost is covered; otherwise a no-op (the human seat
      // is free to fumble). `swapHeroAndConvertStrengthen` returns the outgoing
      // hero's Strengthen Modules to `selectable` — never auto-assigned.
      if (
        p.lineup.includes(a.outgoing) &&
        !p.lineup.includes(a.incoming) &&
        acc.tokens >= CHANGE_HERO_COST &&
        spendHeroSwap(acc, CHANGE_HERO_COST)
      ) {
        const res = swapHeroAndConvertStrengthen(
          { lineup: p.lineup.slice(), reserve: p.reserve.slice() },
          p.strengthen,
          a.incoming,
          a.outgoing,
        );
        p.lineup = [...res.lineup.lineup];
        p.reserve = [...res.lineup.reserve];
        p.strengthen = res.strengthen;
      }
    } else {
      shop = shop.locked ? unlockShop(shop) : lockShop(shop);
    }
  }
  commitAccount(p, acc);
  p.shop = shop;
}

/** Apply the human seat's `deploy` action, if the deployment is legal. */
function applyHumanDeployAction(work: WorkState, cells: readonly DeployCell[] | null): void {
  if (cells === null) return;
  const p = work.players.find((pp) => pp.isHuman);
  if (p === undefined || !p.alive) return;
  if (!isValidDeployment(cells, p.lineup.length)) return;
  p.deployment = cells.map((c) => ({ col: c.col, row: c.row }));
}

// ---------------------------------------------------------------------------
// Action consumption
// ---------------------------------------------------------------------------

interface Cursor {
  i: number;
}

/** The human seat's Module Draw actions, collected in order for the phase. */
type HumanShopAction =
  | { readonly type: 'buyModule'; readonly slot: number }
  | { readonly type: 'sellModule'; readonly moduleId: string }
  | { readonly type: 'refreshShop' }
  | { readonly type: 'lockShop' }
  | { readonly type: 'swapHero'; readonly incoming: string; readonly outgoing: string };

interface PhaseInput {
  /** true = player 0 confirmed; false = timed out / ran out of actions. */
  readonly confirmed: boolean;
  /** The last `selectLineup` seen this phase (draft only cares). */
  readonly lineup: readonly string[] | null;
  /** `refreshReward` count seen this phase (only 1 is honoured). Reward phase only. */
  readonly rewardRefreshes: number;
  /** `selectReward` module ids seen this phase, in order. Reward phase only. */
  readonly rewardPicks: readonly string[];
  /** `buyModule` / `sellModule` / `refreshShop` / `lockShop` seen this phase, in order. Module Draw only. */
  readonly shopActions: readonly HumanShopAction[];
  /** The last `deploy` action's cells this phase. Select Position only. */
  readonly deployCells: readonly DeployCell[] | null;
}

/**
 * Consume actions for the current phase: apply any `selectLineup`, collect any
 * `selectReward` / `refreshReward` / shop / `deploy` action (the owning phase
 * acts on them), then stop on the first `confirmPhase` (confirmed) or
 * `advanceTimer` (timed out). Running out of actions is an implicit timeout.
 * Unrecognised action types are skipped.
 */
function consumeUntilPhaseEnd(actions: readonly Action[], cur: Cursor): PhaseInput {
  let lineup: readonly string[] | null = null;
  let rewardRefreshes = 0;
  const rewardPicks: string[] = [];
  const shopActions: HumanShopAction[] = [];
  let deployCells: readonly DeployCell[] | null = null;
  const done = (confirmed: boolean): PhaseInput => ({
    confirmed,
    lineup,
    rewardRefreshes,
    rewardPicks,
    shopActions,
    deployCells,
  });
  while (cur.i < actions.length) {
    const act = actions[cur.i]!;
    cur.i++;
    if (act.type === 'selectLineup') {
      lineup = act.heroes.slice();
      continue;
    }
    if (act.type === 'refreshReward') {
      rewardRefreshes++;
      continue;
    }
    if (act.type === 'selectReward') {
      rewardPicks.push(act.moduleId);
      continue;
    }
    if (act.type === 'buyModule') {
      shopActions.push({ type: 'buyModule', slot: act.slot });
      continue;
    }
    if (act.type === 'sellModule') {
      shopActions.push({ type: 'sellModule', moduleId: act.moduleId });
      continue;
    }
    if (act.type === 'refreshShop') {
      shopActions.push({ type: 'refreshShop' });
      continue;
    }
    if (act.type === 'lockShop') {
      shopActions.push({ type: 'lockShop' });
      continue;
    }
    if (act.type === 'swapHero') {
      shopActions.push({ type: 'swapHero', incoming: act.incoming, outgoing: act.outgoing });
      continue;
    }
    if (act.type === 'deploy') {
      deployCells = act.cells.map((c) => ({ col: c.col, row: c.row }));
      continue;
    }
    if (act.type === 'confirmPhase') return done(true);
    if (act.type === 'advanceTimer') return done(false);
    // future action types: skip and keep consuming
  }
  return done(false);
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
  humanDroneInput?: DroneInputStream | null,
): CombatContext {
  const a = work.players[m.a]!;
  const sideA = {
    playerId: m.a,
    lineup: a.lineup.slice(),
    isPhantom: false,
    isGalactaBots: false,
    // M7 — this player's resolved modules + board deployment ride on the
    // context (the resolver takes `baseOpts` once and cannot be re-parametrised
    // per matchup). `SimulateOptions` still overrides for M5 direct tests.
    modules: sideModulesOf(a),
    deployment: deploymentOf(a),
  };

  let sideB: CombatContext['sideB'];
  if (m.kind === 'pve') {
    sideB = {
      playerId: -1,
      lineup: [],
      isPhantom: false,
      isGalactaBots: true,
      modules: null,
      deployment: null,
    };
  } else if (m.kind === 'phantom') {
    // An eliminated player's state is frozen at elimination, so their current
    // modules / deployment ARE their phantom modules / deployment.
    const owner = work.players[m.b]!;
    sideB = {
      playerId: m.b,
      lineup: (owner.phantomLineup ?? owner.lineup).slice(),
      isPhantom: true,
      isGalactaBots: false,
      modules: sideModulesOf(owner),
      deployment: deploymentOf(owner),
    };
  } else {
    // pvp or mirror — a copy of the opponent/source's living lineup + build
    const other = work.players[m.b]!;
    sideB = {
      playerId: m.b,
      lineup: other.lineup.slice(),
      isPhantom: false,
      isGalactaBots: false,
      modules: sideModulesOf(other),
      deployment: deploymentOf(other),
    };
  }

  // Drones (M6/M9). Side A is always a living player. `planMatchupDrones` applies
  // the AUTHORED mirror/phantom calls (mirror gets a policy opponent drone;
  // phantom and PvE do not). Every drone runs on the shared drone policy
  // (`dronePolicy.ts`) UNLESS this is the human's matchup and M9 handed us a
  // recorded per-tick stream via a `driveDrone` action — then the human's drone
  // replays that stream instead. Opponent drones stay on policy.
  const opponentForDrone =
    m.kind === 'pvp' || m.kind === 'mirror' || m.kind === 'phantom' ? work.players[m.b]! : null;
  let drones: readonly DroneSpec[] = planMatchupDrones({
    matchupKind: m.kind,
    a: { playerId: m.a, colour: a.droneColour, health: a.health },
    b:
      opponentForDrone === null
        ? null
        : {
            playerId: m.b,
            colour: opponentForDrone.droneColour,
            health: opponentForDrone.health,
          },
  });
  if (humanDroneInput !== undefined && humanDroneInput !== null) {
    const humanId = work.players.find((p) => p.isHuman)?.id;
    if (humanId !== undefined) {
      drones = drones.map((d) => (d.playerId === humanId ? { ...d, input: humanDroneInput } : d));
    }
  }

  return {
    round,
    roundType: roundTypeOf(round),
    matchupKind: m.kind,
    sideA,
    sideB,
    rng: rng.stream(`combat:${m.kind}:${m.a}:${m.b}`, round),
    drones,
  };
}

/**
 * M9 — rebuild the human seat's `CombatContext` for the current round's Battle
 * Phase from a PRE-BATTLE boundary state (the `selectPosition` phase, phase 2)
 * plus the resolved matchup (read from the `battle` boundary's `state.matchups`).
 * The renderer drives a stepped `simulateBattle` on this so what the player sees
 * IS what `runMatch` will resolve once the recorded `driveDrone` stream is
 * threaded back in: substream seeds are pure `deriveSeed(masterSeed, key)`, so a
 * fresh `RngStream(seed)` lands the `combat:*` substream on the identical seed.
 */
export function humanBattleContext(
  preBattleState: MatchState,
  matchup: { readonly kind: MatchupKind; readonly a: number; readonly b: number },
  humanDroneInput: DroneInputStream | null,
): CombatContext {
  const work = preBattleState as unknown as WorkState;
  const rng = new RngStream(preBattleState.seed);
  const m: WorkMatchup = {
    kind: matchup.kind,
    a: matchup.a,
    b: matchup.b,
    resultA: null,
    survivingUnits: null,
    healthLossA: 0,
    healthLossB: 0,
  };
  return combatContextFor(work, rng, preBattleState.round, m, humanDroneInput);
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
  humanDroneInput?: DroneInputStream | null,
): boolean {
  const round = work.round;
  const matchups = buildMatchups(work, rng, round);
  work.matchups = matchups;

  const humanId = work.players.find((p) => p.isHuman)?.id ?? -1;

  // Resolve via the injected resolver. The human's own matchup replays the M9
  // recorded drone stream when one was supplied; every other matchup, and every
  // opponent drone, stays on the shared policy.
  for (const m of matchups) {
    const forHuman = m.a === humanId || m.b === humanId ? humanDroneInput : null;
    const outcome = combat.resolve(combatContextFor(work, rng, round, m, forHuman));
    m.resultA = outcome.result;
    m.survivingUnits = clampSurvivors(outcome.survivingUnits);
  }

  // Health deltas. The DERIVED formula depends only on round + survivors, so
  // order does not matter. A Practice (PvE) round is health-neutral — the plan
  // says only PvP losses cost health (authored: PVE_LOSS_COSTS_HEALTH = false),
  // consistent with M3's PvP-only streak decision.
  for (const m of matchups) {
    if (m.resultA === null || m.survivingUnits === null) continue;
    if (m.kind === 'pve' && !PVE_LOSS_COSTS_HEALTH) continue;
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
  // health, so capture it before `applyLoss`. `applyBattleResolution` only ever
  // credits `tokens`, so `creditLedger` folds the whole delta into `earned`.
  const tokensBeforeResolution = work.players.map((p) => p.tokens);
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
  creditLedger(work, tokensBeforeResolution);

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
// Practice reward phase (phase 4) — grant Strengthen Modules (M6)
// ---------------------------------------------------------------------------

/**
 * Grant every living player their Practice-round Strengthen picks
 * (`PRACTICE_REWARD_COUNTS`). Rounds 11/16/21 pay 2 as ONE offer set of three,
 * select two (`STRENGTHEN_REWARD_MULTI_MODE`). Player 0's `selectReward` /
 * `refreshReward` actions (collected by `consumeUntilPhaseEnd`) steer their
 * offers; every other player — and any shortfall for player 0 — is auto-filled
 * deterministically from the offer set. Granted regardless of the PvE outcome
 * unless `STRENGTHEN_REWARD_REQUIRES_WIN` is set.
 */
function runRewardPhase(
  work: WorkState,
  rng: RngStream,
  round: number,
  humanRefreshes: number,
  humanPicks: readonly string[],
): void {
  const tier = (PRACTICE_ROUNDS as readonly number[]).indexOf(round);
  if (tier < 0) return;
  const needed = PRACTICE_REWARD_COUNTS[tier] ?? 0;
  if (needed <= 0) return;

  for (const p of work.players) {
    if (!p.alive) continue;
    if (STRENGTHEN_REWARD_REQUIRES_WIN && p.lastRoundResult !== 'win') continue;

    const owned = strengthenOwnedIds(p.strengthen);
    const sub = rng.stream(`reward:${p.id}`, round);
    let state = openStrengthenReward(round, needed, p.lineup, owned, sub);

    if (p.isHuman) {
      if (humanRefreshes > 0) state = refreshStrengthenReward(state, p.lineup, owned, sub);
      for (const id of humanPicks) state = pickStrengthenReward(state, id);
    }
    state = autoFillStrengthenReward(state);

    p.strengthen = grantStrengthenPicks(p.strengthen, state.picks);
  }
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

  // ---- Seat → AI policy (M7). `null` = a human seat driven by the action list.
  const { policies, humanSeat } = resolveSeatPolicies(masterSeed, options.ai);

  const rng = new RngStream(masterSeed);
  const work = initState(masterSeed, humanSeat);
  const boundaries: PhaseBoundary[] = [];
  const cursor: Cursor = { i: 0 };

  // ---- Draft ----
  assignPools(work, rng);
  // Each player's Ultron Drone colour — one canonical colour each, drawn once per
  // match from a single named substream (isolated: adding it shifts no other roll).
  assignDroneColours(rng.stream('drone-colour', 0), PLAYER_COUNT).forEach((colour, i) => {
    work.players[i]!.droneColour = colour;
  });
  for (const p of work.players) {
    if (p.isHuman) continue;
    // M7 — every non-human seat drafts through its archetype policy, from the
    // per-seat `ai:<id>#0` substream. A seat with no policy (only possible for
    // seat 0 when it is neither human nor listed) falls back to `balancedDraft`.
    const policy = policies.get(p.id);
    const sub = rng.stream(`ai:${p.id}`, 0);
    setLineup(
      p,
      policy !== undefined
        ? policy.draftLineup({ pool: p.pool.slice(), roleOf: ROLE_OF, rng: sub })
        : balancedDraft(p.pool, ROLE_OF, sub),
      'auto',
    );
  }
  const draftInput = consumeUntilPhaseEnd(actions, cursor);
  work.humanConfirmedPhase = draftInput.confirmed;
  const humanPlayer = work.players.find((p) => p.isHuman);
  if (humanPlayer !== undefined) {
    if (draftInput.lineup !== null && isValidLineup(draftInput.lineup, humanPlayer.pool)) {
      setLineup(humanPlayer, draftInput.lineup, 'human');
    } else {
      setLineup(humanPlayer, balancedDraft(humanPlayer.pool, ROLE_OF, rng.stream('human', 0)), 'auto');
    }
  }
  work.actionCursor = cursor.i;
  pushBoundary(boundaries, work, rng, 0, 0, 'draft');

  // M9 — the human's recorded per-round drone streams. Collected up front (not
  // via the phase cursor) because a round's battle resolves at the START of its
  // Battle Phase, before that phase's actions are consumed. Last write per round
  // wins. An empty / driveDrone-free action list leaves this map empty and the
  // human drone on policy — every pre-M9 golden is byte-identical.
  const humanDroneInputs = new Map<number, DroneInputStream>();
  for (const act of actions) {
    if (act.type === 'driveDrone') humanDroneInputs.set(act.round, act.input);
  }

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
        // Round-start income: base -> interest -> streak, for every living
        // player. No-op on round 1 (the `1-1` screenshot shows every player at
        // <>10). `applyRoundStartIncome` only credits `tokens`, so the whole
        // delta folds into each ledger's `earned`.
        const tokensBeforeIncome = work.players.map((p) => p.tokens);
        applyRoundStartIncome(work);
        creditLedger(work, tokensBeforeIncome);
        // M7 — open every living player's shop for this round (carry-over from a
        // locked set honoured); each bot then runs its archetype's shop turn.
        openShopsForRound(work, rng, round, policies);
      }
      if (work.phaseKind === 'selectPosition') {
        // M7 — each bot places its lineup on the 6×4 board.
        runBotDeploys(work, rng, round, policies);
      }

      const matchFinished = work.phaseKind === 'battle'
        ? runBattlePhase(work, rng, combat, maxRounds, humanDroneInputs.get(round) ?? null)
        : false;

      const input = consumeUntilPhaseEnd(actions, cursor);
      work.humanConfirmedPhase = input.confirmed;
      work.actionCursor = cursor.i;

      if (work.phaseKind === 'moduleDraw') {
        applyHumanShopActions(work, input.shopActions, rng, round);
      }
      if (work.phaseKind === 'battle') {
        // M9 — `B MODULES` mid-battle. This round's combat has already resolved
        // above, so a purchase here lands in `ownedModules` for NEXT round's
        // battle-start `ResolvedUnit` freeze (M4): "effects apply next round".
        applyHumanShopActions(work, input.shopActions, rng, round);
      }
      if (work.phaseKind === 'selectPosition') {
        applyHumanDeployAction(work, input.deployCells);
      }
      if (work.phaseKind === 'reward') {
        runRewardPhase(work, rng, round, input.rewardRefreshes, input.rewardPicks);
      }

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
