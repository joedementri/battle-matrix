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

import type { RngSnapshot, Substream } from './rng';
import { hash128Hex } from './rng';

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

/**
 * The M2 action vocabulary. Later milestones extend this union in place — the
 * machine already skips any action it does not recognise for the current phase,
 * so adding members is non-breaking:
 *   M4: buyModule / sellModule / refreshShop / lockShop / changeHero / swapHero
 *   M6: deployUnit / fireDroneAbility / selectReward
 */
export type Action = SelectLineupAction | ConfirmPhaseAction | AdvanceTimerAction;

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
