/*
 * The simulation state contract, the action vocabulary, the injected-combat
 * interface, and canonical serialization.
 *
 * DESIGN RULE — the state must be byte-comparable at every phase boundary, so
 * `MatchState` and everything it contains is *plain JSON data*: no class
 * instances, no `Map` / `Set`, no `Date`, and no "`undefined` vs absent"
 * ambiguity (every optional-looking field is `T | null` and always present).
 * `serializeState` sorts keys recursively; `hashState` digests that.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no `ui/` / `render/` imports.
 */

import type { Protocol } from '../data/types';
import type { RngSnapshot, Substream } from './rng';
import { hash128Hex } from './rng';
import type { DroneColour, DroneSpec } from './drone';
import type { OwnedModule, ShopState, StrengthenInventory } from './modules';
import type { SideModules } from './stats';
import type { Deployment, DeployCell } from './board';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type RoundType = 'practice' | 'battle';

/**
 * `draft` is the pre-round lineup selection (round 0). The three numbered
 * battle-round phases are `moduleDraw` (1), `selectPosition` (2), `battle` (3);
 * Practice rounds append `reward` (4).
 */
export type PhaseKind = 'draft' | 'moduleDraw' | 'selectPosition' | 'battle' | 'reward';

/**
 * How a living player's round is contested:
 *   pvp     — two living players
 *   pve     — a living player vs the Galacta Bots (Practice rounds; health-neutral)
 *   phantom — the odd-one-out vs an eliminated player's lineup, frozen at elimination
 *   mirror  — the odd-one-out vs a copy of a living opponent's lineup
 * Precedence for the odd-one-out is documented in `match.ts`.
 */
export type MatchupKind = 'pvp' | 'pve' | 'phantom' | 'mirror';

export type BattleResult = 'win' | 'loss' | 'tie';

/**
 * The *kind* of the player's current PvP win/loss streak. `none` until the first
 * non-tie PvP result is recorded; a PvP tie never changes it. Distinct from
 * `lastRoundResult`, which is the literal most-recent round outcome — after a
 * tie that reads `tie` while `streakKind` still holds the surviving streak.
 */
export type StreakKind = 'win' | 'loss' | 'none';

export type MatchStatus = 'drafting' | 'inRound' | 'complete';

export type LineupSource = 'human' | 'auto';

// ---------------------------------------------------------------------------
// Actions — the ordered input list `runMatch` consumes (player 0 / the human)
// ---------------------------------------------------------------------------

/** Draft only: choose 6 hero ids from the player's 18-hero pool. */
export interface SelectLineupAction {
  readonly type: 'selectLineup';
  readonly heroes: readonly string[];
}

/** "Ready up" — player 0 confirms the current phase (mirrors the in-game confirm). */
export interface ConfirmPhaseAction {
  readonly type: 'confirmPhase';
}

/** The phase countdown expired before player 0 confirmed. */
export interface AdvanceTimerAction {
  readonly type: 'advanceTimer';
}

/** Reward phase (phase 4): pick a Strengthen Module from the current offer set. */
export interface SelectRewardAction {
  readonly type: 'selectReward';
  /** A Strengthen Module id currently on offer (e.g. `"loki-s1"`). */
  readonly moduleId: string;
}

/** Reward phase (phase 4): spend the one free `REFRESH 1/1`. A second is ignored. */
export interface RefreshRewardAction {
  readonly type: 'refreshReward';
}

/**
 * Module Draw phase: buy (or upgrade) the module in shop slot `slot`. The sim
 * routes it through `modules.buyModule`, which refuses an illegal ask (empty
 * slot, unaffordable, maxed, rarity-locked) without changing state — the human
 * seat is free to fumble; a bot's policy must not (M7).
 */
export interface BuyModuleAction {
  readonly type: 'buyModule';
  readonly slot: number;
}

/** Module Draw phase: sell an owned Base Module outright (refund + XP removal). */
export interface SellModuleAction {
  readonly type: 'sellModule';
  readonly moduleId: string;
}

/** Module Draw phase: `REFRESH ◇1` — redraw the four shop cards (no-op while locked). */
export interface RefreshShopAction {
  readonly type: 'refreshShop';
}

/** Module Draw phase: toggle `LOCK` / `UNLOCK` on the current shop. */
export interface LockShopAction {
  readonly type: 'lockShop';
}

