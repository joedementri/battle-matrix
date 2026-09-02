/*
 * M7 — the five opponent archetypes, each a policy bundle over draft, the
 * module-shop turn, and board deployment (the drone is shared — see
 * `sim/dronePolicy.ts`).
 *
 * | Archetype          | Economy                              | Modules              | Deploy               |
 * |--------------------|--------------------------------------|----------------------|----------------------|
 * | Greedy Banker      | holds a 35 reserve, cashes in round 9 | committed value      | standard formation   |
 * | Protocol Rusher    | spends to zero every round           | committed value      | aggressive front-load|
 * | Equilibrium Purist | balanced, holds a 25 buffer          | Equilibrium only     | standard formation   |
 * | Streak Rider       | dumps to 0 losing, 22 reserve winning | committed value      | aggressive front-load|
 * | Adaptive           | light buffer to r6, then spends       | committed value      | counters last foe    |
 *
 * NOTE ON "Modules": the plan's table gives four of the five archetypes a
 * value judgement ("any", "opportunistic", "best value") rather than a hard
 * constraint. The M4 module data makes Equilibrium strictly best on a diverse
 * (2-2-2) lineup — its per-role bonus is team-wide — so every value-driven
 * archetype rationally converges there via `committedValueScore`. Their
 * identity lives in economy pacing and deployment. M11 hero/module balancing is
 * expected to spread this out; the knobs here are re-tuned only against the
 * distribution gate, never against hero stats.
 *
 * Policies are stateless singletons; each method is a pure function of its input.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { AI_ARCHETYPE_TUNING } from '../data/authored';
import { PLAYER_COUNT, PROTOCOL_XP_THRESHOLDS } from '../data/constants';
import type { Protocol, Role } from '../data/types';
import { buyPrice, moduleById, shopCardValue } from '../sim/modules';
import type { ModuleAccount, ShopCard, ShopState } from '../sim/modules';
import { balancedDraft } from './draft';
import { counterFormation, roleFormation } from './deploy';
import { executeShopPlan } from './shop';
import type { ShopPlan } from './shop';
import { ARCHETYPES } from './types';
import type { AiPolicy, ArchetypeName, DeployInput, DraftInput, ShopTurnInput } from './types';

const T = AI_ARCHETYPE_TUNING;

/** Which role a non-Equilibrium protocol's modules buff. */
const PROTOCOL_ROLE: Readonly<Record<string, Role>> = {
  fortress: 'vanguard',
  onslaught: 'duelist',
  reboot: 'strategist',
};

// ---------------------------------------------------------------------------
// Shared scoring helpers
// ---------------------------------------------------------------------------

function rarityRank(card: ShopCard): number {
  return card.rarity === 'legendary' ? 3 : card.rarity === 'rare' ? 1.5 : 1;
}

function roleCounts(
  lineup: readonly string[],
  roleOf: Readonly<Record<string, Role>>,
): Record<Role, number> {
  const counts: Record<Role, number> = { vanguard: 0, duelist: 0, strategist: 0 };
  for (const id of lineup) {
    const r = roleOf[id];
    if (r !== undefined) counts[r]++;
  }
  return counts;
}

/**
 * Best-VALUE-per-token, weighing how much of the team the module actually
 * reaches: an Equilibrium module scales `per unique role` and hits every unit,
 * so on a diverse lineup it is worth far more than a role-scoped Fortress /
 * Onslaught / Reboot module that only touches its own role's heroes. This is
 * why "best value" archetypes gravitate toward Equilibrium on a 2-2-2 draft.
 */
function teamValuePerToken(
  card: ShopCard,
  lineup: readonly string[],
  roleOf: Readonly<Record<string, Role>>,
): number {
  const module = moduleById(card.moduleId);
  const disp = shopCardValue(module);
  const magnitude = disp.isPercent ? disp.value : disp.value / 40;

  const counts = roleCounts(lineup, roleOf);
  const uniqueRoles =
    (counts.vanguard > 0 ? 1 : 0) + (counts.duelist > 0 ? 1 : 0) + (counts.strategist > 0 ? 1 : 0);

  let reach: number;
  if (module.protocol === 'equilibrium') {
    reach = Math.max(1, uniqueRoles) * Math.max(1, lineup.length); // per-role scope, team-wide
  } else {
    reach = Math.max(1, counts[PROTOCOL_ROLE[module.protocol] ?? 'duelist']); // role-scoped
  }
  return (magnitude * reach) / buyPrice(card.rarity);
}

