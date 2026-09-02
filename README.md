# Battle Matrix

An unofficial, non-commercial fan project that replicates the mechanics of
**Ultron's Battle Matrix Protocol** — the Season 2.5 limited-time auto-battler
mode from *Marvel Rivals* (live 6 June – 23 June 2025, since removed from the
game).

Built with TypeScript, Vite, and Vitest. **Zero runtime dependencies.**

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server (playable UI shell) |
| `npm run build` | Type-check, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:determinism` | Same-seed replay hashing — phase-boundary hashes for a full match, the 100× tick-by-tick combat digest, and the committed golden replays |
| `npm run lint` | Lint with ESLint |

Append `#seed=<n>` to the URL to pin a match (default: `20250606`, the mode's
launch date).

## Status

Milestone **M8** — the UI shell, chrome, and menu screens.

The UI is split in two, so "no game rule lives in a component" is structural
rather than a matter of discipline:

- **View models** (`src/ui/viewmodels/`) — pure `state → plain data` functions.
  Every screenshot-derived assertion is tested here, no DOM environment needed
  (`tests/hud.spec.ts`). All numeric derivation calls a `src/sim` export
  (`economy.previewIncome`, `modules.rarityOdds` / `shopCardValue` / `ownedValue`,
  the new `src/sim/selectors.ts`); the UI layer may only *format*.
- **Renderers** (`src/ui/screens/`, `src/ui/chrome/`) — thin view-model → DOM,
  hand-rolled vanilla TS + a ~50-line `h()` helper (runtime `dependencies` stays
  `{}`; `happy-dom` is a **devDependency**, scoped per-file with
  `// @vitest-environment happy-dom`).

**The game loop lives in the UI, not the sim** (`src/sim/` has no clock).
`src/ui/app.ts` (`GameApp`) owns `requestAnimationFrame` + the wall clock, an
append-only `Action[]`, and a phase cursor into the boundary list `runMatch`
returns; every user gesture becomes exactly one sim `Action` and screens route
off `state.phaseKind`. Bot turns resolve inside `runMatch` through `src/ai/` —
the right-hand player list and the scoreboard render the real archetypes' state.
The full round trip (Draft → Module Draw → Select Position → Battle → Reward →
round 2, against the real combat resolver) is driven from on-screen controls in
`tests/ui-render.spec.ts`.

Nine screens plus the persistent chrome: **Draft**, **Module Draw** (all three
tabs, the rarity-odds row, `PURCHASE`/`UPGRADE` cards with the level-1 value and
owned-level star row, red-when-unaffordable price, empty-slot-after-purchase,
`LOCK` → `REFRESH` disabled + padlock on four), **Change Hero** (3 / 6 / 3 role
offers), **Swap-out** (Reserve above Active, confirm gated on one of each),
**Select Position** (6×4 own-half grid, drag-and-drop *and* keyboard placement,
swap-on-collision so it can never double-occupy / exceed six / cross off-grid),
**Battle** (M8 shell only — the Canvas2D renderer is M9), **Reward** (renders
`strengthen.json`'s M1 skeleton verbatim — nothing invented; lights up in M10),
**Scoreboard** (fully public, six lineups, four protocol levels, Strengthen
counts, top-3 divider), **Final Standings**, and the left-rail **protocol info
pane** (tier bonuses with the earned one in cyan, the `★ = XP+1 …` legend, and
Owned Modules at their *cumulative* value). Hero art is one abstract role token
(shield / blade / cross + 2-letter initials + Strengthen pip), resolved through
a single `resolveHeroArt` so a later image drop-in touches one file.

**Colour tokens are defined once**, in `src/ui/theme.css`; `tests/theme.spec.ts`
reads that file and asserts every hex from the plan's table. Two enforcement
greps back the architecture: **no arithmetic on tokens / health / XP outside
`src/sim/`** (`tests/enforce-no-arith.spec.ts` — bar fills use CSS `calc()` over
custom properties, so the allowlist is *empty*) and **every visible string comes
from `strings.ts`** (`tests/enforce-strings.spec.ts` — one allowlist entry, the
`text/plain` drag-and-drop MIME type). `docs/QA.md` is the side-by-side
screenshot checklist, one row per screen, with the responsive / reduced-motion
record.

The one sim-facing addition is `swapHero` in the `Action` union (wired through
the existing M4 swap primitives, no `MatchState` shape change) and the pure
`src/sim/selectors.ts` (`leftRailMeter`, health-descending / scoreboard
ordering, the info-pane tier rows, and the Change-Hero / Reward offer sets the
sim computes but does not persist). `tsconfig` gained `"DOM"` in `lib` — additive
type declarations, not a strictness change; `src/sim` / `src/ai` headlessness is
still enforced by the ESLint override and the grep. **The determinism and golden
replay hashes are byte-identical to M7** — no existing action list emits the new
members.

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
- **M8** — the UI: `src/ui/theme.css` (colour tokens, asserted by
  `tests/theme.spec.ts`), `src/ui/viewmodels/` (pure `state → data`),
  `src/ui/chrome/` + `src/ui/screens/` (view-model → DOM renderers),
  `src/ui/app.ts` (`GameApp` — the `requestAnimationFrame` loop, the append-only
  action list + phase cursor, every gesture → one sim action), `src/ui/dom.ts` /
  `heroArt.ts` / `heroToken.ts` / `format.ts` / `intents.ts`, and
  `src/sim/selectors.ts` + the `swapHero` action. `tests/hud.spec.ts`
  (income preview vs `previewIncome` over 500 states, the rarity-odds row for
  all 256 protocol-level combinations, left-rail meters at every XP 0–60, the
  shop-card / lock / change-hero / swap-out / scoreboard view models against the
  screenshot values), `tests/ui-actions.spec.ts` (every UI action → a legal sim
  action; drag-and-drop legality over 5 000 random drops), `tests/ui-render.spec.ts`
  (happy-dom renderer smoke + a full-round `GameApp` walk), and the two
  enforcement greps. `docs/QA.md` pairs each screen with its screenshot.

`src/sim/` and `src/ai/` are pure and headless — no DOM, no wall clock, no
`Math.random`, no transcendental math (`Math.sin` / `cos` / `pow` / `hypot` /
`**` — direction is normalised vector math, sqrt only), no `ui/` / `render/`
imports — enforced by an ESLint override *and* a grep test. `src/ui/` inverts
the dependency (it reads `src/sim`, never the reverse) and its own greps keep
game rules out of the components: no arithmetic on tokens / health / XP, and
every visible string sourced from `src/data/strings.ts`.

See [`PLANS/ultron-battle-matrix-protocol.md`](PLANS/ultron-battle-matrix-protocol.md)
for the full roadmap.

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
associated with NetEase Games, Marvel, or The Walt Disney Company. No game assets
are redistributed. All trademarks and copyrights belong to their respective
owners.
