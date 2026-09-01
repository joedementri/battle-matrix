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
| `npm run test:determinism` | 100× same-seed match replay, hashing every phase boundary |
| `npm run lint` | Lint with ESLint |

## Status

Milestone **M4** — the module system. `src/sim/modules.ts` implements the
DERIVED shop-rarity-odds formula, the 4-card draw (rarity gated by protocol
level, no duplicate module in one set, maxed modules excluded from later
draws), buy/upgrade/sell (XP is granted per star, including upgrades; selling
refunds `sellValue × stars` and can drop a protocol level), shop lock/refresh,
and Change Hero → swap-out with Strengthen-Module conversion back to a
selectable pool. `src/sim/stats.ts` folds a battle-start lineup's owned
modules and protocol levels into a `ResolvedUnit[]`: health resolves flat
additive → percentage multiplier → round-start bonus health (never
multiplied), and damage resolves the ally-module percentage sum, the
protocol-level bonus, and enemy interference as three separate multiplicative
factors. The two value-display rules — a shop card always shows the level-1
value, the info pane shows the cumulative value at the owned level — are
tested against the exact screenshot strings. Five previously-unpublished shop
details (protocol/module selection, no-duplicates handling, maxed-module
exclusion, per-star selling, and LOCK's shop-wide scope) are each pinned as a
named `src/data/authored.ts` constant. Not yet wired into `match.ts`'s round
loop — that seam, and the real combat tick sim, land in M5.

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

`src/sim/` is pure and headless — no DOM, no wall clock, no `Math.random`, no
`ui/` / `render/` imports — enforced by an ESLint override *and* a grep test.

See [`PLANS/ultron-battle-matrix-protocol.md`](PLANS/ultron-battle-matrix-protocol.md)
for the full roadmap.

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
associated with NetEase Games, Marvel, or The Walt Disney Company. No game assets
are redistributed. All trademarks and copyrights belong to their respective
owners.
