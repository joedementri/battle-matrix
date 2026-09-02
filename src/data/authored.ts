/*
 * AUTHORED + DERIVED values — every number the plan's "Source fidelity ledger"
 * marks as fitted (DERIVED) or still-unknown (AUTHORED), in one place.
 *
 * The M1 exit criterion: this file holds every non-canonical number and nothing
 * else does — the one deliberate exception being per-hero combat stats, which the
 * ledger assigns to `heroes.json` (see AUTHORED_ELSEWHERE below).
 *
 * Each value carries a provenance note in `AUTHORED_PROVENANCE`, keyed by export
 * name, stating where it came from and what observation would falsify it. The
 * data test asserts every value export is documented there.
 *
 * Data files import nothing from `ui/` or `render/`.
 */

import { TICK_RATE_HZ } from './constants';
import type { AttackType, Role } from './types';

// ===========================================================================
// DERIVED — formulas fitted to observed data, not published
// ===========================================================================

/**
 * Shop rarity odds — DERIVED.
 *   rare%      = RARITY_ODDS_RARE_COEFF      × Σ(all four protocol levels)
 *   legendary% = RARITY_ODDS_LEGENDARY_COEFF × count(protocols at level ≥ 2)
 *   common%    = 100 − rare% − legendary%
 * Exact fit on all three observed odds rows: 100/0/0, 86.5/12.0/1.5, 81.0/16.0/3.0.
 */
export const RARITY_ODDS_RARE_COEFF = 4.0;
export const RARITY_ODDS_LEGENDARY_COEFF = 1.5;

/**
 * HP loss on a lost PvP round — DERIVED, fitted to the round-9 lobby (~2.8 HP
 * per loss):
 *   loss = floor((round − 1) / HP_LOSS_ROUND_DIVISOR)
 *        + HP_LOSS_SURVIVOR_COEFF × survivingEnemyUnits   // survivors 1..6
 *   tie  = ceil(loss / HP_LOSS_TIE_DIVISOR)
 */
export const HP_LOSS_ROUND_DIVISOR = 5;
export const HP_LOSS_SURVIVOR_COEFF = 1;
export const HP_LOSS_TIE_DIVISOR = 2;
/** Survivor count feeding the HP-loss formula is bounded to this inclusive range. */
export const HP_LOSS_SURVIVOR_RANGE = [1, 6] as const;

// ===========================================================================
// AUTHORED — still unknown, chosen with reasoning
// ===========================================================================

/**
 * Rare / Legendary module buy price. Common 5 is CONFIRMED; sell values 4/9/14
 * imply a flat −1 spread, so 10 / 15. BUT every observed shop card — Common or
 * not — showed `◇5`; a flat 5 for all rarities is a live possibility. One file
 * to change if footage settles it.
 */
export const MODULE_BUY_RARE = 10;
export const MODULE_BUY_LEGENDARY = 15;

/**
 * Phase timers, seconds. The smallest values consistent with every observed
 * clock (draft 34; module 22/21/15/8; position 1; battle 39/32; reward 30;
 * waiting 34/32). `battle` is the base battle clock; `speedUp` is the appended
 * Speed Up sub-stage.
 */
export const PHASE_TIMERS_SECONDS = {
  draft: 40,
  module: 30,
  position: 20,
  battle: 40,
  speedUp: 20,
  reward: 30,
} as const;

/**
 * When the Speed Up Protocol sub-stage begins. Wiki only says "if the battle is
 * taking too long"; the distinct 4th phase icon implies a hard stage boundary,
 * modelled as the battle timer reaching 0. (The +120 % damage magnitude itself
 * is canonical — see constants.ts.)
 */
export const SPEED_UP_TRIGGER = 'battleTimerZero';

/**
 * Match round cap. Round 18 was observed and PvE is documented through round 21;
 * the true cap was never published. At the cap the match resolves by highest
 * remaining health.
 */
export const ROUND_CAP = 40;

/**
 * PvP round-win token bonus (wiki). It never appears in a round-start income
 * preview — `15 + interest + streak` fits all three observed previews exactly —
 * so it is modelled as granted at BATTLE RESOLUTION, not at round start. If
 * footage shows a preview that only reconciles with +2 at round start, correct
 * `economy.ts` only.
 */
export const PVP_WIN_TOKEN_BONUS = 2;
export const PVP_WIN_TOKEN_BONUS_TIMING = 'atBattleResolution';

/**
 * Interest cap. The plan's economy table and M3 assertions assume "max +5", but
 * this is NOT in the screenshot-CONFIRMED list: the one low-token preview
 * (`0 (+19)`) shows 0 interest regardless of any cap, so no screenshot actually
 * proves a ceiling exists. Kept here, not canonised. Falsified by any preview
 * showing interest above 5 (e.g. a 100-token hold previewing `(+25)`+).
 */
export const INTEREST_CAP = 5;

// ===========================================================================
// AUTHORED — M3 economy engine: the calls the plan leaves open or contradicts
// ===========================================================================

/**
 * HP compensation clamp — AUTHORED. The *rate* ("+1 token per 1 health lost") is
 * canonical (constants.ts → HEALTH_COMPENSATION_PER_HP); what it multiplies is
 * not. A killing blow overshoots: a player on 3 HP hit for a raw 5 only *loses*
 * 3. `'actualHealthLost'` pays for the health actually removed —
 * `min(rawLoss, healthBefore)` floored at 0 — on the principle that you cannot
 * be compensated for health you never had. `'rawLossAmount'` would pay the
 * unclamped formula output (5). Falsified by footage of a near-dead player whose
 * token gain on a fatal loss exceeds the health they had left.
 */
export const HP_COMPENSATION_CLAMP: 'actualHealthLost' | 'rawLossAmount' =
  'actualHealthLost';

/**
 * Does a Practice (PvE) round touch the win/loss streak? — AUTHORED. No: the
 * streak is PvP-only. PvE is health-neutral (see match.ts) and the scoreboard
 * streak badge tracks player-vs-player form. Falsified by a scoreboard where a
 * streak badge's count changes across a Practice round with no PvP round between
 * the two observations.
 */
export const PVE_TOUCHES_STREAK: boolean = false;