/**
 * Select Position phase: place the six lineup heroes on the 6×4 board.
 * `cells[i]` is where lineup hero `i` stands. An invalid deployment (wrong
 * count, off-grid, double-occupied) is ignored and the engine formation stands.
 */
export interface DeployAction {
  readonly type: 'deploy';
  readonly cells: readonly DeployCell[];
}

/**
 * Module Draw phase (M8): swap `outgoing` (a hero in the active lineup) for
 * `incoming` (a hero NOT in the lineup). The Change-Hero role-offer flow that
 * decides the candidate set is a UI concern; the sim only validates legality
 * (`outgoing` active, `incoming` not, `tokens >= CHANGE_HERO_COST`), charges the
 * swap cost, and converts the outgoing hero's equipped Strengthen Modules back
 * to selectable ones (`modules.swapHeroAndConvertStrengthen`). Ignored outside
 * Module Draw. Unlike a mid-battle swap, this one is applied to the working
 * lineup immediately — the "takes effect next round" deferral is not modelled
 * here (documented in the M8 report).
 */
export interface SwapHeroAction {
  readonly type: 'swapHero';
  readonly incoming: string;
  readonly outgoing: string;
}

/**
 * The action vocabulary. Later milestones extend this union in place — the
 * machine already skips any action it does not recognise for the current phase,
 * so adding members is non-breaking:
 *   M8: swapHero (Module Draw) — the Change-Hero / swap-out screens. The role
 *       offer set is chosen in the UI (`sim/selectors.changeHeroOfferIds`); the
 *       action carries only the resolved incoming/outgoing pair.
 *   M7: buyModule / sellModule / refreshShop / lockShop (Module Draw) · deploy
 *       (Select Position).
 *   M6: selectReward / refreshReward (the Practice reward phase)
 *   M9: driveDrone (per-tick live capture — recorded input for the sim's drone seam)
 */
export type Action =
  | SelectLineupAction
  | ConfirmPhaseAction
  | AdvanceTimerAction
  | SelectRewardAction
  | RefreshRewardAction
  | BuyModuleAction
  | SellModuleAction
  | RefreshShopAction
  | LockShopAction
  | DeployAction
  | SwapHeroAction;

// ---------------------------------------------------------------------------
// Injected combat — M2 ships a stub; M5 swaps in the real resolver, untouched
// ---------------------------------------------------------------------------

export interface CombatSide {
  /** Living player id, or `-1` for the PvE Galacta Bot side. */
  readonly playerId: number;
  /**
   * The hero-id list actually fighting for this side — already resolved to the
   * living lineup, a mirror copy, or a frozen phantom lineup. Empty for the
   * Galacta Bot side (the resolver supplies the wave).
   */
  readonly lineup: readonly string[];
  /** True when this side is an eliminated player's frozen lineup. */
  readonly isPhantom: boolean;
  /** True for the PvE Galacta Bot side. */
  readonly isGalactaBots: boolean;
  /**
   * M7 — this side's owned Base Modules + protocol levels, resolved by
   * `match.ts` from the player's `ownedModules` / `protocolXp` at battle start.
   * `null` / absent for the Galacta Bot side and for M5 direct tests;
   * `SimulateOptions.sideAModules` / `.sideBModules` still override it.
   */
  readonly modules?: SideModules | null;
  /**
   * M7 — this side's 6-cell board deployment (index = lineup slot). `null` /
   * absent means "use the engine formation" (`assignFormation`). `combat.ts`
   * resolves it on the `selectPosition` seam; `SimulateOptions.place` still
   * runs after and can override for tests.
   */
  readonly deployment?: Deployment | null;
}

export interface CombatContext {
  readonly round: number;
  readonly roundType: RoundType;
  readonly matchupKind: MatchupKind;
  /** Side A is always a living player; the result is reported from A's view. */
  readonly sideA: CombatSide;
  readonly sideB: CombatSide;
  /**
   * This matchup's own deterministic, round-scoped RNG substream. Draw as much
   * as needed — substream isolation keeps neighbouring matchups unaffected.
   */
  readonly rng: Substream;
  /**
   * The Ultron Drones over this battle (M6). `match.ts` builds this per matchup
   * via `planMatchupDrones`; the M5 direct-test path omits it. `SimulateOptions.drones`
   * overrides it when both are present.
   */
  readonly drones?: readonly DroneSpec[];
}

