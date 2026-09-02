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

Milestone **M10** — the 78 Strengthen Modules.

The mode's per-hero modules: 39 heroes × 2. `src/data/strengthen.json`'s M1
skeleton is now populated, **row ids unchanged** (`${heroId}-s${slot}` — M4 / M6
state, tests and goldens key off them).

**Sourcing is the honest half of this milestone.** The canonical strings live
outside this repo and the mode has been removed from the game:

- **3 modules** — *Loki's Sanctuary*, *Soul Reaper*, *Ghost Thornlash Wall* —
  are transcribed **verbatim from the reward screenshot** (the highest-authority
  source), inline keybind chips included (`LSHIFT` / `LMB` / `LSHIFT`).
- **73 modules** come from a secondary guide (Destructoid). Names are
  trustworthy; the effect *wording* is that outlet's style-normalised copy
  ("percent" not "%", "seconds" not "s"), unverified against in-game text — and
  their keybinds are unknown.
- **2 modules** — both of Emma Frost's — **could not be sourced** and keep the
  empty skeleton strings. The Fandom wiki, Mobalytics and the Wayback Machine
  are all unreachable from the fetcher (402 / 403 / blocked); nothing was
  invented to fill them.

`docs/FIDELITY.md` records the provenance and fidelity grade of every one of the
78 rows, the screenshot-versus-guide conflicts and how they were resolved, and
the two gaps. `validate.ts` enforces "fully populated **or** a documented gap —
never half"; `tests/strengthen.spec.ts` snapshots every name / effect / keybind
**character-for-character**.

**Implementations live in `src/sim/strengthen.ts`** (following the M5 split —
`abilities.ts` = ult archetypes, `effects.ts` = Base-Module behaviour;
`abilities.ts` re-exports the surface). M5 models no discrete abilities and no
cooldowns, so **every one of the 76 implemented modules is an annotated
approximation** — a `passive` stat delta folded into the hero's `ResolvedUnit`
at battle build (59 modules), or an `onUlt` timed self-buff opened on the
ultimate cast (17). Each spec carries a non-null `approximation` string naming
the real mechanic and the substitute; `missingStrengthenHandlers` /
`staleStrengthenHandlers` / `stubStrengthenHandlers` are the completeness net
(all empty — no reachable `TODO`, no no-op handler).

**Each module has a scenario descriptor and a forced-scenario "it does
something" test.** A naive 1v1 false-negatives on situational effects, so every
spec carries a `StrengthenScenario` (lineups, battle length, forced ult / health
fraction, spawn geometry, the aggregate to measure) and the harness constructs
it deterministically, then asserts a measurable delta between module-active and
module-inactive runs at the same seed — 76 cases, one per module, never
loosened.

**Jeff the Land Shark's *Looting Leviathan*** grants Base Modules on its own
rarity table (`4 → 90 / 8 / 2`, `5 → 60 / 30 / 10`, `6+ → 0 / 70 / 30` —
plan-supplied) and **bypasses the derived shop-odds formula entirely**:
`modules.ts` gains `lootingLeviathanRarityOdds` / `rollLootingLeviathanRarity` /
`grantLootingLeviathanModules`, a path that never calls `rarityOdds` and never
touches a shop draw; its 100 000-roll distribution test draws from a dedicated
named substream so it cannot shift any other consumer's rolls.

Combat threads each player's equipped Strengthen loadout into the resolver
(`CombatContext.sideX.strengthen`), so the M8 **Reward screen lights up on its
own** — real names, effect text and inline keybind chips, no renderer change —
and the left-rail Strengthen counter increments as before. Real effects move
combat outcomes, so **`tests/replay.spec.ts`'s golden replays were regenerated
deliberately** (`determinism.spec.ts` is untouched, and a battle with no
Strengthen modules keeps its pre-M10 digest byte-for-byte). The M7 AI
distribution gate still holds.

### M9 — the Canvas2D battle renderer and the battle HUD

The renderer is split the same way the UI is, so it is testable without a real
Canvas2D context (`jsdom` / `happy-dom` have none):

- **Frame builder** (`src/render/frame.ts`, pure) — `(deep-readonly snapshot,
  interpolation alpha, HUD state) → draw-command list`: token positions, health-
  bar segment counts, ult-charge fills, damage numbers, target lines, the drone,
  the kill feed, the names, the `LSHIFT` / `E` buttons, the hint bar, the Speed
  Up banner. No `ctx`, no DOM. Tests assert on the command list.
