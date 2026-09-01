/*
 * The economy engine: round-start income (base -> interest -> streak bonus), the
 * win/loss streak counter, the +2 PvP win bonus, and HP compensation. Plus
 * `previewIncome` — the single source of truth for the HUD's `<>N (+M)` preview
 * (M8 asserts the HUD equals it) — and `spend`, the only sanctioned debit, which
 * refuses an unaffordable spend rather than clamping.
 *
 * FIVE THINGS THE PLAN INVITES YOU TO GET WRONG, resolved here on purpose:
 *   1. Interest is on the balance held BEFORE base income is added.
 *      `previewIncome` for 10 tokens = 15 + floor(10/10) = 16, not floor(25/10).
 *   2. The streak counter is 0 (`streakKind: 'none'`) before any PvP result. The
 *      economy table's "starts at 1" means the first RECORDED result reads 1 —
 *      which is why both round-1 previews (`+16`, `+15`) carry no streak bonus.
 *   3. Round 1 grants no income (`FIRST_ROUND_WITH_INCOME`). The `1-1` screenshot
 *      shows every player at <>10; `previewIncome` there previews the round-2 grant.
 *   4. The +2 PvP win bonus is granted at battle resolution, not round start
 *      (PVP_WIN_TOKEN_BONUS_TIMING) — so no observed preview includes it.
 *   5. HP compensation pays +1 per health ACTUALLY lost after the floor at 0
 *      (HP_COMPENSATION_CLAMP) — 3 HP hit for a raw 5 is compensated 3.
 *
 * NUMBERS: every canonical value (base income, interest divisor, streak cap,
 * per-HP compensation) imports from `src/data/constants`; every authored or
 * still-open value (interest cap, +2 bonus and its timing, the M3 ambiguity
 * calls) imports from `src/data/authored`. Nothing numeric is retyped here.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 * `applyRoundStartIncome` / `applyBattleResolution` / `spend` mutate `tokens` /
 * `streak` / `streakKind` on the working state in place; `previewIncome` /
 * `interest` only read.
 */

import {
  BASE_INCOME,
  HEALTH_COMPENSATION_PER_HP,
  INTEREST_PER_TOKENS,
  INTEREST_RATE,
  STREAK_BONUS_CAP,
  STREAK_START,
  STREAK_STEP,
} from '../data/constants';
import {
  HP_COMPENSATION_CLAMP,
  INTEREST_CAP,
  PHANTOM_MIRROR_TIE_ADVANCES_LOSS_STREAK,
  PHANTOM_MIRROR_WIN_PAYS,
  PVE_TOUCHES_STREAK,
  PVP_WIN_TOKEN_BONUS,
  PVP_WIN_TOKEN_BONUS_TIMING,
  TIE_STREAK_BEHAVIOUR,
} from '../data/authored';
import type { BattleResult, MatchupKind, StreakKind } from './types';

// ---------------------------------------------------------------------------
// Views — the minimal shape the engine reads / writes. `MatchState` (for
// `previewIncome`) and `match.ts`'s internal working state both satisfy these.
// ---------------------------------------------------------------------------

export interface EconomyPlayerView {
  readonly id: number;
  readonly alive: boolean;
  tokens: number;
  streak: number;
  streakKind: StreakKind;
}

export interface EconomyStateView {
  readonly round: number;
  readonly players: readonly EconomyPlayerView[];
}

// ---------------------------------------------------------------------------
// M3-local structural facts (not values M1 owns)
// ---------------------------------------------------------------------------

/**
 * The first round that pays income. Round 1 grants none: every player is still
 * at STARTING_TOKENS on the `1-1` screenshot (<>10), not <>10 + 15 + interest.
 * The preview shown during round 1 is forward-looking — it previews the round-2
 * grant. Falls out of "start at <>10" + "base income at the start of every
 * round" + the 1-1 screenshot; not itself a number M1 owns.
 */
const FIRST_ROUND_WITH_INCOME = 2;

/** Whether the +2 PvP win bonus lands at battle resolution (vs. round start). */
const WIN_BONUS_AT_RESOLUTION = PVP_WIN_TOKEN_BONUS_TIMING === 'atBattleResolution';

