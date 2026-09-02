/*
 * M7 — the AI policy contract. Five archetypes (`ARCHETYPES`), each a bundle
 * over draft, the module-shop turn, and board deployment. The drone is NOT
 * here: the plan gives one drone rule for every seat, so it lives in
 * `src/sim/dronePolicy.ts` and is shared.
 *
 * `src/ai/` obeys the same purity rules as `src/sim/` (enforced by the ESLint
 * override and `tests/purity.spec.ts`): pure, headless, deterministic, no
 * `ui/` / `render/` imports. It depends on `src/sim/` (rng, modules, board,
 * stats), never the reverse.
 */

import type { Role } from '../data/types';
import type { Deployment } from '../sim/board';
import type { ModuleAccount, OwnedModule, ProtocolLevels, ShopState } from '../sim/modules';
import type { Substream } from '../sim/rng';
import type { StreakKind } from '../sim/types';

/**
 * The five opponents, in canonical order. Seat → archetype assignment rotates
 * this list by `masterSeed % ARCHETYPES.length` (see `authored.ts` →
 * `AI_SEAT_ROTATION`).
 */
export const ARCHETYPES = [
  'greedy-banker',
  'protocol-rusher',
  'equilibrium-purist',
  'streak-rider',
  'adaptive',
] as const;

export type ArchetypeName = (typeof ARCHETYPES)[number];

// ---------------------------------------------------------------------------
// Decision inputs
// ---------------------------------------------------------------------------

export interface DraftInput {
  /** The player's 18-hero pool (6 / 6 / 6 by role). */
  readonly pool: readonly string[];
  readonly roleOf: Readonly<Record<string, Role>>;
  /** Per-player draft substream (`ai:<id>#0`). */
  readonly rng: Substream;
}

export interface ShopTurnInput {
  readonly round: number;
  /**
   * The live `ModuleAccount` view of the player (tokens + owned + protocol XP +
   * ledger). The policy drives `buyModule` / `sellModule` / `refreshShop`
   * against it; `match.ts` commits it back afterwards.
   */
  readonly account: ModuleAccount;
  /** The shop as just opened this round (carry-over already applied). */
  readonly shop: ShopState;
  /** Per-player, per-round shop substream (`shop:<id>#round`). */
  readonly rng: Substream;
  readonly streakKind: StreakKind;
  readonly streak: number;
  /** The player's current lineup — for value scoring that weighs team reach. */
  readonly lineup: readonly string[];
  readonly roleOf: Readonly<Record<string, Role>>;
}

export interface DeployInput {
  readonly lineup: readonly string[];
  readonly roleOf: Readonly<Record<string, Role>>;
  readonly protocolLevels: ProtocolLevels;
  readonly ownedModules: readonly OwnedModule[];
  /** The lineup of the opponent this player last faced, or `null` (Adaptive). */
  readonly lastOpponentLineup: readonly string[] | null;
  /** Per-player, per-round deploy substream (`ai:<id>:deploy#round`). */
  readonly rng: Substream;
}

// ---------------------------------------------------------------------------
// The policy bundle
// ---------------------------------------------------------------------------

export interface AiPolicy {
  readonly name: ArchetypeName;
  /** Choose 6 hero ids from `pool`. */
  draftLineup(input: DraftInput): string[];
  /** Spend / refresh / lock this round; return the final shop state. */
  runShopTurn(input: ShopTurnInput): ShopState;
  /** Place the 6 lineup heroes on the 6×4 board (index = lineup slot). */
  deploy(input: DeployInput): Deployment;
}