/** How far a protocol has climbed the 10/20/40 XP ladder, 0..~3. */
function investedRank(account: ModuleAccount, card: ShopCard): number {
  const xp = account.protocolXp[card.protocol];
  const [t1, t2, t3] = PROTOCOL_XP_THRESHOLDS;
  if (xp >= t3) return 3;
  if (xp >= t2) return 2.5;
  if (xp >= t1) return 2;
  return xp >= t1 / 2 ? 1 : 0;
}

const PROTOCOLS: readonly Protocol[] = ['equilibrium', 'onslaught', 'fortress', 'reboot'];

/**
 * The protocol a bot has locked onto — the one it already holds at least L1 XP
 * in (`null` before then). Ties resolve toward Equilibrium.
 */
function committedProtocol(account: ModuleAccount): Protocol | null {
  const [l1] = PROTOCOL_XP_THRESHOLDS;
  let best: Protocol | null = null;
  let bestXp = l1 - 1;
  for (const p of PROTOCOLS) {
    const xp = account.protocolXp[p];
    if (xp > bestXp) {
      bestXp = xp;
      best = p;
    }
  }
  return best;
}

/**
 * The protocol a value bot SHOULD build for this lineup, before it has locked
 * one in: Equilibrium on any lineup with ≥ 2 roles (its per-role, team-wide
 * scaling dominates there), else the dominant role's own protocol.
 */
function preferredProtocol(ctx: ShopTurnInput): Protocol {
  const c = roleCounts(ctx.lineup, ctx.roleOf);
  const uniqueRoles =
    (c.vanguard > 0 ? 1 : 0) + (c.duelist > 0 ? 1 : 0) + (c.strategist > 0 ? 1 : 0);
  if (uniqueRoles >= 2) return 'equilibrium';
  if (c.vanguard >= c.duelist && c.vanguard >= c.strategist) return 'fortress';
  return c.duelist >= c.strategist ? 'onslaught' : 'reboot';
}

/**
 * The "best value" score every non-specialist archetype (Greedy Banker, Streak
 * Rider, Adaptive) uses: team-reach value per token, amplified by how far the
 * card's protocol is already levelled. Concentration is decisive — a levelled
 * protocol gives team-wide tier bonuses and unlocks its Rare / Legendary.
 */
function valueScore(card: ShopCard, account: ModuleAccount, ctx: ShopTurnInput): number {
  const raw = teamValuePerToken(card, ctx.lineup, ctx.roleOf);
  const concentration = 1 + investedRank(account, card) + (card.action === 'upgrade' ? 0.5 : 0);
  return raw * concentration + rarityRank(card) * 0.01;
}

/**
 * Value scoring that COMMITS: build for one protocol — the locked one once L1 is
 * reached, else this lineup's `preferredProtocol` — and refuse every other card
 * so `refreshWhenStuck` digs for it (the same funnel the Equilibrium Purist gets
 * for free). On a 2-2-2 lineup this converges on Equilibrium; the archetypes
 * that share it then differ only by economy timing and deploy.
 */
function committedValueScore(
  card: ShopCard,
  account: ModuleAccount,
  ctx: ShopTurnInput,
): number | null {
  const target = committedProtocol(account) ?? preferredProtocol(ctx);
  return card.protocol === target ? valueScore(card, account, ctx) : null;
}

function runPlan(input: ShopTurnInput, plan: ShopPlan): ShopState {
  return executeShopPlan(input, plan);
}

// ---------------------------------------------------------------------------
// Greedy Banker — keeps the biggest reserve while interest compounds, then
// cashes the fat bank into modules from the cash-in round
// ---------------------------------------------------------------------------

const greedyBanker: AiPolicy = {
  name: 'greedy-banker',
  draftLineup: (input: DraftInput) => balancedDraft(input.pool, input.roleOf, input.rng),
  runShopTurn: (input: ShopTurnInput) =>
    runPlan(input, {
      refreshBudget: T.shopRefreshBudget,
      refreshWhenStuck: true,
      lockAtEnd: false,
      score: committedValueScore,
      // Keep the reserve while interest still compounds; from the cash-in round
      // the bank has done its job, so pour it into modules.
      willSpendTo: (after, ctx) =>
        ctx.round >= T.greedyBankerCashInRound ? after >= 0 : after >= T.greedyBankerHoldTokens,
    }),
  deploy: (input: DeployInput) => roleFormation(input.lineup, input.roleOf),
};

// ---------------------------------------------------------------------------
// Protocol Rusher — forces its committed protocol up the level ladder as fast
// as possible: drafts for maximum role diversity, buys that protocol only,
// spends every last token, and front-loads the board
// ---------------------------------------------------------------------------

