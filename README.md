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

Milestone **M3** — the economy engine. Token income now moves through the match:
at every round start (round 1 excepted) each living player is paid base income →
interest on the balance held *before* that income → a win/loss streak bonus; the
+2 PvP win bonus is granted at battle resolution, and losing health pays +1 token
per point actually lost. `previewIncome` returns the `{ base, interest, streak,
total }` breakdown that is the single source of truth for the HUD's `◇N (+M)`
preview; `spend` refuses an unaffordable purchase rather than clamping, so tokens
never go negative. Combat is still the injected M2 stub; the real tick sim lands
in M5.

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

`src/sim/` is pure and headless — no DOM, no wall clock, no `Math.random`, no
`ui/` / `render/` imports — enforced by an ESLint override *and* a grep test.

See [`PLANS/ultron-battle-matrix-protocol.md`](PLANS/ultron-battle-matrix-protocol.md)
for the full roadmap.

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
associated with NetEase Games, Marvel, or The Walt Disney Company. No game assets
are redistributed. All trademarks and copyrights belong to their respective
owners.
