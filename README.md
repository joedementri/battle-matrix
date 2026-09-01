# Battle Matrix

An unofficial, non-commercial fan project that replicates the mechanics of
**Ultron's Battle Matrix Protocol** — the Season 2.5 limited-time auto-battler
mode from *Marvel Rivals* (live 6 June – 23 June 2025, since removed from the
game).

Built with TypeScript, Vite, and Vitest. **Zero runtime dependencies.**

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:determinism` | Same-seed replay hashing — phase-boundary hashes for a full match, the 100× tick-by-tick combat digest, and the committed golden replays |
| `npm run lint` | Lint with ESLint |

## Status

Milestone **M6** — the Ultron Drone and the Practice Protocol.

The drone is **input, not a unit.** It never enters `field.units`, so no
targeting code can acquire it and nothing can damage it; its HP is a frozen
copy of the owning player's 50-based health and changes only between rounds,
through round results. Its control is a deterministic, **quantized** per-tick
stream carried in the action list (`src/sim/drone.ts` → `DroneInputStream`):
movement as a fixed-point normalised vector (integer components in
`±DRONE_MOVE_QUANT`, sqrt-normalised at read time — no raw float, no angles),
ability presses as absolute tick indices, the Encephalo-Ray hold as tick
ranges. Same seed + same stream hashes identically; a one-quant nudge to a
single move frame changes the digest. The sim supports **N drones with
pluggable input** — yours from the recorded stream, an opponent's from a
policy — and ships a minimal, RNG-free **M7 placeholder policy**
(`src/sim/dronePolicy.ts`, replaced wholesale in M7). `Encephalo-Ray` (hold
LMB, infinite ammo) does a burning-beam trickle whose budget is an *assertion,
not a constant*: `tests/drone.spec.ts` measures it held the entire battle and
proves it is **< 0.1 % of a Duelist's whole-battle damage** (≈ 0.02 % in the
test) — never a win condition. `LSHIFT` One-Time Damage hits every living
enemy unit and no allies; `E` One-Time Healing the reverse; each fires at most
once per Battle Phase, resets next round, and emits a kill event with the
drone as `killer`. Colour is one of the canonical six, drawn once per match
from a named substream.

**Galacta Bots** (`src/sim/galacta.ts` + `src/data/galacta.json`) are
team-agnostic `Unit`s — `combat.ts` builds them onto side B exactly like
heroes and only carries an `isGalactaBot` flag for M9's monster art. Waves for
rounds 1 / 6 / 11 / 16 / 21 scale with the round number on top of a growing
composition (6 units / ~1030 HP at round 1 → 15 units / ~7150 HP at round 21):
rounds 1 and 6 are comfortable for a reasonable lineup, later waves are
genuinely threatening (M11 tunes).

The **Practice reward phase** (phase 4) grants Strengthen Modules — 1 on
rounds 1 & 6, 2 on 11 / 16 / 21 — from three offers scoped to the current
lineup, excluding modules already owned, with one free `REFRESH 1/1`. Rounds
that pay 2 use one offer set of three, select two. Grants are unconditional
(a Practice loss still pays), Practice rounds cost no health, and a documented
`offerFewer` fallback handles the shrinking eligible pool without throwing.
Each unpublished rule — PvE-loss health, reward-on-win, the multi-reward
shape, the offer fallback, and whether a mirror / phantom matchup fields an
opponent drone — is pinned by a named `src/data/authored.ts` constant with a
provenance note.

Real Galacta waves and drones changed the M5 golden replay outcomes;
`tests/replay.spec.ts` was regenerated deliberately (documented in the file
header) — no determinism test was weakened.

Delivered so far:

- **M0** — Vite + strict TypeScript + Vitest scaffold and the GitHub Pages deploy pipeline.
- **M1** — canonical data layer in `src/data/`: 39 heroes, every Base Module table
  verbatim, all in-game strings, and the canonical / authored / derived value split.
- **M2** — `src/sim/rng.ts` (seeded PRNG + isolated named substreams),
  `src/sim/types.ts` (JSON-serializable state + `serializeState` / `hashState`),
  `src/sim/match.ts` (`runMatch(seed, actions, combatResolver)`), and the
  `CombatResolver` seam.
- **M3** — `src/sim/economy.ts`: round-start income (base → interest → streak),
  the win/loss streak counter, the +2 PvP win bonus, HP compensation,
  `previewIncome`, and `spend`, wired into the two seams `match.ts` left. Each
  open economy question (PvE / tie / phantom streak rules, the HP-compensation
  clamp) is pinned by a named `src/data/authored.ts` constant.
- **M4** — `src/sim/modules.ts` (rarity odds, the 4-card draw, buy/upgrade/sell,
  protocol XP → level, lock/refresh, Change Hero offers, swap + Strengthen
  conversion) and `src/sim/stats.ts` (module stack → `ResolvedUnit[]`, the
  regression net M11 balances against).
- **M5** — `src/sim/combat.ts` (the 30 Hz deterministic tick sim + the real
  `CombatResolver`), `src/sim/effects.ts` (behavioural Base Module hooks +
  completeness net), and `src/sim/abilities.ts` (the six-archetype ultimate
  registry). `tests/combat.spec.ts` covers the 100× tick-by-tick hash, the
  targeting matrix, a hand-computed 1v1 time-to-kill, Speed Up's exact ×2.2
  non-compounding, multiplicative damage reductions, overflow-healing, and one
  kill event per KO; `tests/replay.spec.ts` commits five full-match golden
  outcomes with a documented regeneration path.
- **M6** — `src/sim/drone.ts` (the Ultron Drone: quantized deterministic input
  model, the N-drone / policy seam, colour draw, the mirror / phantom matchup
  call), `src/sim/dronePolicy.ts` (the M7 placeholder policy),
  `src/sim/galacta.ts` + `src/data/galacta.json` (team-agnostic Galacta Bot
  waves with per-round scaling), and `src/sim/practice.ts` (the Practice
  reward phase — offers, refresh, selection, grant, ownership, the shrinking-
  pool fallback), wired into `combat.ts` (drones tick, Galacta side B, digest
  folds drone state) and `match.ts` (per-player drone colour, per-matchup
  drones, the reward phase, `selectReward` / `refreshReward` actions).
  `tests/drone.spec.ts` and `tests/practice.spec.ts` cover the one-time-ability
  guards and reset, targeting all-enemies / all-allies, the measured
  Encephalo-Ray budget, the drone being un-targetable and un-damageable, drone
  HP tracking player health, same-seed + same-input determinism, the
  1 / 1 / 2 / 2 / 2 reward counts, lineup-scoped offers, single refresh, the
  shrinking-pool edge, unconditional grants, health-neutral Practice rounds,
  the mid-battle `B MODULES` freeze end to end, and the swap-conversion path.

`src/sim/` is pure and headless — no DOM, no wall clock, no `Math.random`, no
transcendental math (`Math.sin` / `cos` / `pow` / `hypot` / `**` — direction is
normalised vector math, sqrt only), no `ui/` / `render/` imports — enforced by
an ESLint override *and* a grep test.

See [`PLANS/ultron-battle-matrix-protocol.md`](PLANS/ultron-battle-matrix-protocol.md)
for the full roadmap.

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
associated with NetEase Games, Marvel, or The Walt Disney Company. No game assets
are redistributed. All trademarks and copyrights belong to their respective
owners.