// ---------------------------------------------------------------------------
// Income breakdown
// ---------------------------------------------------------------------------

export interface IncomeBreakdown {
  readonly base: number;
  readonly interest: number;
  readonly streak: number;
  /** Always `base + interest + streak`. */
  readonly total: number;
}

const ZERO_INCOME: IncomeBreakdown = { base: 0, interest: 0, streak: 0, total: 0 };

/**
 * Interest on a held balance: `min(floor(tokens / 10), cap)`. Computed on the
 * balance held *before* base income is added — `10 (+16)` is `15 + floor(10/10)`,
 * not `15 + floor(25/10)`. Non-positive balances earn nothing.
 */
export function interest(tokens: number): number {
  if (tokens <= 0) return 0;
  const raw = Math.floor(tokens / INTEREST_PER_TOKENS) * INTEREST_RATE;
  return Math.min(raw, INTEREST_CAP);
}

/** The streak component of income: 0 with no streak, else `min(count, cap)`. */
export function streakBonus(kind: StreakKind, count: number): number {
  if (kind === 'none') return 0;
  return Math.min(count, STREAK_BONUS_CAP);
}

/**
 * The income a player would receive at the next round start, as a breakdown that
 * sums to `total`. Forward-looking and total: an eliminated or unknown player is
 * all zeros. The single source of truth for the HUD `<>N (+M)` preview.
 *
 * The +2 PvP win bonus is deliberately absent — it lands at battle resolution
 * (PVP_WIN_TOKEN_BONUS_TIMING), which is why no observed preview (`+16`, `+15`,
 * `+19`) includes it. If that flag is ever set to a round-start reading, this
 * breakdown gains a fifth term for players whose `streakKind` is `'win'`.
 */
export function previewIncome(state: EconomyStateView, playerId: number): IncomeBreakdown {
  const p = state.players[playerId];
  if (p === undefined || !p.alive) return ZERO_INCOME;
  const base = BASE_INCOME;
  const interestPart = interest(p.tokens);
  const streakPart = streakBonus(p.streakKind, p.streak);
  return {
    base,
    interest: interestPart,
    streak: streakPart,
    total: base + interestPart + streakPart,
  };
}

/**
 * Grant round-start income to every living player: base -> interest -> streak,
 * summed in that order. Interest is always on the pre-income balance; the order
 * only fixes how the total is narrated. Round 1 grants nothing. Eliminated
 * players are skipped entirely — no income, no interest, no streak progression.
 */
export function applyRoundStartIncome(state: EconomyStateView): void {
  if (state.round < FIRST_ROUND_WITH_INCOME) return;
  for (const p of state.players) {
    if (!p.alive) continue;
    p.tokens += previewIncome(state, p.id).total;
  }
}

// ---------------------------------------------------------------------------
// Battle resolution — streak, +2 win bonus, HP compensation
// ---------------------------------------------------------------------------

export interface PlayerBattleOutcome {
  /** The player this outcome belongs to (side A, or side B of a PvP pair). */
  readonly playerId: number;
  /** Result from THIS player's perspective; `null` if the matchup did not resolve. */
  readonly result: BattleResult | null;
  readonly matchupKind: MatchupKind;
  /** This player's health immediately before the raw round loss was applied. */
  readonly healthBefore: number;
  /** The raw HP-loss the M2 formula assigned to this player (`>= 0`). */
  readonly rawHealthLoss: number;
}

function advanceStreak(p: EconomyPlayerView, kind: 'win' | 'loss'): void {
  if (p.streakKind === kind) {
    p.streak += STREAK_STEP;
  } else {
    p.streakKind = kind;
    p.streak = STREAK_START;
  }
}

/**
 * Tokens owed for health lost this round: `HEALTH_COMPENSATION_PER_HP` per point,
 * over the health ACTUALLY removed. `'actualHealthLost'` clamps a killing blow to
 * `healthBefore` (a player on 3 HP hit for a raw 5 is paid for 3); a config of
 * `'rawLossAmount'` would pay the unclamped formula output.
 */