/**
 * What a PvP tie does to the streak — AUTHORED. `'unchanged'`: a tie is neither
 * a win nor a loss, so the counter and its kind are left intact (a 3-win streak
 * survives a tie as a 3-win streak). It still costs health (`ceil(loss / 2)`)
 * and therefore still pays HP compensation. Alternative: `'breakToNone'` (a tie
 * zeroes the streak). Falsified by footage where a tie visibly resets or zeroes
 * a streak badge.
 */
export const TIE_STREAK_BEHAVIOUR: 'unchanged' | 'breakToNone' = 'unchanged';

/**
 * Does beating a phantom or mirror pay? — AUTHORED. No: the plan says beating one
 * "gives you nothing", so a win against a phantom/mirror grants no +2 and no
 * win-streak increment (it does not even reset an existing loss streak). Losing
 * to one is still a real loss — it advances the loss streak and pays HP
 * compensation. Falsified by footage where a phantom/mirror win advances a
 * streak badge or moves the token counter.
 */
export const PHANTOM_MIRROR_WIN_PAYS: boolean = false;

/**
 * Does a *tie* against a phantom or mirror advance the loss streak? — AUTHORED,
 * and the one place two plan rulings collide. The general tie ruling says a tie
 * leaves the streak unchanged; the phantom/mirror ruling says "losing OR tying
 * against one … does advance the loss streak". This encodes the phantom ruling's
 * literal, more-specific wording: against a team that cannot truly contest you,
 * only a clean win keeps you neutral. Set `false` to make phantom/mirror ties
 * defer to TIE_STREAK_BEHAVIOUR instead. Falsified by a scoreboard where a
 * phantom/mirror tie leaves a win-streak badge intact.
 */
export const PHANTOM_MIRROR_TIE_ADVANCES_LOSS_STREAK: boolean = true;

// ===========================================================================
// AUTHORED — M4 module system: the five details the plan leaves unpublished
// ===========================================================================

/**
 * (1) Protocol / module selection inside a rolled rarity — AUTHORED. The wiki's
 * per-protocol unlock rule reconciles with the DERIVED odds as "roll a rarity
 * globally, then pick among protocols eligible for it". This pins the pick as
 * **uniform among eligible protocols, then uniform among that protocol's modules
 * of that rarity** — no weighting by module count, pool size or how many a
 * player already owns. Falsified by an observed shop whose per-module frequency
 * at a fixed protocol-level state is not flat within a (protocol, rarity) cell.
 */
export const MODULE_DRAW_PROTOCOL_SELECTION = 'uniformProtocolThenUniformModule' as const;

/**
 * (2) Duplicates within one 4-card draw — AUTHORED. `true` = the four cards are
 * distinct module ids (every observed shop screenshot shows four distinct
 * cards). Enforced by bounded rerolls of the colliding card (rarity held fixed
 * so the DERIVED odds row is undistorted); the documented deterministic
 * fallback when a (rarity) space is genuinely too small to fill four — e.g. four
 * Legendary rolls with a single protocol at L2, whose Legendary pool is 3 — is:
 * scan that rarity's eligible modules in id order for the first not already in
 * the set, and only if none exists accept the rolled duplicate. Falsified by an
 * observed shop showing the same module id on two cards at once.
 */
export const MODULE_DRAW_DISTINCT_IN_SET: boolean = true;

/**
 * (3) Maxed modules in later draws — AUTHORED. `true` = a fully-starred owned
 * module (a Common at 6, a Rare at 3, a Legendary at 1) is removed from the
 * draw's candidate pool rather than offered as a dead card the player cannot
 * act on. Falsified by an observed shop offering a module the player already
 * owns at max stars.
 */
export const MODULE_DRAW_EXCLUDE_MAXED: boolean = true;

/**
 * (4) Selling a multi-star module — AUTHORED. `true` = both the token refund
 * (`MODULE_SELL[rarity]`) and the protocol-XP removal (`MODULE_XP[rarity]`)
 * scale by the number of stars owned, and the module is removed from the
 * inventory entirely (no "sell one star"). A three-star Rare refunds `9 × 3`
 * and strips `2 × 3` XP, which can drop a protocol below a threshold and revoke
 * that tier's bonus. Falsified by footage where selling a starred module refunds
 * a flat rarity value or only removes one star.
 */
export const MODULE_SELL_SCALES_PER_STAR: boolean = true;

/**
 * (5) `LOCK` semantics — AUTHORED. `LOCK` is a single shop-wide toggle (the
 * per-card padlock badges in the zoomed screenshot are one set-level lock
 * rendered on all four cards), and:
 *   - `clearsAfterCarryover`: a locked set is carried whole into the next
 *     round's shop and the lock then releases, so the next round can refresh.
 *   - `refreshRefillsEmptiedSlots`: `REFRESH` redraws the shop back to four
 *     cards, refilling slots emptied by a purchase this phase.
 *   - `refreshDisabledWhileLocked`: `REFRESH` greys out while locked, so locked
 *     cards trivially survive any refresh (there is none to survive).
 * Falsified by footage where a locked set is not carried over, where the lock
 * persists a second round, or where refresh works while locked.
 */
export const SHOP_LOCK_BEHAVIOUR: {
  readonly scope: 'set';
  readonly clearsAfterCarryover: true;
  readonly refreshRefillsEmptiedSlots: true;
  readonly refreshDisabledWhileLocked: true;
} = {
  scope: 'set',
  clearsAfterCarryover: true,
  refreshRefillsEmptiedSlots: true,
  refreshDisabledWhileLocked: true,
};

// ===========================================================================
// AUTHORED — M5 combat simulation core (headless)
// ===========================================================================

/**
 * Arena geometry — AUTHORED. The plan fixes the unit convention (range / move
 * are *arena units*, not board cells) and the 6×4 deploy grid, but not the
 * arena's metric size. One deploy-grid cell is `ARENA_CELL_SIZE` arena units;
 * the two teams' front rows start `ARENA_TEAM_SEPARATION` apart. Resulting
 * footprint: 30 wide (6 cells) × 60 deep (2 × 3 back-to-front cells + the
 * separation). Sized so range genuinely differentiates heroes: a 20–34 Duelist
 * sniper on the front row reaches the enemy front row at spawn (sep 24) but not
 * its back row (sep 24 + 18 = 42); a 16–22 Strategist and every melee unit must
 * close ground first. Falsified by footage that establishes an arena scale
 * contradicting these ratios.
 */
