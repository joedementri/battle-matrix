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

Milestone **M7** — the AI opponents.

Five archetype policy bundles live in `src/ai/` (pure and headless, under the
same ESLint override + grep test as `src/sim/`). Each is a bundle over **draft**
(`src/ai/draft.ts`), the **module-shop turn** (`src/ai/shop.ts` drives
`buyModule` / `refreshShop` / `lockShop` from a small `ShopPlan`, and *throws*
if a policy ever asks for something the library would refuse — an illegal ask
is a test failure, not a silent no-op), and **board deployment**
(`src/ai/deploy.ts` builds a 6×4 `Deployment` from the plan's role heuristic:
Vanguards front, ranged Duelists back, melee Duelists flanking, Strategists
back-centre). The shared **drone policy** (`src/sim/dronePolicy.ts`, which
replaces the M6 placeholder wholesale) tracks the nearest enemy, holds the
Encephalo-Ray while an enemy lives, and fires One-Time Damage / Healing at the
plan's ≥ 3 / ≥ 2 low-HP thresholds — RNG-free.

To make an archetype's *spending* actually influence a win rate, M7 also **wired
M4's module economy and a new deployment model into the round loop**:
`PlayerState` now carries `ownedModules` / `protocolXp` / `shop` /
`tokenLedger` / `deployment`; the shop opens for every living player each
Module Draw phase from a **per-player, per-round substream** (`shop:<id>#round`,
honouring `SHOP_LOCK_BEHAVIOUR` carry-over); a thin adapter projects a player
into the `ModuleAccount` shape `modules.ts` / `economy.ts` already use so
`PlayerState.tokens` stays the one balance; and each side's resolved
`SideModules` + `Deployment` ride on `CombatContext` into `combat.ts`, which
resolves the deployment on the `selectPosition` seam and falls back to
`assignFormation` when none is supplied. `src/sim/board.ts` is the pure board
model — validity predicate plus the single cell→arena mapping `combat.ts` now
shares.

Every bot decision draws from a substream keyed by that seat's id
(`ai:<id>#0` draft, `shop:<id>#round`, `ai:<id>:deploy#round`), so — proven in
`tests/ai.spec.ts` — **adding a bot, changing one bot's archetype, or one bot
drawing far more values shifts no other seat's substream cursors or state.**
`RunMatchOptions.ai` (`'aiOnly'` or a per-seat map) drives a fully AI-only
match; seat → archetype rotates by `masterSeed % 5` so the sixth seat's
doubled archetype rotates too and no archetype is confounded with a fixed seat.

Over **100 seeded AI-only matches** every archetype wins between 5 % and 50 %
(measured: 14–23 %; ~9 s inside `npm test`). The five bots also field exactly
six heroes and a legal 6-cell deployment every round, a 10 000-turn shop fuzz
finds no illegal ask / negative balance / over-starred module, and token
conservation (`earned + refunded === spent + tokens`) holds for every player at
every phase boundary.

**Human-seat plumbing** (`buyModule` / `sellModule` / `refreshShop` /
`lockShop` / `deploy` actions) is wired thinly; with no such actions the human
makes no purchases and takes the engine formation. `changeHero` / `swapHero`
are deferred to M8 — they need the role-offer + swap-out flow, not just a
primitive call.

The archetypes drafting, spending and deploying changed the M6 golden replay
outcomes; `tests/replay.spec.ts` was regenerated deliberately in two verified
steps (documented in the file header) — no determinism test was weakened, and
`tests/determinism.spec.ts` is untouched.

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
  call), `src/sim/dronePolicy.ts` (the drone policy),
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
- **M7** — `src/ai/` (the five archetype policy bundles: `draft.ts`, `shop.ts`,
  `deploy.ts`, `archetypes.ts`, `types.ts`), `src/sim/board.ts` (the 6×4 deploy
  board — validity + the shared cell→arena mapping), the real
  `src/sim/dronePolicy.ts`, and the module-economy + deployment wiring in
  `match.ts` (per-player per-round shop, the `ModuleAccount` adapter + token
  ledger, bot shop / deploy turns, the `ai` option and seat rotation, thin
  human `buyModule` / `sellModule` / `refreshShop` / `lockShop` / `deploy`
  actions) and `combat.ts` (`SideModules` + `Deployment` on `CombatContext`).
  `tests/ai.spec.ts` covers substream isolation, the 10 000-turn legality fuzz,
  per-round lineup + deployment legality, token conservation, and the 100-match
  distribution gate with its per-archetype table; `tests/match.spec.ts` gains
  the shop-opens / purchase-persists / XP-accumulates / deployment-persists
  checks and `src/sim/board.ts` validity.

`src/sim/` and `src/ai/` are pure and headless — no DOM, no wall clock, no
`Math.random`, no transcendental math (`Math.sin` / `cos` / `pow` / `hypot` /
`**` — direction is normalised vector math, sqrt only), no `ui/` / `render/`
imports — enforced by an ESLint override *and* a grep test.

See [`PLANS/ultron-battle-matrix-protocol.md`](PLANS/ultron-battle-matrix-protocol.md)
for the full roadmap.

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
associated with NetEase Games, Marvel, or The Walt Disney Company. No game assets
are redistributed. All trademarks and copyrights belong to their respective
owners.