export interface CombatOutcome {
  /** From side A's perspective. */
  readonly result: BattleResult;
  /**
   * Units still standing on the side that inflicted the loss (1..6). Feeds M2's
   * DERIVED HP-loss formula as `survivingEnemyUnits`. On a `tie` the resolver
   * reports the larger of the two sides' survivor counts — the plan's tie
   * formula takes a single `loss`, so one number is sufficient.
   */
  readonly survivingUnits: number;
  /**
   * Both sides' surviving unit counts (0..6). Optional so the M2 stub and the
   * hand-rolled test resolvers stay valid; the real M5 resolver always fills
   * them. M9's HUD and any "loser's-perspective survivor count" caller read
   * these; `match.ts` needs only `survivingUnits`.
   */
  readonly survivorsSideA?: number;
  readonly survivorsSideB?: number;
}

/** M5 provides a real implementation; M2 provides `createStubCombatResolver()`. */
export interface CombatResolver {
  resolve(ctx: CombatContext): CombatOutcome;
}

// ---------------------------------------------------------------------------
// State tree
// ---------------------------------------------------------------------------

/**
 * M7 — the running token ledger that backs the conservation invariant
 * (`modules.conserves`: `earned + refunded === spent + tokens`). `match.ts`
 * folds every economy credit into `earned` and routes every module debit /
 * refund through the `ModuleAccount` adapter, which writes `spent` / `refunded`
 * here. `PlayerState.tokens` stays the single source of truth for the balance.
 */
export interface TokenLedger {
  /** Starting tokens + all round income + HP compensation + PvP win bonuses. */
  readonly earned: number;
  /** All module purchases + shop refreshes + hero swaps. */
  readonly spent: number;
  /** All module sell refunds. */
  readonly refunded: number;
}

export interface PlayerState {
  readonly id: number;
  readonly name: string;
  readonly isHuman: boolean;

  readonly alive: boolean;
  /** Current health, floored at 0. A living player is always `> 0`. */
  readonly health: number;
  /**
   * Raw health at the instant of elimination (`<= 0`, may be negative); `null`
   * while alive. Used only to order a simultaneously-eliminated batch.
   */
  readonly eliminationHealth: number | null;
  /**
   * Spendable tokens. Round-start income, HP compensation and the +2 PvP win
   * bonus all move this (see `sim/economy.ts`); `economy.spend()` is the only
   * sanctioned debit and never lets it go negative.
   */
  readonly tokens: number;
  readonly placement: number | null;
  readonly eliminatedRound: number | null;

  /** The 18-hero pool (6 Vanguards + 6 Duelists + 6 Strategists). */
  readonly pool: readonly string[];
  /** The chosen 6. Empty until the draft resolves. */
  readonly lineup: readonly string[];
  /** The 12 unpicked. Empty until the draft resolves. */
  readonly reserve: readonly string[];
  readonly lineupSource: LineupSource;

  /** Lineup frozen at elimination, used when this player is a phantom opponent. */
  readonly phantomLineup: readonly string[] | null;

  /**
   * Opponent ids from recent rounds, most recent last (bounded history). `-1`
   * marks a round with no living opponent (PvE / phantom / mirror). The pairing
   * avoidance heuristic looks at the last two entries.
   */
  readonly recentOpponents: readonly number[];
  readonly lastRoundResult: BattleResult | 'none';

  /**
   * Consecutive same-result PvP streak counter. `0` while `streakKind` is
   * `none` (no non-tie PvP result yet). The first win/loss sets it to
   * `STREAK_START` (1); each consecutive same-kind result adds `STREAK_STEP`;
   * an opposite result resets it to `STREAK_START`; a PvP tie leaves it. The
   * round-start income bonus is `min(streak, STREAK_BONUS_CAP)`.
   */
  readonly streak: number;
  readonly streakKind: StreakKind;

  /**
   * This player's Ultron Drone colour — one of the canonical six, drawn once per
   * match from the `drone-colour` substream. State only; rendering is M9.
   */
  readonly droneColour: DroneColour;

  /**
   * Strengthen Modules held (M6). `equipped` maps a lineup hero id to the
   * Strengthen ids on it; `selectable` holds ids returned to the pool by a hero
   * swap (M4's conversion path). The left-rail count is `equipped-total + selectable`.
   * In a headless `runMatch` (no swap actions wired) `selectable` stays empty.
   */
  readonly strengthen: StrengthenInventory;