export const ARENA_CELL_SIZE = 6;
export const ARENA_TEAM_SEPARATION = 24;

/**
 * Movement model — AUTHORED (the plan recommends exactly this). Each tick a unit
 * steers straight at its target and advances `moveSpeed × dt`, with no unit-unit
 * collision — a visual separation nudge is M9's problem. Direction uses
 * normalised vector math (sqrt only), never angles, so it reproduces bit-for-bit
 * across JS engines and versions.
 */
export const MOVEMENT_MODEL = 'steerStraightNoCollision' as const;

/**
 * Ult-energy conversion rates — AUTHORED. Fraction of a full ult bar gained per
 * 1 point of damage dealt / damage taken / healing done, *before* the unit's
 * Charge Acceleration multiplier. Tuned so a typical unit reaches its first ult
 * around 25–40 s into an even fight and rarely casts more than twice before the
 * tie cap. Falsified by footage timing ult casts materially faster or slower.
 */
export const ULT_ENERGY_PER_DAMAGE_DEALT = 0.00012;
export const ULT_ENERGY_PER_DAMAGE_TAKEN = 0.0002;
export const ULT_ENERGY_PER_HEALING_DONE = 0.00016;

/**
 * The two different limits, kept apart (plan rule 3) — AUTHORED.
 * `BATTLE_TIE_CAP_TICKS` is a GAME RULE: the 40 s battle clock plus the 20 s
 * Speed Up sub-stage (`PHASE_TIMERS_SECONDS`), after which the battle ends as a
 * **tie**. `BATTLE_MAX_TICKS` is a paranoid BUG GUARD at twice the tie cap; the
 * sim **throws** if it is ever reached (a bug report, not a game outcome), so it
 * must stay strictly greater than the tie cap and unreachable in normal play.
 */
export const BATTLE_TIE_CAP_TICKS =
  (PHASE_TIMERS_SECONDS.battle + PHASE_TIMERS_SECONDS.speedUp) * TICK_RATE_HZ;
export const BATTLE_MAX_TICKS = BATTLE_TIE_CAP_TICKS * 2;

/**
 * When the Speed Up Protocol sub-stage begins inside a battle — AUTHORED, = the
 * 40 s base battle clock (`PHASE_TIMERS_SECONDS.battle`) in ticks. At this tick
 * one battle-level flag flips and the damage function multiplies by exactly
 * `SPEED_UP_DAMAGE_MULTIPLIER` (2.2) **once** — never re-applied per tick. The
 * +120 % magnitude itself is canonical (`constants.ts`). The string form
 * `SPEED_UP_TRIGGER` ('battleTimerZero') above says the same thing semantically.
 */
export const SPEED_UP_TRIGGER_TICKS = PHASE_TIMERS_SECONDS.battle * TICK_RATE_HZ;

/**
 * Rampage (Annihilator Fury) duration — AUTHORED. The module text gives the
 * bonus (+40 % attack speed & lifesteal, full heal) but no duration: 5 s,
 * refreshed on every Final Hit. Falsified by footage timing Rampage.
 */
export const RAMPAGE_DURATION_TICKS = 5 * TICK_RATE_HZ;

/**
 * Critical Counter "near-death" threshold — AUTHORED. The module text says "the
 * first time a Strategist enters a near-death state" without defining it; mirror
 * Critical Damage Shell's 30 % health line. Falsified by footage pinning the
 * trigger to a different fraction.
 */
export const CRITICAL_COUNTER_NEAR_DEATH_FRACTION = 0.3;

/**
 * Vulnerability Mark stacking — AUTHORED. The module text says "1 stack … on
 * damage" with no cap or decay: cap at 5 stacks; a stack set falls off 3 s after
 * the last application. Total added damage-taken % = stacks × the applying
 * module's per-stack %. Falsified by footage showing a different cap or decay.
 */
export const VULNERABILITY_MAX_STACKS = 5;
export const VULNERABILITY_DURATION_TICKS = 3 * TICK_RATE_HZ;

/**
 * Ultimate archetype catalog — AUTHORED. 39 bespoke ultimates are out of M5
 * scope (the ledger already marks ult behaviour as authored). Every hero maps
 * (in `heroes.json`) to one of these six archetypes; the baseline magnitudes
 * live here. `hitsOfPrimary` multiplies the caster's per-hit damage; `radius` is
 * in arena units; `durationTicks` gates the timed archetypes;
 * `healSecondsOfOutput` is multiples of the caster's heal/s applied to every
 * ally. Per-hero tuning is M11 polish. Falsified by footage pinning a hero's ult
 * to a materially different shape.
 */
export const ULT_ARCHETYPES = {
  singleTargetBurst: { hitsOfPrimary: 12, radius: 0, durationTicks: 0 },
  aoeBurst: { hitsOfPrimary: 7, radius: 12, durationTicks: 0 },
  sustainedBeam: { bonusDamagePct: 120, radius: 0, durationTicks: 5 * TICK_RATE_HZ },
  teamHealBurst: { healSecondsOfOutput: 6, radius: 0, durationTicks: 0 },
  shieldDamageReduction: { reductionPct: 40, radius: 0, durationTicks: 6 * TICK_RATE_HZ },
  selfBuff: { damagePct: 50, attackSpeedPct: 40, durationTicks: 6 * TICK_RATE_HZ },
} as const;

// ===========================================================================
// AUTHORED — M6 Ultron Drone + Practice Protocol
// ===========================================================================

/**
 * Unpublished rule (1) — does a PvE (Practice) loss cost health? AUTHORED: NO.
 * The plan states only *PvP* losses cost health; a Practice loss is health-
 * neutral, which also keeps it consistent with M3's PvP-only streak decision
 * (`PVE_TOUCHES_STREAK = false`). Falsified by a scoreboard where a player's
 * health drops across a Practice round with no PvP round between observations.
 */
export const PVE_LOSS_COSTS_HEALTH: boolean = false;