- **Executor** (`src/render/executor.ts`, thin) — walks the list issuing
  Canvas2D calls, applies `devicePixelRatio`, batches by style, caches resolved
  colour tokens + text metrics + parsed shape paths, and pre-renders the static
  arena to an offscreen canvas. No `shadowBlur`, no `filter`, no frame-loop
  allocation (pooled `CmdList`).

Measured **build + executor ≈ 0.09 ms/frame** with 12 units plus damage numbers,
kill feed, beam and the Speed Up banner — far inside the 16.6 ms / 60 fps budget.
`?debug` in the URL hash shows a live frame-timing readout.

**The sim runs at exactly 30 Hz integer ticks; the renderer interpolates.**
`src/render/loop.ts` is an accumulator loop with the three failure modes handled
explicitly — the per-frame delta is clamped, a runaway backlog past the catch-up
cap is *dropped* rather than chased (the spiral of death), and nothing the
renderer computes ever reaches sim state. Tick count is a function of elapsed sim
time alone: `tests/render.spec.ts` drives the same elapsed time as 30 / 60 /
144 fps synthetic deltas and asserts identical tick counts *and* byte-identical
sim state, plus a 5-second frame-delta clamp and a full frame built against a
deep-frozen snapshot.

`src/sim/combat.ts` gained a steppable `BattleController` (identical tick order
and RNG draws to `simulateBattle`, which is now a thin wrapper over it) and a
plain per-tick `sampleBattleFrame` projection. The kill feed consumes M5's
append-only `KillEvent[]` **by cursor**; the floating damage numbers consume M5's
per-hit `damageLog` the same way (renderer-local ephemeral state — never in sim
state). Galacta Bots draw as **distinct monster tokens**, resolved — with heroes
and the drone — through a single `resolveUnitArt` / `resolveDroneArt` in
`src/ui/heroArt.ts`, keeping the one-file image drop-in property.