export function hpCompensation(healthBefore: number, rawHealthLoss: number): number {
  if (rawHealthLoss <= 0) return 0;
  const lost =
    HP_COMPENSATION_CLAMP === 'actualHealthLost'
      ? Math.min(rawHealthLoss, Math.max(0, healthBefore))
      : rawHealthLoss;
  return lost * HEALTH_COMPENSATION_PER_HP;
}

/**
 * Fold one player's round result into the economy: HP compensation for health
 * actually lost, the +2 PvP win bonus (at resolution), and streak progression.
 *
 * Health itself is applied by `match.ts` before this runs; `healthBefore` and
 * `rawHealthLoss` are handed over so compensation can be clamped here rather
 * than reimplementing M2's HP-loss formula.
 *
 * Streak rules, all pinned by an `authored.ts` constant:
 *   - PvP win  -> advance WIN streak (+ PVP_WIN_TOKEN_BONUS if at resolution)
 *   - PvP loss -> advance LOSS streak
 *   - PvP tie  -> TIE_STREAK_BEHAVIOUR (default: unchanged)
 *   - PvE      -> PVE_TOUCHES_STREAK (default: no effect)
 *   - phantom/mirror win  -> PHANTOM_MIRROR_WIN_PAYS (default: nothing at all)
 *   - phantom/mirror loss -> advance LOSS streak (a phantom loss is a real loss)
 *   - phantom/mirror tie  -> PHANTOM_MIRROR_TIE_ADVANCES_LOSS_STREAK (default:
 *                            advance LOSS streak — the phantom ruling overrides
 *                            the general "tie is unchanged" rule for solo bouts)
 */
export function applyBattleResolution(
  state: EconomyStateView,
  outcome: PlayerBattleOutcome,
): void {
  const p = state.players[outcome.playerId];
  if (p === undefined || !p.alive) return;

  // HP compensation is independent of win/loss — a tie that costs health pays too.
  p.tokens += hpCompensation(outcome.healthBefore, outcome.rawHealthLoss);

  const { result, matchupKind } = outcome;
  if (result === null) return;

  if (matchupKind === 'pve') {
    if (PVE_TOUCHES_STREAK && result !== 'tie') advanceStreak(p, result);
    return;
  }

  const isSolo = matchupKind === 'phantom' || matchupKind === 'mirror';

  if (result === 'tie') {
    if (isSolo && PHANTOM_MIRROR_TIE_ADVANCES_LOSS_STREAK) {
      advanceStreak(p, 'loss');
    } else if (TIE_STREAK_BEHAVIOUR === 'breakToNone') {
      p.streakKind = 'none';
      p.streak = 0;
    }
    // TIE_STREAK_BEHAVIOUR 'unchanged' (and a solo tie with the flag off):
    // leave the streak counter and kind untouched.
    return;
  }

  if (isSolo) {
    if (result === 'loss') {
      advanceStreak(p, 'loss');
    } else if (PHANTOM_MIRROR_WIN_PAYS) {
      advanceStreak(p, 'win');
      if (WIN_BONUS_AT_RESOLUTION) p.tokens += PVP_WIN_TOKEN_BONUS;
    }
    // Beating a phantom/mirror with PHANTOM_MIRROR_WIN_PAYS off: nothing.
    return;
  }

  // Plain PvP win or loss.
  advanceStreak(p, result);
  if (result === 'win' && WIN_BONUS_AT_RESOLUTION) {
    p.tokens += PVP_WIN_TOKEN_BONUS;
  }
}

// ---------------------------------------------------------------------------
// spend — the only sanctioned debit
// ---------------------------------------------------------------------------

/**
 * Debit `amount` tokens from a living player. Refuses (returns `false`, no
 * change) when the player is unknown or eliminated, `amount` is negative or not
 * an integer, or the balance cannot cover it — tokens are never clamped and
 * never go negative. Spending exactly the balance, or spending 0, succeeds.
 *
 * M3 note: `spend` takes a raw amount and knows nothing about module or hero
 * pricing — that is M4.
 */
export function spend(state: EconomyStateView, playerId: number, amount: number): boolean {
  const p = state.players[playerId];
  if (p === undefined || !p.alive) return false;
  if (!Number.isInteger(amount) || amount < 0) return false;
  if (amount > p.tokens) return false;
  p.tokens -= amount;
  return true;
}