/**
 * Unpublished rule (2) — is the Strengthen Module reward conditional on winning
 * the Practice round? AUTHORED: NO — granted regardless of outcome. It is a
 * Practice round and the plan states the payout unconditionally (1 on rounds
 * 1 & 6, 2 on 11/16/21). Falsified by footage where a Practice loss yields no
 * Strengthen pick.
 */
export const STRENGTHEN_REWARD_REQUIRES_WIN: boolean = false;

/**
 * Unpublished rule (3) — how do rounds 11/16/21 pay 2 Strengthen Modules?
 * AUTHORED: `'singleOfferSetSelectN'` — ONE offer set of three, select two.
 * This matches the in-game string `Select N Strengthen Modules` and the single
 * `REFRESH 1/1` (one shared refresh, not one per draw). `'sequentialDraws'`
 * would run two independent 3-card draws with two refreshes. Falsified by
 * footage of two sequential Strengthen reward draws on rounds 11/16/21.
 */
export const STRENGTHEN_REWARD_MULTI_MODE: 'singleOfferSetSelectN' | 'sequentialDraws' =
  'singleOfferSetSelectN';

/**
 * Reward-offer shrinking-pool fallback — AUTHORED. Each hero has exactly 2
 * Strengthen Modules, so a 6-hero lineup caps at 12 candidates; accumulation
 * plus hero swaps can drop the eligible set below the 3-card offer size.
 * `'offerFewer'` shows `min(3, eligible)` cards rather than widening off-lineup
 * (which would break "always for heroes in the current lineup") or throwing.
 * `'widenToReserve'` would top up from Reserve heroes' modules. Falsified by
 * footage of a Strengthen offer card for a hero not in the current lineup.
 */
export const STRENGTHEN_OFFER_SHRINK_FALLBACK: 'offerFewer' | 'widenToReserve' = 'offerFewer';

/**
 * Mirror-matchup opponent drone — AUTHORED. A `mirror` bout is the odd-one-out
 * fighting a *copy of a living opponent's* lineup in real time, so it plausibly
 * brings a policy-driven drone for that mirrored opponent. `true`. Falsified by
 * footage of a mirror matchup with no opponent drone.
 */
export const MIRROR_MATCHUP_HAS_OPPONENT_DRONE: boolean = true;

/**
 * Phantom-matchup opponent drone — AUTHORED. A `phantom` is an *eliminated*
 * player's frozen lineup, and the plan says "beating one gives you nothing", so
 * it fields no drone. `false`. Falsified by footage of a phantom matchup that
 * shows an opponent drone.
 */
export const PHANTOM_MATCHUP_HAS_OPPONENT_DRONE: boolean = false;

/**
 * Ultron Drone free-flight speed, arena units/second — AUTHORED. Heroes move
 * 3.0–4.4; the drone flies well above the fight and can "cross the whole arena"
 * (clamped to the M5 arena bounds), so it is faster. 12 crosses the 60-deep
 * arena in ~5 s. Falsified by footage timing drone travel.
 */
export const DRONE_MOVE_SPEED = 12;

/**
 * Recorded-input movement quantization divisor — AUTHORED. M9's live-capture
 * layer must PRODUCE the drone input stream; a raw mouse-derived float would
 * desync a replay across JS engines. Movement is stored as a fixed-point
 * normalized vector: integer components in [−DRONE_MOVE_QUANT, DRONE_MOVE_QUANT],
 * divided by this at read time. 1000 gives 0.001 resolution — far below any
 * cross-engine float drift. Not falsifiable by footage (an engine-fidelity
 * choice); changing it changes recorded-replay hashes.
 */
export const DRONE_MOVE_QUANT = 1000;

/**
 * Encephalo-Ray beam damage/second — AUTHORED, and deliberately tiny. Its budget
 * is an *assertion*, not this number: `tests/drone.spec.ts` measures the beam's
 * whole-battle damage held the entire fight and proves it is <0.1 % of a
 * Duelist's total in the same battle — it must never be a win condition. 0.02
 * dps ≈ 1 point of damage over a full-length battle. Falsified by footage where
 * the beam does meaningful damage.
 */
export const ENCEPHALO_RAY_DPS = 0.02;

/**
 * `LSHIFT` One-Time Damage magnitude, flat, per living enemy unit — AUTHORED.
 * Fires at most once per Battle Phase. 120 finishes a near-dead Duelist and
 * dents a tank without wiping a healthy line — a finisher, not a win button.
 * M11 tunes against the win-rate gate. Falsified by footage pinning it to a
 * different value or a percentage.
 */
export const DRONE_ONE_TIME_DAMAGE = 120;

/**
 * `E` One-Time Healing magnitude, flat, per living allied unit — AUTHORED.
 * Symmetric with `DRONE_ONE_TIME_DAMAGE`. Fires at most once per Battle Phase.
 * Falsified as `DRONE_ONE_TIME_DAMAGE`.
 */
export const DRONE_ONE_TIME_HEALING = 120;

/**
 * AI drone policy (M7) — the "low HP" fraction — AUTHORED, from the plan's M7
 * rule ("below 40 % HP"). The HP fraction under which a unit counts toward the
 * drone's One-Time thresholds below.
 */
export const DRONE_POLICY_LOW_HP_FRACTION = 0.4;

/**
 * AI drone policy (M7) — fire One-Time Damage when at least this many enemy
 * units are below `DRONE_POLICY_LOW_HP_FRACTION` — AUTHORED, from the plan's M7
 * rule ("≥ 3 enemies").
 */
export const DRONE_POLICY_DAMAGE_ENEMY_THRESHOLD = 3;

/**
 * AI drone policy (M7) — fire One-Time Healing when at least this many allied
 * units are below `DRONE_POLICY_LOW_HP_FRACTION` — AUTHORED, from the plan's M7
 * rule ("≥ 2 allies").
 */
export const DRONE_POLICY_HEAL_ALLY_THRESHOLD = 2;

/**
 * Galacta Bot per-round stat scaling — AUTHORED. Every bot's health and dps in
 * `galactaWave(round)` is multiplied by `1 + SCALE_PER_ROUND × (round − 1)`, so
 * the wave grows with the round number on top of its larger composition. At
 * round 1 the multiplier is 1.0 (tier-0 wave, comfortable); at round 21 health
 * ×2.2 and dps ×2.0 across 15 units (genuinely threatening). M11 re-tunes.
 * Falsified by footage establishing a different Practice-round difficulty curve.
 */
