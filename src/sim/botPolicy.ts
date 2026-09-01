/*
 * M7 PLACEHOLDER POLICY — this whole file is replaced in M7, not extended.
 *
 * The real opponents (Greedy Banker, Protocol Rusher, Equilibrium Purist,
 * Streak Rider, Adaptive — see the plan's M7 table) each get a full policy
 * bundle: economy, module buys, deploy, drone. None of that exists yet.
 *
 * For M2 every non-human player must only:
 *   1. draft a legal 6-hero lineup, and
 *   2. be "ready" for every phase.
 *
 * This file supplies (1): a naive balanced draft drawn from a substream the
 * caller passes in — so M7's invariant "adding a bot never shifts another's
 * rolls" already holds, because each bot's draft reads `rng.stream('ai:<id>')`
 * and nothing else. (2) is handled in `match.ts`, which treats every non-human
 * player as instantly ready in M2; that is the seam where M7's decision cadence
 * hooks in.
 *
 * `match.ts` also calls `placeholderDraftLineup` for the human player when no
 * valid `selectLineup` action was supplied.
 */

import { LINEUP_SIZE } from '../data/constants';
import type { Role } from '../data/types';
import type { Substream } from './rng';

const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];

/**
 * Pick a legal `LINEUP_SIZE`-hero lineup from an 18-hero pool: an even split
 * across the three roles first (`floor(LINEUP_SIZE / 3)` each), then top up from
 * whatever is left if the split did not fill the lineup. Every draw is from the
 * caller-supplied substream, so the result is deterministic per `(seed, key)`.
 *
 * The pool is guaranteed 6/6/6 by role, so the even split alone yields exactly 6
 * — the top-up branch only exists to stay correct if that ever changes.
 */
export function placeholderDraftLineup(
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