  /**
   * M7 — Base Modules owned, `{ moduleId, stars }`. Empty until the first
   * purchase. Fed into combat as this player's `SideModules` at battle start.
   */
  readonly ownedModules: readonly OwnedModule[];
  /**
   * M7 — accumulated protocol XP per protocol. Level is derived
   * (`modules.levelsFromXp`); a sell can drop it. `{ 0, 0, 0, 0 }` at start.
   */
  readonly protocolXp: Readonly<Record<Protocol, number>>;
  /**
   * M7 — this player's shop, reopened every Module Draw phase from a
   * per-player, per-round substream (`shop:<id>#round`). `null` before the
   * first is opened; a locked shop carries into the next round then unlocks
   * (`SHOP_LOCK_BEHAVIOUR`).
   */
  readonly shop: ShopState | null;
  /**
   * M7 — the token ledger (see `TokenLedger`). Present from the draft boundary
   * on, so `conserves` is checkable at every phase boundary.
   */
  readonly tokenLedger: TokenLedger;
  /**
   * M7 — this player's 6-cell board deployment (index = lineup slot), set on
   * the `selectPosition` phase. `null` = the engine formation
   * (`combat.assignFormation`), which is the human seat's default.
   */
  readonly deployment: Deployment | null;
}

export interface Matchup {
  readonly kind: MatchupKind;
  /** Living player id. */
  readonly a: number;
  /**
   * pvp: the living opponent. phantom: the eliminated owner. mirror: the living
   * source. pve: `-1`.
   */
  readonly b: number;
  /** Result from A's perspective; `null` until the battle phase resolves it. */
  readonly resultA: BattleResult | null;
  /** Surviving-unit count that fed the HP-loss formula; `null` until resolved. */
  readonly survivingUnits: number | null;
  readonly healthLossA: number;
  /** PvP only — a mirror/phantom/PvE opponent never loses health. */
  readonly healthLossB: number;
}

export interface MatchState {
  readonly seed: number;
  readonly status: MatchStatus;

  /** 0 during the draft, then 1.. */
  readonly round: number;
  /** 0 during the draft, then 1..(3 | 4). */
  readonly phase: number;
  readonly phaseKind: PhaseKind;
  /** Reflects `round`; a placeholder (`battle`) during the draft — read `phaseKind`. */
  readonly roundType: RoundType;

  /** Did player 0 confirm the current phase, or did it time out / auto-advance? */
  readonly humanConfirmedPhase: boolean;
  /** How many entries of the action list have been consumed. */
  readonly actionCursor: number;

  readonly players: readonly PlayerState[];
  /** The current round's matchups; `[]` outside a battle phase. */
  readonly matchups: readonly Matchup[];

  readonly rng: RngSnapshot;
  readonly winnerId: number | null;
}

// ---------------------------------------------------------------------------
// runMatch surface
// ---------------------------------------------------------------------------

export interface RunMatchOptions {
  /**
   * Round ceiling. Defaults to the canonical `ROUND_CAP` (from `authored.ts`).
   * Overridable ONLY so the round-cap -> resolve-by-health path can be
   * integration-tested without a degenerate full-length match; production
   * callers never set it.
   */
  readonly maxRounds?: number;
  /**
   * M7 — AI policy assignment.
   *   `undefined` (default): seat 0 is the human (the action list), seats 1..5
   *     are bots whose archetypes rotate by seed (`AI_SEAT_ROTATION`).
   *   `'aiOnly'`: seat 0 is also a bot (the rotation includes it, `isHuman`
   *     goes false) — the mode the 100-match distribution gate runs in.
   *   `Record<seatId, ArchetypeName>`: pin specific seats; naming seat 0 makes
   *     it a bot. Unnamed non-human seats fall back to the seed rotation.
   */
  readonly ai?: 'aiOnly' | Readonly<Record<number, string>>;
}

export interface PhaseBoundary {
  readonly round: number;
  readonly phase: number;
  /** `draft` for the pre-round boundary; otherwise exactly `${round}-${phase}`. */
  readonly label: string;
  readonly kind: PhaseKind;
  /** `hashState(state)`, hoisted for cheap comparison across replays. */
  readonly hash: string;
  readonly state: MatchState;
}

export interface MatchResult {
  readonly finalState: MatchState;
  /** One entry per phase boundary crossed, in order (the draft boundary first). */
  readonly boundaries: readonly PhaseBoundary[];
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON with recursively sorted keys. */
export function serializeState(state: MatchState): string {
  return JSON.stringify(sortDeep(state));
}

/** Local, non-crypto 128-bit digest of the canonical serialization. */
export function hashState(state: MatchState): string {
  return hash128Hex(serializeState(state));
}