export const GALACTA_HEALTH_SCALE_PER_ROUND = 0.06;
export const GALACTA_DPS_SCALE_PER_ROUND = 0.05;

// ===========================================================================
// AUTHORED — M7 AI opponents
// ===========================================================================

/**
 * Seat → archetype assignment for a match — AUTHORED (structural, not a tuning
 * number). `'seedModuloArchetypeCount'`: seat `i` runs
 * `ARCHETYPES[(i + masterSeed % 5) % 5]`. Six seats, five archetypes, so seat 5
 * always doubles seat 0's archetype; *which* archetype that is rotates every
 * seed, so over many seeds each archetype takes the extra seat equally often
 * and its win rate is not confounded with a fixed seat or pairing slot. Not
 * falsifiable by footage (there is no real six-bot lobby); changing it only
 * reshuffles which archetype sits where.
 */
export const AI_SEAT_ROTATION = 'seedModuloArchetypeCount' as const;

/**
 * Per-archetype economy / build knobs — AUTHORED bot tuning. Re-tuned ONLY
 * against the M7 distribution gate, never against hero stats (that is M11).
 * Each value is the plan's M7 table wording made numeric, then fitted so no
 * archetype wins < 5 % or > 50 % of 100 seeded AI-only matches:
 *   greedyBankerHoldTokens     35 — the reserve it keeps while interest still
 *        compounds. The plan's "buys only at 50+ tokens" proved a pure losing
 *        hold in the M7 module meta (dead before it could cash in); 35 keeps a
 *        reserve larger than any other archetype's while clearing the 5 % floor.
 *   greedyBankerCashInRound     9 — from here it drops the reserve and cashes
 *        the fat bank into modules (interest has done its compounding work).
 *   protocolRusherTargetLevel   3 — "forces one protocol to L3".
 *   equilibriumPuristHoldTokens 25 — "balanced": a one-to-two-buy buffer over
 *        the 15 base income.
 *   streakRiderWinSaveTokens    22 — "rides loss streaks": the reserve it holds
 *        while winning; on a loss streak it spends toward 0.
 *   adaptiveHoldUntilRound       6 — "interest to r8, then spend" — tuned in a
 *        round earlier so the compounding module race does not run away first.
 *   shopRefreshBudget            2 — max `REFRESH`es per round for the
 *        archetypes that dig for a card (all but Greedy Banker).
 * Falsified only by the gate itself leaving the 5–50 % win-rate band.
 */
export const AI_ARCHETYPE_TUNING = {
  greedyBankerHoldTokens: 35,
  greedyBankerCashInRound: 9,
  protocolRusherTargetLevel: 3,
  equilibriumPuristHoldTokens: 25,
  streakRiderWinSaveTokens: 22,
  adaptiveHoldUntilRound: 6,
  shopRefreshBudget: 2,
} as const;

/**
 * The `attackRange` (arena units) at or below which a Duelist deploys as a
 * melee flanker (front-minus-one row, outer columns) rather than a ranged
 * back-liner — AUTHORED. Extracted from `combat.ts`'s pre-M7 formation
 * heuristic, which used the same literal 8; `board.ts` / `ai/deploy.ts` and
 * `combat.ts` now share this one constant. Falsified by footage establishing a
 * different melee/ranged split among Duelists on the deploy grid.
 */
export const DEPLOY_MELEE_DUELIST_RANGE_MAX = 8;

/**
 * The shared Ultron-Drone AI policy (M7) — AUTHORED behaviour, RNG-free.
 *   movement: 'trackNearestEnemyUnit' — the drone drifts toward the nearest
 *        living enemy unit at `DRONE_MOVE_SPEED`; it flies over the fight and
 *        never collides with anything.
 *   holdBeamWhileEnemyAlive: true — a bot holds LMB continuously. The
 *        Encephalo-Ray's whole-battle damage is bounded by an ASSERTION, not
 *        by this flag (see `ENCEPHALO_RAY_DPS`) — it stays sub-1 % of a
 *        Duelist's output and never flips an outcome. Digest-affecting only.
 * NOT per-archetype: the plan gives exactly one drone rule for every seat.
 * Falsified by footage of a materially different AI drone behaviour.
 */
export const DRONE_POLICY = {
  movement: 'trackNearestEnemyUnit',
  holdBeamWhileEnemyAlive: true,
} as const;

// ===========================================================================
// AUTHORED, but stored elsewhere by the ledger's deliberate exception
// ===========================================================================

/**
 * Per-hero combat stats (DPS, range, attack type, attack speed, move speed, and
 * Strategist heal/s) are AUTHORED but live in `heroes.json` under a nested
 * `combat` object, per the ledger. Base health there is canonical; the `combat`
 * block is not. This pointer keeps the exit criterion honest.
 */
export const AUTHORED_ELSEWHERE = {
  perHeroCombatStats: 'heroes.json → combat',
  galactaWaves: 'galacta.json',
} as const;

/**
 * `strengthen.json` is an M1 skeleton: 78 rows (39 heroes × 2 slots) carrying
 * only `id` / `heroId` / `slot`, with empty `name` / `effect` / `keybind`
 * placeholders. Canonical Strengthen Module names, effect text and keybinds are
 * M10 work, sourced from the wiki and screenshots — they are NOT in this plan
 * and must not be invented. (JSON carries no comments, so this note stands in
 * for the file header alongside the doc on `StrengthenModuleSkeleton` in
 * `types.ts`.)
 */
export const STRENGTHEN_JSON_IS_SKELETON = true;

// ===========================================================================
// AUTHORED bands for the per-hero combat stats in heroes.json
// ===========================================================================

interface RoleBand {
  readonly baseHealth: readonly [number, number];
  readonly dps: readonly [number, number];
  readonly moveSpeed: readonly [number, number];
  readonly attackTypes: readonly AttackType[];
  /** Range window for a `melee` attacker of this role, inclusive. */
  readonly meleeRange?: readonly [number, number];
  /** Range window for a `ranged` or `sniper` attacker of this role, inclusive. */
  readonly rangedRange?: readonly [number, number];
  /** Sustained heal/s window (Strategists only), inclusive. */
  readonly healPerSecond?: readonly [number, number];
}

