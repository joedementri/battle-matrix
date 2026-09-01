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
    "Pointer, not a value. Per-hero combat stats are AUTHORED but stored in heroes.json → combat by the ledger's deliberate exception; base health there is canonical.",
  STRENGTHEN_JSON_IS_SKELETON:
    'Marker, not a value. strengthen.json ships id/heroId/slot only in M1; names, effect text and keybinds are M10 (wiki + screenshots) and must not be invented.',
  COMBAT_BANDS:
    'AUTHORED. The M1 milestone band table; per-hero picks in heroes.json must land inside it. M11 re-tunes against the M7 win-rate gate.',
};
