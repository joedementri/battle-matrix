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

Milestone **M5** — the headless combat simulation core. `src/sim/combat.ts`
is a fixed **30 Hz integer tick** sim (`effects → target acquisition →
movement → attacks → abilities/ults → damage & healing → death checks`, units
in stable id order, no wall clock). `simulateBattle(ctx, opts?)` returns a
`BattleTrace`; `createCombatResolver()` wraps it in the M2 `CombatResolver`
contract, so it drops in wherever `match.ts` injects combat — `match.ts`
itself is unchanged. Targeting follows the canonical
`nearest` / `lowestMaxHealth` / `highestMaxHealth` priority on **resolved max
health** (so a target never flips as it is damaged), with a per-unit
out-of-range re-acquire timer. Ult energy accrues from damage dealt/taken and
healing done; the **Speed Up Protocol** is a single battle-level flag that
multiplies damage by exactly 2.2, applied once and never compounded, ending
the battle as a tie at the cap. A **kill-event stream** (`killer ⟶ weapon ⟶
victim`) feeds the M9 kill feed, with a damage-source union designed now
(primary / ability / ultimate / module / drone). `src/sim/effects.ts` and
`src/sim/abilities.ts` implement the behavioural Rare and Legendary Base
Modules — Last Stand, Steady Recovery, Critical Damage Shell, Backup Rebirth
(all three variants), Infinite Drive, the 10 s round-start windows,
Vulnerability Mark stacking, Life Steal, Annihilator Fury / Rampage, Overflow
Recharge, Deadly Healing, Double Heal, Critical Counter, and Cumulative Dual
Enhancement — with a completeness test that every behavioural `effectId` has a
registered handler and no reachable `TODO`. Per-hero ultimates are a registry
of six authored **archetypes** (single-target burst, AoE burst, sustained
beam, team-heal burst, shield / damage-reduction, self-buff); each hero maps
to one in `heroes.json`, per-hero flavour is M11. Every new authored number
(arena geometry, ult-energy conversion rates, the tie cap vs. the `maxTicks`
bug guard, archetype magnitudes) lives in `src/data/authored.ts` with a
provenance note.

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