const protocolRusher: AiPolicy = {
  name: 'protocol-rusher',
  // A 2-2-2 draft maximises unique roles, which is what its committed protocol
  // (Equilibrium, on this lineup) scales with.
  draftLineup: (input: DraftInput) => balancedDraft(input.pool, input.roleOf, input.rng),
  runShopTurn: (input: ShopTurnInput) =>
    runPlan(input, {
      refreshBudget: T.shopRefreshBudget,
      refreshWhenStuck: true,
      lockAtEnd: false,
      // Committed-protocol only (so a refresh digs for it), and spend to zero —
      // the fastest climb up the 10/20/40 XP ladder of any archetype.
      score: committedValueScore,
      willSpendTo: (after) => after >= 0,
    }),
  deploy: (input: DeployInput) => roleFormation(input.lineup, input.roleOf, { rowShift: 1 }),
};

// ---------------------------------------------------------------------------
// Equilibrium Purist — Equilibrium modules only, keeps a small buffer
// ---------------------------------------------------------------------------

const equilibriumPurist: AiPolicy = {
  name: 'equilibrium-purist',
  draftLineup: (input: DraftInput) => balancedDraft(input.pool, input.roleOf, input.rng),
  runShopTurn: (input: ShopTurnInput) =>
    runPlan(input, {
      refreshBudget: T.shopRefreshBudget,
      refreshWhenStuck: true,
      lockAtEnd: false,
      score: (card, account, ctx) =>
        card.protocol === 'equilibrium' ? 10 + valueScore(card, account, ctx) : null,
      willSpendTo: (after) => after >= T.equilibriumPuristHoldTokens,
    }),
  deploy: (input: DeployInput) => roleFormation(input.lineup, input.roleOf),
};

// ---------------------------------------------------------------------------
// Streak Rider — dumps to zero on a loss streak, keeps a small reserve winning
// ---------------------------------------------------------------------------

const streakRider: AiPolicy = {
  name: 'streak-rider',
  draftLineup: (input: DraftInput) => balancedDraft(input.pool, input.roleOf, input.rng),
  runShopTurn: (input: ShopTurnInput) => {
    const losing = input.streakKind === 'loss';
    return runPlan(input, {
      refreshBudget: T.shopRefreshBudget,
      refreshWhenStuck: true,
      lockAtEnd: false,
      score: committedValueScore,
      willSpendTo: (after) => (losing ? after >= 0 : after >= T.streakRiderWinSaveTokens),
    });
  },
  deploy: (input: DeployInput) => roleFormation(input.lineup, input.roleOf, { rowShift: 1 }),
};

// ---------------------------------------------------------------------------
// Adaptive — light interest early, full best-value spending from round 6
// ---------------------------------------------------------------------------

const adaptive: AiPolicy = {
  name: 'adaptive',
  draftLineup: (input: DraftInput) => balancedDraft(input.pool, input.roleOf, input.rng),
  runShopTurn: (input: ShopTurnInput) =>
    runPlan(input, {
      refreshBudget: T.shopRefreshBudget,
      refreshWhenStuck: true,
      lockAtEnd: false,
      score: committedValueScore,
      // A light buffer while interest matters, then spend down to almost nothing.
      willSpendTo: (after, ctx) =>
        after >= (ctx.round <= T.adaptiveHoldUntilRound ? 15 : 3),
    }),
  deploy: (input: DeployInput) => counterFormation(input),
};

// ---------------------------------------------------------------------------
// Registry + seat assignment
// ---------------------------------------------------------------------------

const BY_NAME: Readonly<Record<ArchetypeName, AiPolicy>> = {
  'greedy-banker': greedyBanker,
  'protocol-rusher': protocolRusher,
  'equilibrium-purist': equilibriumPurist,
  'streak-rider': streakRider,
  adaptive,
};

export function resolvePolicy(name: ArchetypeName): AiPolicy {
  return BY_NAME[name];
}

/**
 * Seat → archetype for `masterSeed` (`AI_SEAT_ROTATION`): seat `i` runs
 * `ARCHETYPES[(i + masterSeed % ARCHETYPES.length) % ARCHETYPES.length]`. Six
 * seats, five archetypes, so seat 5 always doubles seat 0 — but *which*
 * archetype rotates every seed, so aggregated over many seeds each archetype
 * takes the extra seat equally often.
 */
export function seatArchetypes(masterSeed: number): ArchetypeName[] {
  const rot = (masterSeed >>> 0) % ARCHETYPES.length;
  const out: ArchetypeName[] = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    out.push(ARCHETYPES[(i + rot) % ARCHETYPES.length]!);
  }
  return out;
}
