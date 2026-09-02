/*
 * M7 — draft heuristics.
 *
 * `balancedDraft` is the M2 placeholder algorithm verbatim (was
 * `sim/botPolicy.placeholderDraftLineup`): an even split across the three
 * roles, then a top-up from the remainder. It is kept as the neutral default —
 * the Equilibrium Purist drafts with it, and it is the human seat's fallback
 * when no `selectLineup` action was supplied — so those two paths are
 * byte-for-byte unchanged from M2–M6.
 *
 * `roleStackDraft` biases a lineup toward one role while keeping it legal — the
 * primitive an archetype (or an M11 rebalance) uses when a single-role stack
 * becomes worth drafting. No current archetype needs a skew on the M4 numbers
 * (Equilibrium dominates a 2-2-2), so all five draft balanced today.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { LINEUP_SIZE } from '../data/constants';
import type { Role } from '../data/types';
import type { Substream } from '../sim/rng';
import type { DraftInput } from './types';

const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];

/**
 * Pick a legal `LINEUP_SIZE`-hero lineup from an 18-hero pool: an even split
 * across the three roles first (`floor(LINEUP_SIZE / 3)` each), then top up from
 * whatever is left. Every draw is from the caller's substream, so the result is
 * deterministic per `(seed, key)`. The pool is guaranteed 6/6/6, so the even
 * split alone yields exactly 6; the top-up only matters if that ever changes.
 */
export function balancedDraft(
  pool: readonly string[],
  roleOf: Readonly<Record<string, Role>>,
  rng: Substream,
): string[] {
  const perRole = Math.floor(LINEUP_SIZE / ROLES.length);
  const picked: string[] = [];

  for (const role of ROLES) {
    const inRole = pool.filter((id) => roleOf[id] === role);
    picked.push(...rng.shuffle(inRole).slice(0, perRole));
  }

  if (picked.length < LINEUP_SIZE) {
    const taken = new Set(picked);
    const rest = rng.shuffle(pool.filter((id) => !taken.has(id)));
    picked.push(...rest.slice(0, LINEUP_SIZE - picked.length));
  }

  return picked.slice(0, LINEUP_SIZE);
}

/**
 * Bias the lineup toward `role`: take up to `want` of that role (capped by
 * what the pool holds and by `LINEUP_SIZE`), then fill the remaining slots with
 * a balanced draw over the other two roles, topping up from the remainder.
 * Always returns exactly `LINEUP_SIZE` distinct pool ids.
 */
export function roleStackDraft(input: DraftInput, role: Role, want: number): string[] {
  const { pool, roleOf, rng } = input;
  const inRole = rng.shuffle(pool.filter((id) => roleOf[id] === role));
  const stackCount = Math.max(0, Math.min(want, inRole.length, LINEUP_SIZE));
  const picked = inRole.slice(0, stackCount);

  const otherRoles = ROLES.filter((r) => r !== role);
  const remainingSlots = LINEUP_SIZE - picked.length;
  const perOther = Math.floor(remainingSlots / otherRoles.length);
  for (const other of otherRoles) {
    const inOther = rng.shuffle(pool.filter((id) => roleOf[id] === other));
    picked.push(...inOther.slice(0, perOther));
  }

  if (picked.length < LINEUP_SIZE) {
    const taken = new Set(picked);
    const rest = rng.shuffle(pool.filter((id) => !taken.has(id)));
    picked.push(...rest.slice(0, LINEUP_SIZE - picked.length));
  }

  return picked.slice(0, LINEUP_SIZE);
}