/**
 * The M1 milestone bands. Per-hero picks in `heroes.json` must land inside these;
 * `validate.ts` enforces it and the data test re-checks it independently. M11
 * tunes the picks against the M7 win-rate gate — these windows may widen then.
 *
 * Unit convention (also in `types.ts` → HeroCombat): range and move are ARENA
 * units, not board cells. A Duelist sniper range of 20–34 is not expressible in
 * 6×4 cells; M5 maps the grid into arena space.
 */
export const COMBAT_BANDS: Readonly<Record<Role, RoleBand>> = {
  vanguard: {
    baseHealth: [575, 700],
    dps: [55, 85],
    moveSpeed: [3.0, 3.0],
    attackTypes: ['melee', 'ranged'],
    meleeRange: [3, 8],
    rangedRange: [12, 18],
  },
  duelist: {
    baseHealth: [250, 375],
    dps: [110, 170],
    moveSpeed: [3.6, 4.4],
    attackTypes: ['melee', 'ranged', 'sniper'],
    meleeRange: [5, 5],
    rangedRange: [20, 34],
  },
  strategist: {
    baseHealth: [250, 275],
    dps: [45, 70],
    moveSpeed: [3.4, 3.4],
    attackTypes: ['ranged'],
    rangedRange: [16, 22],
    healPerSecond: [60, 95],
  },
};

// ===========================================================================
// Provenance ledger — one entry per value export above
// ===========================================================================