**Live keyboard / mouse becomes M6's deterministic per-tick drone stream here.**
Input is latched by `GameApp` and read once per sim tick (not per frame),
quantized at capture (`encodeDroneMove`), and banked as one `driveDrone` action
per battle so `runMatch` resolves that round with the flown drone — a captured
match replays byte-identically. `LALT` toggles pointer-drives-drone ⇄
pointer-free-for-UI (the 2D adaptation of the original's mouse-look release);
`B` opens the module menu over the still-ticking battle with the "effects apply
next round" notice, proven end to end.

The **camera is a deliberate deviation**: the screenshots show a 3D third-person
chase view, our arena is a 2D canvas, so the whole arena renders top-down with
the drone as one more token — the 6×4 placement is the point of the mode. Both
this and the `LALT` adaptation are recorded in `docs/QA.md` §6.

---

### M8 — the UI shell, chrome, and menu screens

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
**Battle** (the M9 Canvas2D renderer — top-down arena, segmented health bars,
ult-charge bars, damage numbers, the drone, monster tokens for Galacta Bots, the
cursor-fed kill feed, `LSHIFT` / `E` buttons that grey exactly when the sim marks
the ability spent, and the Speed Up Protocol announcement), **Reward** (renders
`strengthen.json` from data with no invented text — three gold cards, hero art,
inline keybind chips; it lit up on its own in M10 with no renderer change),
**Scoreboard** (fully public, six lineups, four protocol levels, Strengthen
counts, top-3 divider), **Final Standings**, and the left-rail **protocol info
pane** (tier bonuses with the earned one in cyan, the `★ = XP+1 …` legend, and
Owned Modules at their *cumulative* value). Hero art is one abstract role token
(shield / blade / cross + 2-letter initials + Strengthen pip), resolved through
a single `resolveHeroArt` so a later image drop-in touches one file.

**Colour tokens are defined once**, in `src/ui/theme.css`; `tests/theme.spec.ts`
reads that file and asserts every hex from the plan's table. Two enforcement
greps back the architecture, now scanning **`src/ui/**` *and* `src/render/**`**:
**no arithmetic on tokens / health / XP outside `src/sim/`**
(`tests/enforce-no-arith.spec.ts` — health-bar segment counts / ult fills / the
position tween come from `src/sim/selectors.ts`, so the allowlist is *empty*) and
**every visible string comes from `strings.ts`** (`tests/enforce-strings.spec.ts`
— one allowlist entry, the `text/plain` drag-and-drop MIME type). `docs/QA.md` is
the side-by-side screenshot checklist, one row per screen, with the responsive /
reduced-motion record and the M9 camera / `LALT` deviations.

The sim-facing additions stay small and additive: `swapHero` and `driveDrone` in
the `Action` union (`driveDrone` carries the human's recorded per-round drone
stream — round-addressed, folded into `runMatch` up front), a steppable
`BattleController` + `sampleBattleFrame` in `combat.ts`, a `humanBattleContext`
context-rebuilder in `match.ts`, mid-battle `buyModule` applied after the round's
combat, and the pure `src/sim/selectors.ts` helpers (`leftRailMeter`,
health-descending / scoreboard ordering, the info-pane tier rows, the
Change-Hero / Reward offer sets, and now `healthBarModel` / `ultChargeFraction` /
`lerp`). No `MatchState` shape change. **The determinism and golden replay hashes
are byte-identical to M7 / M8** — no existing action list emits the new members,
and the damage-number stream is M5's existing `trace` output consumed read-only.

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
- **M9** — the battle renderer: `src/render/frame.ts` (the pure frame builder +
  `CmdList` pool), `src/render/executor.ts` (the thin Canvas2D executor),
  `src/render/loop.ts` (the fixed-timestep accumulator), `src/render/arena.ts`
  (the offscreen static arena), `src/render/killFeed.ts` +
  `src/render/damageNumbers.ts` (cursor consumers of M5's event streams),
  `src/render/readonly.ts` (`DeepReadonly` + `deepFreeze`), and
  `src/render/battleRenderer.ts` (the orchestrator — `<canvas>`, dpr, the loop,
  the stepped `BattleController`, live drone-input capture). In `src/sim`:
  `BattleController` / `sampleBattleFrame` in `combat.ts`, `humanBattleContext`
  in `match.ts`, `driveDrone` in the `Action` union, and `healthBarModel` /
  `ultChargeFraction` / `lerp` in `selectors.ts`; `resolveUnitArt` /
  `resolveDroneArt` in `src/ui/heroArt.ts`. `tests/render.spec.ts` covers the
  deep-frozen-snapshot render, kill-feed ordering / once-only / cap /
  reduced-motion, tick-rate-independent interpolation at 30 / 60 / 144 fps, the
  spiral-of-death clamp, the ability button greying on the exact consume tick,
  the frame-builder layout vs the screenshots, the monster tokens, the measured
  frame timing, the mid-battle purchase flagged next-round end to end, and the
  `driveDrone` round-trip determinism. The two enforcement greps now also scan
  `src/render/**`. `docs/QA.md` §6 is the battle-HUD checklist against both
  battle screenshots with the camera / `LALT` deviations recorded.
- **M10** — the 78 Strengthen Modules: `src/data/strengthen.json` populated (76
  of 78 sourced — 3 screenshot-verbatim, 73 from a secondary guide; 2
  unsourced and reported, never invented), `src/sim/strengthen.ts` (the module
  registry, `applyPassiveStrengthen`, the `onUlt` self-buff, per-module scenario
  descriptors, and the completeness net), `src/sim/modules.ts`'s isolated
  *Looting Leviathan* rarity path, and the Strengthen wiring in `combat.ts`
  (`CombatContext.sideX.strengthen` → passive folds + the `onUlt` window) and
  `match.ts` (`strengthenOf` per side). `docs/FIDELITY.md` (new) is the
  per-entry provenance record. `tests/strengthen.spec.ts` covers the 78-row
  shape with M1 ids intact, the character-for-character text snapshot, the
  registered/non-stub completeness net, the 76-case forced-scenario harness,
  Jeff's 100 000-roll distribution within ±1 % of all three tables, and the
  swap-conversion count invariant with real modules; `tests/replay.spec.ts`'s
  golden replays were regenerated for the new combat outcomes.

`src/sim/` and `src/ai/` are pure and headless — no DOM, no wall clock, no
`Math.random`, no transcendental math (`Math.sin` / `cos` / `pow` / `hypot` /
`**` — direction is normalised vector math, sqrt only), no `ui/` / `render/`
imports — enforced by an ESLint override *and* a grep test. `src/ui/` and
`src/render/` invert the dependency (they read `src/sim`, never the reverse):
`src/render/` owns the wall clock and Canvas2D, and both layers are held to no
arithmetic on tokens / health / XP and every visible string sourced from
`src/data/strings.ts`.

See [`PLANS/ultron-battle-matrix-protocol.md`](PLANS/ultron-battle-matrix-protocol.md)
for the full roadmap.

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
associated with NetEase Games, Marvel, or The Walt Disney Company. No game assets
are redistributed. All trademarks and copyrights belong to their respective
owners.