export const AUTHORED_PROVENANCE: Readonly<Record<string, string>> = {
  RARITY_ODDS_RARE_COEFF:
    'DERIVED. rare% = 4.0 × Σ(protocol levels). Exact fit on odds rows 100/0/0, 86.5/12/1.5, 81/16/3. Falsified by any shop odds row where rare% ≠ 4.0 × Σlevels.',
  RARITY_ODDS_LEGENDARY_COEFF:
    'DERIVED. legendary% = 1.5 × count(protocols at level ≥ 2). Same three odds rows. Falsified by an odds row where legendary% ≠ 1.5 × (#protocols at L2+).',
  HP_LOSS_ROUND_DIVISOR:
    'DERIVED. loss = floor((round−1)/5) + survivingEnemyUnits, fitted to the round-9 lobby (~2.8 HP/loss). Falsified by observed per-loss HP deltas that do not match the piecewise curve.',
  HP_LOSS_SURVIVOR_COEFF:
    'DERIVED. Surviving enemy units (1..6) are added at coefficient 1 in the HP-loss formula. Same source as HP_LOSS_ROUND_DIVISOR.',
  HP_LOSS_TIE_DIVISOR:
    'DERIVED. tie HP loss = ceil(loss / 2). Same source as HP_LOSS_ROUND_DIVISOR.',
  HP_LOSS_SURVIVOR_RANGE:
    'DERIVED. Survivor count feeding the formula is clamped to 1..6 (a full wipe still leaves the winning side with ≥1 unit).',
  MODULE_BUY_RARE:
    'AUTHORED. Common 5 is CONFIRMED; sell 4/9/14 implies a flat −1 spread → buy 5/10/15. Every observed card (any rarity) showed ◇5, so a flat 5 is live. Falsified by a screenshot of a Rare card priced ≠ 10.',
  MODULE_BUY_LEGENDARY:
    'AUTHORED. Same reasoning as MODULE_BUY_RARE. Falsified by a screenshot of a Legendary card priced ≠ 15.',
  PHASE_TIMERS_SECONDS:
    'AUTHORED. Smallest values consistent with every observed clock (draft 34; module 22/21/15/8; position 1; battle 39/32; reward 30; waiting 34/32). Falsified by any observed clock exceeding the matching cap.',
  SPEED_UP_TRIGGER:
    'AUTHORED. Wiki: "if the battle is taking too long"; the distinct 4th phase icon implies a stage boundary → battle timer 0. Falsified by footage showing Speed Up before the timer expires.',
  ROUND_CAP:
    'AUTHORED. Round 18 observed, PvE documented through round 21, true cap never published. At the cap, highest remaining health wins. Falsified by footage past round 40 or a published cap.',
  PVP_WIN_TOKEN_BONUS:
    'AUTHORED (wiki value). Never appears in a round-start income preview (15 + interest + streak fits all three). Falsified by a preview that only reconciles with +2 applied at round start.',
  PVP_WIN_TOKEN_BONUS_TIMING:
    'AUTHORED. Granted at battle resolution, not round start — the only reading consistent with both the wiki (+2 exists) and the screenshots (no preview includes it).',
  INTEREST_CAP:
    'AUTHORED. NOT in the screenshot-CONFIRMED list. The plan assumes "max +5" but the sole low-token preview (0(+19)) shows 0 interest regardless of any cap. Falsified by a preview showing interest > 5.',
  HP_COMPENSATION_CLAMP:
    "AUTHORED. The rate is canonical; the clamp is not. 'actualHealthLost' = min(rawLoss, healthBefore) floored at 0 — no compensation for health never held (3 HP hit for 5 pays 3, not 5). Falsified by footage of a fatal-loss token gain exceeding the player's remaining health.",
  PVE_TOUCHES_STREAK:
    'AUTHORED. Streak is PvP-only — PvE is health-neutral and the badge tracks PvP form. Falsified by a streak-badge count change across a Practice round with no PvP round between observations.',
  TIE_STREAK_BEHAVIOUR:
    "AUTHORED. 'unchanged' — a PvP tie is neither win nor loss and leaves the streak counter and kind intact (it still costs health, so it still pays compensation). Falsified by footage where a tie resets or zeroes a streak badge.",
  PHANTOM_MIRROR_WIN_PAYS:
    'AUTHORED. The plan: beating a phantom/mirror "gives you nothing" — no +2, no win-streak increment, no reset of an existing loss streak. Falsified by footage where a phantom/mirror win advances a streak badge or the token counter.',
  PHANTOM_MIRROR_TIE_ADVANCES_LOSS_STREAK:
    'AUTHORED. Resolves a collision between the general tie ruling ("unchanged") and the phantom ruling ("losing or tying … does advance the loss streak") in favour of the more specific phantom wording. Set false to defer to TIE_STREAK_BEHAVIOUR. Falsified by a phantom/mirror tie that leaves a win-streak badge intact.',
  MODULE_DRAW_PROTOCOL_SELECTION:
    'AUTHORED. Unpublished detail (1): once a rarity is rolled, pick uniform among eligible protocols, then uniform among that protocol\'s modules of that rarity. Falsified by non-flat per-module draw frequency within a fixed (protocol, rarity) cell.',
  MODULE_DRAW_DISTINCT_IN_SET:
    'AUTHORED. Unpublished detail (2): the four shop cards are always distinct module ids (every observed shop screenshot). Enforced by bounded reroll + a documented deterministic scan-then-allow-duplicate fallback. Falsified by an observed shop with a repeated module id.',
  MODULE_DRAW_EXCLUDE_MAXED:
    'AUTHORED. Unpublished detail (3): a fully-starred owned module is excluded from later draws rather than offered as a dead card. Falsified by an observed shop offering an already-maxed module.',
  MODULE_SELL_SCALES_PER_STAR:
    'AUTHORED. Unpublished detail (4): selling refunds sellValue × starsOwned and removes rarityXp × starsOwned, deleting the module entirely — never a flat refund or a single-star removal. Falsified by footage of a starred sell refunding a flat rarity value.',
  SHOP_LOCK_BEHAVIOUR:
    "AUTHORED. Unpublished detail (5): LOCK is one shop-wide toggle (the per-card padlocks are its rendering). A locked set carries into next round's shop and the lock then clears; REFRESH redraws back to four cards, refilling emptied slots; REFRESH is disabled entirely while locked. Falsified by a locked set not carrying over, a lock persisting a second round, or a working refresh while locked.",
  AUTHORED_ELSEWHERE:
    "Pointer, not a value. Per-hero combat stats are AUTHORED but stored in heroes.json → combat by the ledger's deliberate exception (base health there is canonical); Galacta Bot archetypes + wave composition are AUTHORED (M6) in galacta.json by the same exception.",
  STRENGTHEN_JSON_IS_SKELETON:
    'Marker, not a value. strengthen.json ships id/heroId/slot only in M1; names, effect text and keybinds are M10 (wiki + screenshots) and must not be invented.',
  COMBAT_BANDS:
    'AUTHORED. The M1 milestone band table; per-hero picks in heroes.json must land inside it. M11 re-tunes against the M7 win-rate gate.',

  ARENA_CELL_SIZE:
    'AUTHORED (M5). One 6×4 deploy-grid cell = 6 arena units. Sized with ARENA_TEAM_SEPARATION so range differentiates heroes. Falsified by footage establishing a contradicting arena scale.',
  ARENA_TEAM_SEPARATION:
    'AUTHORED (M5). 24 arena units between the two teams\' front rows — a 20–34 sniper reaches the enemy front row at spawn but not its back row (24 + 18 = 42); melee and 16–22 Strategists must close first. Falsified as ARENA_CELL_SIZE.',
  MOVEMENT_MODEL:
    'AUTHORED (M5, plan-recommended). Steer straight at the target at moveSpeed × dt, no unit collision (separation nudge is M9). Direction via normalised vector math (sqrt only), never angles.',
  ULT_ENERGY_PER_DAMAGE_DEALT:
    'AUTHORED (M5). Fraction of a full ult bar per point of damage dealt, before Charge Acceleration. Tuned for a first ult ~25–40 s into an even fight. Falsified by footage timing casts materially differently.',
  ULT_ENERGY_PER_DAMAGE_TAKEN:
    'AUTHORED (M5). As ULT_ENERGY_PER_DAMAGE_DEALT, for damage taken (tanks charge from being hit).',
  ULT_ENERGY_PER_HEALING_DONE:
    'AUTHORED (M5). As ULT_ENERGY_PER_DAMAGE_DEALT, for healing done (Strategists charge from healing).',
  BATTLE_TIE_CAP_TICKS:
    'AUTHORED (M5). GAME RULE: (battle 40 s + Speed Up 20 s) × 30 Hz = 1800 ticks, after which the battle ends as a tie. Distinct from BATTLE_MAX_TICKS. Falsified by footage of a battle running past 60 s without a tie.',
  BATTLE_MAX_TICKS:
    'AUTHORED (M5). BUG GUARD at 2× the tie cap (3600 ticks). The sim throws if reached — a bug report, not a game outcome. Must stay strictly greater than BATTLE_TIE_CAP_TICKS.',
  SPEED_UP_TRIGGER_TICKS:
    'AUTHORED (M5). = PHASE_TIMERS_SECONDS.battle (40 s) × 30 Hz = 1200 ticks. At this tick one battle-level flag flips and damage ×2.2 exactly, once. Falsified by footage showing Speed Up before the battle clock expires.',
  RAMPAGE_DURATION_TICKS:
    'AUTHORED (M5). Annihilator Fury\'s module text gives the bonus but no duration: 5 s, refreshed on every Final Hit. Falsified by footage timing Rampage.',
  CRITICAL_COUNTER_NEAR_DEATH_FRACTION:
    'AUTHORED (M5). "near-death state" is undefined in the Critical Counter text; mirrors Critical Damage Shell\'s 30 % line. Falsified by footage pinning the trigger elsewhere.',
  VULNERABILITY_MAX_STACKS:
    'AUTHORED (M5). Vulnerability Mark text gives no stack cap: capped at 5. Falsified by footage showing a different cap.',
  VULNERABILITY_DURATION_TICKS:
    'AUTHORED (M5). Vulnerability Mark text gives no decay: the stack set falls off 3 s after the last application. Falsified by footage showing a different decay.',
  ULT_ARCHETYPES:
    'AUTHORED (M5). Baseline magnitudes for the six ult archetypes each hero maps to (heroes.json). Per-hero tuning is M11. Falsified by footage pinning a hero\'s ult to a materially different shape.',

  PVE_LOSS_COSTS_HEALTH:
    "AUTHORED (M6). Unpublished rule (1): a Practice (PvE) loss is health-neutral — the plan says only PvP losses cost health, and this matches M3's PvP-only streak call. Falsified by a scoreboard where health drops across a Practice round.",
  STRENGTHEN_REWARD_REQUIRES_WIN:
    'AUTHORED (M6). Unpublished rule (2): the Strengthen Module reward is granted regardless of the Practice-round outcome — it is a Practice round and the plan states the payout unconditionally. Falsified by footage where a Practice loss yields no Strengthen pick.',
  STRENGTHEN_REWARD_MULTI_MODE:
    "AUTHORED (M6). Unpublished rule (3): rounds 11/16/21 pay 2 as ONE offer set of three, select two ('singleOfferSetSelectN') — matches the string 'Select N Strengthen Modules' and the single 'REFRESH 1/1'. 'sequentialDraws' = two independent draws. Falsified by footage of two sequential Strengthen reward draws.",
  STRENGTHEN_OFFER_SHRINK_FALLBACK:
    "AUTHORED (M6). Each hero has exactly 2 Strengthen Modules → a lineup caps at 12 candidates, shrunk by accumulation + hero swaps. 'offerFewer' shows min(3, eligible) rather than widening off-lineup or throwing. Falsified by a Strengthen offer card for a hero not in the current lineup.",
  MIRROR_MATCHUP_HAS_OPPONENT_DRONE:
    'AUTHORED (M6). A mirror bout fights a copy of a living opponent\'s lineup in real time, so it brings a policy-driven drone for that opponent. Falsified by footage of a mirror matchup with no opponent drone.',
  PHANTOM_MATCHUP_HAS_OPPONENT_DRONE:
    'AUTHORED (M6). A phantom is an eliminated player\'s frozen lineup and "beating one gives you nothing", so it fields no drone. Falsified by footage of a phantom matchup showing an opponent drone.',
  DRONE_MOVE_SPEED:
    'AUTHORED (M6). Drone free-flight speed in arena units/s — faster than heroes (3.0–4.4) since it flies over the fight and may cross the whole arena. Falsified by footage timing drone travel.',
  DRONE_MOVE_QUANT:
    'AUTHORED (M6). Fixed-point divisor for recorded drone movement vectors (integer components in ±this, ÷ at read time). An engine-fidelity choice so replays reproduce across machines; not falsifiable by footage.',
  ENCEPHALO_RAY_DPS:
    "AUTHORED (M6), deliberately tiny. The real budget is an ASSERTION: drone.spec.ts measures the beam held the whole battle and proves it is <0.1 % of a Duelist's total — never a win condition. Falsified by footage where the beam does meaningful damage.",
  DRONE_ONE_TIME_DAMAGE:
    'AUTHORED (M6). LSHIFT One-Time Damage, flat, per living enemy unit; fires at most once per Battle Phase. A finisher, not a win button. M11 tunes. Falsified by footage pinning it to a different value or a percentage.',
  DRONE_ONE_TIME_HEALING:
    'AUTHORED (M6). E One-Time Healing, flat, per living allied unit; symmetric with DRONE_ONE_TIME_DAMAGE. Falsified as DRONE_ONE_TIME_DAMAGE.',
  DRONE_POLICY_LOW_HP_FRACTION:
    'AUTHORED (M7), the plan\'s M7 drone rule ("below 40 % HP"): the HP fraction under which a unit counts toward the drone\'s One-Time thresholds. Falsified by footage pinning the AI drone\'s trigger to a different fraction.',
  DRONE_POLICY_DAMAGE_ENEMY_THRESHOLD:
    'AUTHORED (M7), the plan\'s M7 drone rule: the drone fires One-Time Damage once ≥ this many enemy units are below DRONE_POLICY_LOW_HP_FRACTION. Falsified by footage of the AI drone firing it at a different count.',
  DRONE_POLICY_HEAL_ALLY_THRESHOLD:
    'AUTHORED (M7), the plan\'s M7 drone rule: the drone fires One-Time Healing once ≥ this many allied units are below DRONE_POLICY_LOW_HP_FRACTION. Falsified by footage of the AI drone firing it at a different count.',
  AI_SEAT_ROTATION:
    'AUTHORED (M7, structural). Seat i → ARCHETYPES[(i + masterSeed % 5) % 5]; seat 5 doubles seat 0, rotating by seed so no archetype is confounded with a fixed seat. Not footage-falsifiable (no real six-bot lobby); changing it reshuffles which archetype sits where.',
  AI_ARCHETYPE_TUNING:
    'AUTHORED (M7). Per-archetype economy knobs, the plan\'s M7 table wording made numeric then fitted to the 100-match distribution gate: Greedy Banker reserve 35 (the plan\'s "50+" is a losing hold in the M7 module meta) with a round-9 cash-in; Onslaught/Equilibrium L3 target; Equilibrium Purist 25-token buffer; Streak Rider 22-token win-reserve; Adaptive light-buffer-then-spend from round 6; 2 REFRESHes/round. Bot tuning only — re-tuned against the gate, never against hero stats (M11). Falsified by the gate leaving the 5–50 % band.',
  DEPLOY_MELEE_DUELIST_RANGE_MAX:
    'AUTHORED (M7). attackRange ≤ this ⇒ a Duelist deploys as a melee flanker, else a ranged back-liner. Extracted from combat.ts\'s pre-M7 formation cutoff (same literal 8) so board.ts / ai and combat.ts share one source. Falsified by footage of a different Duelist melee/ranged deploy split.',
  DRONE_POLICY:
    'AUTHORED (M7). The shared, RNG-free AI drone policy: track the nearest enemy unit, hold the Encephalo-Ray while any enemy lives (its damage is bounded by an assertion, not this flag), fire the two One-Time abilities at the DRONE_POLICY_* thresholds. One rule for every seat (the plan gives no per-archetype drone). Falsified by footage of a materially different AI drone.',
  GALACTA_HEALTH_SCALE_PER_ROUND:
    'AUTHORED (M6). Galacta Bot health multiplier = 1 + this × (round − 1), on top of the larger per-tier composition. Round 1 = ×1.0 (comfortable), round 21 = ×2.2 (threatening). M11 re-tunes. Falsified by a different Practice difficulty curve.',
  GALACTA_DPS_SCALE_PER_ROUND:
    'AUTHORED (M6). As GALACTA_HEALTH_SCALE_PER_ROUND, for Galacta Bot dps (and heal/s). Round 21 = ×2.0.',
};
