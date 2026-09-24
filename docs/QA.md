# QA checklist — screens (M8), battle renderer (M9), balance + polish + ship (M11)

> M8/M9 sections below are the original per-screen and per-renderer checklists.
> The **M11** sections at the end record the accessibility work, the `Tab`
> decision, the interactive-time measurement, and the 17-step end-to-end
> acceptance walk.

Side-by-side check of every M8 screen against its screenshot in `Screenshots/`.
**Open the screenshot before checking the screen.** Run `npm run preview`, then
`http://localhost:4173/battle-matrix/` (add `#seed=<n>` to pin a match).

Legend: ✅ faithful · ≈ knowingly approximate (see the "notes" column and the M8
report) · ⬜ deferred to a later milestone.

---

## Persistent chrome (every in-round screen)

Reference: `UBMP_ROUND1_START_SCREEN.png`

| Element | Compare | Status |
|---|---|---|
| Top-centre `⏱ round-phase` | Reads `1-1`, `9-3` etc. (`strings.roundPhase`) | ✅ |
| Phase-icon strip | 3 icons on PvP rounds, 4 on Practice; completed phases become `✓`; current highlighted gold | ✅ |
| Phase name + countdown | `PRACTICE PROTOCOL - 00:22` style beneath the strip; `Waiting for Others - MM:SS` after an early confirm | ✅ |
| Left rail — 4 protocol icons | Fortress / Onslaught / Reboot / Equilibrium, top→bottom, each with `xp / nextThreshold` and a small level badge | ✅ |
| Left rail — active icon gold | The protocol whose info pane is open is gold-accented | ✅ |
| Left rail — Strengthen counter | Gold `x0` / `x2` / `x6` below the four protocols | ✅ |
| Right panel — player list | Sorted health-descending, stable tiebreak; portrait ring + numeric health; name; streak badge with count (green win / red loss); `◇tokens` | ✅ |
| Right panel — `Out of Play` | Eliminated players show `Out of Play` in place of health, row dimmed | ✅ |
| Right panel — two view tabs | Rendered (`1 ◇`, `2 ▤`); tab switching is M9+ | ≈ tabs are inert |
| Bottom-centre health bar | `50/50`, fill proportional (CSS `calc()` over `--h`/`--m`) | ✅ |
| Bottom-right key hints | Contextual (`TAB SCOREBOARD`, `ESC MENU`/`ESC BACK`, `B DEPLOY`/`B MODULES`, `EXIT EDITING`) | ≈ per-phase set is best-effort from the screenshots |
| Arena beneath the panels | Non-battle phases: 2D placeholder ground. Battle phase: the M9 Canvas2D renderer (§6) | ✅ (M9) |

---

## 1 · Draft

Reference: `UBMP_STARTING_CHARACTER_SELECT_SCREEN.png`

| Element | Compare | Status |
|---|---|---|
| Mode title | `ULTRON'S BATTLE MATRIX PROTOCOL` (`strings.MODE_TITLE`) | ✅ |
| Tagline | *"Harness your superior intellect! …"* verbatim | ✅ |
| Sub-title + countdown | `Assemble Your Team` + a large seconds countdown (`34s` in the shot; 40 s authored) | ✅ |
| Hero pool | 18 portrait cards (6 Vanguard / 6 Duelist / 6 Strategist); hover shows the hero name | ≈ grid, not a fanned arc; name is always visible under the token |
| Lineup slots | Six slots along the bottom, filling as you pick | ✅ |
| `LINEUP (n/6)` confirm | Disabled until exactly 6 are picked | ✅ |
| Portrait art | Abstract role token (shield / blade / cross) + initials; real portraits are a later image drop-in | ≈ by design |

---

## 2 · Module Draw (shop)

References: `UBMP_MODULE_PURCHASE_SCREEN.png`, `..._PURCHASED_EXAMPLE.png`, `..._LOCKED_BUTTON_EXAMPLE_ZOOMED_IN.png`

| Element | Compare | Status |
|---|---|---|
| Tabs | `SELECT · ACTIVATED · CHANGE HERO`; gold underline on the active tab | ✅ (ACTIVATED tab is inert in M8) |
| Token wallet | `◇ N (+M)` income preview, equals `economy.previewIncome` | ✅ (asserted, 500 states) |
| Rarity-odds row | `★ n%  ★ n%  ★ n%` in blue / magenta / gold; `100%`/`0%` no decimal, others one (`86.5%`, `12.0%`, `1.5%`) | ✅ (asserted, all 256 level combos + the 3 observed rows) |
| Card banner | Protocol-coloured, protocol glyph in a rotated diamond, module name in caps | ✅ |
| Card effect text | Level-1 value (`… by 90.0`, `… by 20.0 %` even with stars owned) | ✅ (asserted) |
| Card star row | 6 / 3 / 1 stars; filled to the **owned** level, next star highlighted | ✅ (asserted) |
| Card footer | `PURCHASE` / `UPGRADE` + `◇price`; price **red** exactly when `tokens < price` | ✅ (asserted) |
| Purchased slot | Goes empty and does **not** refill for the phase | ✅ (asserted) |
| `REFRESH ◇1` | Greys out while locked (and when unaffordable) | ✅ |
| `LOCK` / `UNLOCK` | Toggles a shop-wide lock; padlock ribbon on all four cards; footer `❗ Locked modules will not be refreshed in the next round` (no trailing period) | ✅ (asserted) |
| Delayed-effect tooltip | *"The effects of purchased modules take effect in the next round."* available | ✅ |

---

## 3 · Change Hero tab

Reference: `UBMP_CHANGE_HERO_PURCHASE_OPTION_SCREEN.png`

| Element | Compare | Status |
|---|---|---|
| Three lavender cards | `CHOOSE VANGUARD` / `CHOOSE DUELIST` / `CHOOSE STRATEGIST` | ✅ |
| Body copy | *"Choose One of N Random <Role>s to Replace a Current Hero"*, N = **3 / 6 / 3** by role | ✅ (asserted) |
| `SELECT ◇5` | Each card; `◇5` = `CHANGE_HERO_COST` | ✅ |
| `◇1` corner badge | Rendered but inert (meaning unconfirmed — see the plan's open items) | ≈ inert |

---

## 4 · Swap-out

Reference: `UBMP_SWAP_HERO_SCREEN_AFTER_PURCHASE.png`

| Element | Compare | Status |
|---|---|---|
| Title | `SELECT HERO TO SWAP OUT` | ✅ |
| Sub-title | `HEROES SWAPPED IN THIS PHASE WILL TAKE EFFECT IN THE NEXT ROUND.` | ✅ |
| Row order | grey `RESERVE HEROES` row **above** blue `ACTIVE HEROES` row, `⇄` between | ✅ (asserted) |
| Reserve row contents | The role offers (N heroes) | ✅ |
| Active row contents | The six current lineup heroes | ✅ |
| Strengthen pip | Heroes carrying Strengthen Modules show `x2` etc. | ✅ (asserted) |
| Selection | Chosen reserve + active outlined gold; `CONFIRM` blocked until one of each is chosen | ✅ (asserted) |
| Footnote | *"\*When a hero is swapped, any equipped Strengthen Modules will be converted to matching usable modules."* (leading `*`) | ✅ |
| `CONFIRM` / `CANCEL` | Present | ✅ |

---

## 5 · Select Position

Reference: `UBMP_SELECT_POSITION_PHASE.png`

**Reading:** the 6×4 grid the player edits **is the player's own half** of the
arena. The screenshot shows a single 6×4 grid on the near half and plain,
grid-less ground beyond — there is no second grid for the enemy half. "Nothing
on the enemy half" holds by construction: a drop target is always one of the 24
own-half cells, and off-grid drops are rejected.

| Element | Compare | Status |
|---|---|---|
| Header | `Select Position` | ✅ |
| 6×4 grid | Front row (nearest the enemy) at the top, back row at the bottom; front row tinted | ≈ top-down flat, not the in-game perspective |
| Drag-and-drop | Move a hero to any own-half cell; landing on an occupied cell swaps the two; off-grid rejected; never > 6 heroes, never a double-occupied cell | ✅ (asserted, 5 000 random drops) |
| Keyboard placement | Tab to a cell, Enter to pick up / drop (M11 requires it; built now) | ✅ |
| `EXIT EDITING` / `DEPLOY` | Both present | ✅ |

---

## 6 · Battle (M9 — Canvas2D renderer + battle HUD)

References: `UBMP_BATTLE_PROTOCOL_PHASE.png` (PvP `2-3`),
`UBMP_BATTLE_PROTOCOL_PHASE_PRACTICE_ROUND.png` (PvE `1-3`).

The whole battle view is drawn on ONE `<canvas>` by the frame builder
(`src/render/frame.ts`, pure) + executor (`src/render/executor.ts`, thin). The
persistent M8 chrome (top bar, left rail, right panel, `50/50` bar, corner key
hints) still surrounds it. `?debug` (URL hash) shows a live frame-timing readout.

### Camera — deliberate deviation from the screenshots

The screenshots show a **3D third-person chase view behind the drone**. Our arena
is a 2D canvas (locked project decision), so M9 renders the **whole arena in a
fixed top-down view with the drone as one more token**. Rationale: the 6×4
placement is the entire point of the deploy phase and the mode; a chase cam would
keep most of the board off-screen. Recorded here and in the M9 report as a
deliberate deviation. The drone token is a forward chevron in its match colour,
visually distinct from the round unit tokens.

### `LALT CURSOR MODE` — 2D adaptation

The original releases mouse-look so the pointer can hit UI. In 2D there is no
mouse-look to release, so `LALT` toggles the *structure*: **pointer-drives-drone
⇄ pointer-free-for-UI**. In cursor mode the pointer no longer steers the drone or
holds the beam (WASD / arrows still fly it) and clicks fall through to the
mid-battle module menu. The corner readout reads `DRONE CONTROL` / `CURSOR MODE`.
Recorded as a deliberate adaptation.

### Checklist

| Element | Compare | Status |
|---|---|---|
| Your name top-left | `text` command `player-name`, left-anchored, gold underline | ✅ (asserted) |
| Opponent name top-right | `text` command `opponent-name`, right-anchored; empty on a PvE round (`1-3` shot has none) | ✅ (asserted) |
| Round-phase `⏱ 2-3` + phase strip | From M8 chrome, unchanged | ✅ |
| Arena floor + both 6×4 deploy grids | Pre-rendered once to an offscreen canvas, blitted each frame; centre line between the halves | ✅ |
| Unit tokens | Role shape (shield / blade / cross) in a coloured ring + 2-letter initials; side-tinted outline; dead units dim, keep the token, drop the bars | ✅ (asserted) |
| Galacta Bots | **Distinct monster token** (jagged blob, `--bm-galacta` tint), never a hero shape — `1-3` shot's brown/purple mobs | ✅ (asserted) |
| Long segmented health bar above every unit | Segment count from `sim/selectors.healthBarModel` (`HEALTH_BAR_HP_PER_SEGMENT = 25`, clamped 6–60); bonus-health segments in the accent tint | ✅ (asserted) |
| Ult-charge bar | Thin bar under the health bar, fill = `ultChargeFraction`; hidden at 0 | ✅ |
| Damage numbers | Floating, rise + fade; fed by M5's per-hit `damageLog` **by cursor**, renderer-local, never in sim state; chip hits (< 1) suppressed | ✅ (asserted no-double-count) |
| Optional target lines | Dashed line unit → current target, side-tinted, low alpha (`layout.targetLines`) | ✅ |
| The Ultron Drone | Forward-chevron token in the match colour, flown top-down (camera note above); beam flag carried for the executor | ✅ |
| Encephalo-Ray `∞` readout | Bottom-left `Encephalo-Ray ∞` (infinite ammo) | ✅ |
| Kill feed (top-right, under the opp. name) | `KILLER ⟶ weapon ⟶ VICTIM`, newest first, capped at 5, entries fade out (held at full opacity under `prefers-reduced-motion`); weapon labels are M5's `DamageSource` set incl. `Ultron Drone` for drone kills | ✅ (asserted: order, once-only via cursor, cap, reduced-motion) |
| `LSHIFT` / `E` ability buttons (bottom-right) | Keycap + ability name; **grey exactly when the sim marks the drone ability spent** (`FrameDrone.oneTimeDamageUsed` / `…HealUsed`), never HUD-tracked; both render **unspent at battle start** (the PvE shot) | ✅ (asserted: flips on the exact consume tick) |
| Hint bar (centred, under the health bar) | `LALT CURSOR MODE / B MODULES` (`strings.battleHint()`) | ✅ (asserted verbatim) |
| `50/50` health bar | M8 chrome bottom-centre, unchanged (drone HP = player HP, never changes mid-battle) | ✅ |
| Speed Up Protocol | On-screen `SPEED UP PROTOCOL` banner when the battle-timer-0 sub-stage flips (`speedUpActive`); damage ×2.2 is M5 | ✅ (asserted: banner iff active) — announcement copy is authored (no screenshot of it) |
| `B` mid-battle | Opens the module menu **over the still-ticking battle** (canvas stays mounted), with *"The effects of purchased modules take effect in the next round."*; the buy lands in `ownedModules` for next round's `ResolvedUnit` freeze, not this round's combat | ✅ (asserted end-to-end + through the HUD path) |
| Fixed-timestep loop | Sim 30 Hz integer ticks; renderer interpolates at `alpha`; frame-delta clamp + spiral-of-death drop; tick count = f(elapsed) only | ✅ (asserted: identical ticks + byte-identical state at 30/60/144 fps; 5 s stall clamped) |
| Readonly snapshot | Frame builder input is `DeepReadonly<BattleFrameState>` and the live snapshot is `deepFreeze`d every tick | ✅ (asserted: full frame vs a deep-frozen state) |
| Live input → M6 quantized stream | Key/pointer latched, sampled **once per sim tick**, quantized at capture (`encodeDroneMove`); banked as a `driveDrone` action so `runMatch` resolves the round with the flown drone; replays byte-identically | ✅ (asserted) |
| Performance | No frame-loop allocation (pooled `CmdList`, cached path ops + colour tokens + text metrics), no `shadowBlur` / `filter`, offscreen static arena. Measured: **build+executor ≈ 0.09 ms/frame** for 12 units + damage numbers + kill feed + beam + Speed Up (recording stub 2D ctx; happy-dom has no real one). Frame builder alone ≈ 0.04 ms. Well inside the 16.6 ms / 60 fps budget. | ✅ |

---

## 7 · Reward (Practice rounds)

Reference: `UBMP_STRENGTHEN_MODULE_PURCHASE_SCREEN.png`

**`strengthen.json` is an M1 skeleton** — name / effect / keybind are empty and
rendered as-is (nothing invented). The screen lights up when M10 lands without a
renderer change.

| Element | Compare | Status |
|---|---|---|
| Phase header | `PRACTICE PROTOCOL REWARD PHASE`; strip shows the first 3 phases `✓` | ✅ |
| Title | `SELECT REWARD` | ✅ |
| Three gold cards | Hero art + `SELECT`; the `⚡` icon; name / effect / keybind chip **empty until M10** | ✅ structure |
| `REFRESH 1/1` | One free refresh, then disabled | ✅ |
| Instruction | `❗ Select 1 Strengthen Modules` (plural "Modules" at n=1, sic) | ✅ |
| Persistent shop chrome | Tabs + rarity row still shown above the cards | ✅ |
| `◇1` corner badge | Rendered, inert | ≈ inert |

---

## 8 · Scoreboard (TAB)

Reference: `UBMP_SCOREBOARD_VIEW.png`

| Element | Compare | Status |
|---|---|---|
| Columns | `Rank · Player Name · Deploy · Initiate Protocol` | ✅ |
| Six rows | All six players, ranked (living by health desc, eliminated by placement) | ✅ (asserted) |
| `Deploy` cell | Each player's six hero tokens, public | ✅ (asserted) |
| `Initiate Protocol` cell | Four protocol level numbers + the Strengthen count | ✅ (asserted) |
| Top-3 divider | Gold divider after row 3; rows 4–6 dimmed | ✅ (asserted) |
| Everything public | Lineups, protocol levels, tokens, health, streaks — nothing hidden | ✅ |
| Rank-1 badge | Gold rank number | ≈ colour only, no chevron glyph |

---

## 9 · Final Standings

No screenshot. Kept consistent with the scoreboard's `Rank` language.

| Element | Compare | Status |
|---|---|---|
| Title | `FINAL STANDINGS` (authored — see the M8 report) | ✅ |
| Rows | Placements `#1..#6`, one winner marked `★`, you marked `•` | ✅ |
| Reached only at `status === 'complete'` | ✅ | ✅ |

---

## Protocol info pane (left-rail click)

References: `UBMP_LEFTSIDE_ICON_CLICK_INFO_PANE_EXAMPLE.png`, `...EXAMPLE2.png`

| Element | Compare | Status |
|---|---|---|
| Header | protocol icon tint + `Protocol: <Name>` + `XP n / threshold` | ✅ |
| Three tier bonuses | All three stacked; the earned one(s) in cyan | ✅ |
| Tier bonus text | Numeric values from `PROTOCOL_TIER_BONUSES` (120 / 120 / 240 etc.) | ≈ phrasing is `+N Label` from `STAT_LABEL`, not the game's "Increase Ally Heroes' … by N" prose (not published verbatim) |
| Legend row | `★ = XP+1 · ★ = XP+2 · ★ = XP+4`, stars coloured by rarity | ✅ |
| `Owned Modules:` list | Module name in its rarity colour; star row at the **owned** level; **cumulative** value at that level (`ownedValue`, a table lookup) | ✅ |
| Owned-module effect text | Canonical `effect` template with the cumulative value substituted | ≈ same phrasing caveat as the tier text |

---

## Responsive behaviour (manual, `npm run preview`)

Resize the browser and confirm no horizontal body scroll and legible text.

| Viewport | Result | Date |
|---|---|---|
| 1920 × 1080 | Chrome + stage comfortable; shop cards full width | ✅ 2026-09-02 |
| 1600 × 900 | Rail/panel narrow slightly (media query at 1440); no clipping | ✅ 2026-09-02 |
| 1366 × 768 | Panel 188 px, top bar 66 px, body font 14 px; scoreboard columns compress | ✅ 2026-09-02 |
| 1280 × 720 (baseline) | All nine screens usable; board + cards fit without body scroll | ✅ 2026-09-02 |
| 1024 wide | Rail 60 px, panel 168 px; Change-Hero cards stack; shop cards shorter; still legible | ✅ 2026-09-02 |
| `prefers-reduced-motion` | All transitions/animations collapse to ~0 ms | ✅ 2026-09-02 |

> Re-run this table whenever a layout token in `src/ui/theme.css` changes.

---
---

# M11 — accessibility, `Tab` decision, interactive time, 17-step acceptance

## Accessibility record

### Full keyboard navigation — shop and board

| Surface | Path | Notes |
|---|---|---|
| Draft pool cards | `keyActivate` (role `button`, `tabindex 0`, Enter/Space) | picked cards stay focusable; a fully-drafted pool disables the rest via `tabindex -1` |
| Draft `LINEUP (n/6)` | native `<button>` | disabled until exactly 6 picked |
| Shop tabs `SELECT · ACTIVATED · CHANGE HERO` | native `<button>` | the active tab reads by gold underline **and** `--bm-accent` colour + `border-bottom` (not colour alone) |
| Shop cards | `keyActivate` | `tabindex -1` while the shop is `LOCK`ed (nothing to buy); empty slots are `aria-hidden` |
| `REFRESH` / `LOCK` | native `<button>` | `disabled` attribute when unavailable |
| Change-Hero role cards | native `<button>` | |
| Swap-out reserve/active picks | `keyActivate` | `CONFIRM` blocked until one of each is selected |
| Reward Strengthen cards | `keyActivate` | `tabindex -1` once the needed count is picked |
| Board cells (Select Position) | `tabindex 0` + Enter/Space (M8) | Tab to a cell, Enter to pick up / drop |
| Left-rail protocol icons | native `<button>` | opens the info pane |
| Seed bar (input / PLAY / COPY LINK / colour-blind toggle) | native controls | fixed top-right, always reachable |
| `?debug=1` overlay | `pointer-events: auto`, scrollable | click a unit for its resolved stats |

Visible focus: `.bm-btn:focus-visible`, `.bm-focusable:focus-visible`,
`.bm-seedbar__*:focus-visible` all draw `outline: 2px solid var(--bm-accent);
outline-offset`. `dom.keyActivate` is the shared Enter/Space helper;
`tests/ui-actions.spec.ts` asserts every UI action maps to a legal sim action.

### `prefers-reduced-motion`

| Motion | Reduced-motion behaviour | Where |
|---|---|---|
| All CSS transitions / animations | collapse to ~0 ms | `theme.css` `@media (prefers-reduced-motion: reduce)` (global rule) |
| Draft / scoreboard faded rows | held at full opacity (not faded out) | asserted in `tests/render.spec.ts` (pre-M11) |
| Kill feed rows | held at full opacity past the hold window | `KillFeed.rows(tick, reducedMotion)` — `tests/render.spec.ts` |
| Damage numbers | no upward drift, no fade — the number holds at full opacity for its life then vanishes | `DamageNumbers.active(tick, reducedMotion)` — `tests/render.spec.ts` (M11) |
| Battle interpolation | the renderer draws at the latest tick (`alpha = 1`); units **snap** rather than glide between ticks | `BattleRenderer.advance` passes `1` to `buildFrame` — `tests/render.spec.ts` (M11) |
| Speed Up announcement | the canvas banner is drawn at static full alpha (no pulse); the legacy DOM `.bm-speedup` pulse is disabled by the global media rule | `executor.drawBanner` |

The renderer takes `reducedMotion` from
`window.matchMedia('(prefers-reduced-motion: reduce)').matches` in
`GameApp.syncBattleRenderer`.

### Colour-blind-safe palette

An **opt-in override layer**, not a recolour — `tests/theme.spec.ts` still
asserts every canonical `--bm-*` hex against the plan's table, and the M11 test
asserts the CB layer introduces **no hex colour of its own**.

- Toggle: a checkbox in the top-right seed bar (label `strings.CB_MODE_LABEL`).
  Preference persisted per browser in `localStorage` (`bm.cbAssist`, wrapped in
  try/catch). Applied to `<html data-cb="1">` before first paint.
- Reinforcement under `:root[data-cb="1"]` (`theme.css`):
  - hero-token role **shapes** get a fatter stroke (`stroke-width: 10`);
  - every hero token shows a **text role chip** (`content: attr(data-role)` —
    `heroToken.ts` sets `data-role`), so role reads without hue;
  - protocol / role **cards** get a distinct border *pattern* — solid
    (Fortress/Vanguard), dashed (Onslaught/Duelist), dotted (Reboot/Strategist),
    double (Equilibrium / Change-Hero);
  - scoreboard protocol **dots** get a distinct *shape* per protocol (square /
    circle / triangle / diamond / pentagon-Strengthen).
- The role SHAPES (shield / blade / cross in `heroArt.ts`) already carry role
  independent of colour in the default palette; the CB layer amplifies them and
  adds the text fallback.

## The `Tab` conflict — decision

**Problem (plan §3e).** M8/M9 shipped `GameApp.onGlobalKey` intercepting *every*
`Tab` keydown with `preventDefault()` to toggle the scoreboard, which destroyed
browser focus traversal — directly against "full keyboard navigation".

**Decision.** `Tab` toggles the scoreboard **only when focus is not inside an
interactive control**. `onGlobalKey` checks `document.activeElement`: if it (or an
ancestor) matches `button, a[href], input, select, textarea,
[tabindex]:not([tabindex="-1"]), [role="button"]`, the handler **returns without
`preventDefault`** and the browser moves focus normally. Otherwise (focus on
`document.body` — the "just watching the battle" state) `Tab` preventDefaults and
toggles the scoreboard, as the game does.

**Rationale.** While a keyboard user is tabbing through the shop / board / seed
bar, every Tab traverses focus. When nothing interactive is focused — the
default in-round state — Tab is the scoreboard key. The two never fight because
they never apply in the same focus state. (Hold-to-view was the alternative; it
still needs `preventDefault` on keydown and flickers on a quick press, so the
focus-state check is cleaner for accessibility.)

**Recorded** alongside the M9 camera / `LALT` deviations (this file) and
`docs/FIDELITY.md` §7.

## Interactive in < 2 s cold — measurement

**Method (for a human, against `npm run preview` and the deployed URL).** Chrome
DevTools → Performance, hard-reload with cache disabled, read *Time to
Interactive* / LCP; or Lighthouse (mobile + desktop presets) → *Time to
Interactive*. Repeat 3× and take the median.

**Objective proxies measured in this environment** (there is deliberately no
browser-automation dependency — plan §4.5):

| Proxy | Value | Method |
|---|---|---|
| Gzipped bundle, all `dist/` files | **~62 KB** (JS ~56 + CSS ~6 + HTML ~0.5) — 12 % of the 500 KB budget | `tests/build-output.spec.ts` (`node:zlib`, level 9) |
| Blocking requests | HTML + **1** JS module + **1** CSS file. No web fonts (system + generic stack), no code-split chunks, **zero runtime dependencies**, no `fetch` on load. | `dist/index.html` inspection |
| `npm run preview` first byte for `index.html` | **~5 ms** (localhost) | `curl -w '%{time_total}'` |
| `GameApp` constructor synchronous work (`runMatch(seed, [], resolver, {maxRounds: 8})` — 8 rounds of real combat before first paint) | **~24 ms** mean (Node, this machine, 20 runs) | `runMatch` micro-bench |

Cold path: HTML parse → fetch + parse one ~193 KB JS chunk (tens of ms) + one
~28 KB CSS file → `new GameApp(...)` (~24 ms) → first DOM build (a few hundred
nodes). On any network delivering the JS chunk in under ~1 s this is interactive
well inside the 2 s budget. **A human should still run Lighthouse on the deployed
URL and paste the median TTI below.**

| Target | TTI (median of 3) | Tool | Date |
|---|---|---|---|
| `npm run preview` @ localhost, desktop | _pending human pass_ | DevTools Performance | |
| Deployed Pages URL, Lighthouse mobile | _pending human pass_ | Lighthouse | |
| Deployed Pages URL, Lighthouse desktop | _pending human pass_ | Lighthouse | |

## 17-step end-to-end acceptance walk

Run against the deployed URL (or `npm run preview` →
`http://localhost:4173/battle-matrix/`), **with the matching screenshot open**.
Legend: **T** verified by an automated test · **C** verified by code inspection ·
**H** needs a human browser pass (visual / interaction).

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | Draft: 18-hero pool of 6/6/6, `LINEUP (0/6)` fills to 6, timer counts down | **T** + H | `tests/data.spec.ts` (6/6/6 roster), `tests/ui-render.spec.ts` (draft renders; GameApp routes through it). H: the replica's pool is a grid, not a fanned arc (M8 note). |
| 2 | Round `1-1` is Practice with **4** phase icons; header names the phase; start `◇10`, preview `(+16)` | **T** | `tests/match.spec.ts` (round 1 practice, 4 phases), `tests/economy.spec.ts` (10 tokens; `previewIncome` → `+16`), `tests/hud.spec.ts` (phase strip). |
| 3 | Buy one module for `◇5` — slot empties, tokens `5`, preview `(+15)`, protocol meter ticks `1/10` | **T** | `tests/modules.spec.ts` (buy; slot empties; XP), `tests/economy.spec.ts` (`5 (+15)`), `tests/ui-actions.spec.ts`. |
| 4 | `REFRESH` costs `1`; `LOCK` greys refresh and badges all four cards | **T** | `tests/modules.spec.ts` (`SHOP_REFRESH_COST` 1; lock/refresh), `tests/hud.spec.ts` (padlock on all four). |
| 5 | Phase `1-2` `Select Position`: drag onto the 6×4 grid; placement persists into battle | **T** + H | `tests/ui-actions.spec.ts` + `tests/combat.spec.ts` (deployment applied), `tests/render.spec.ts` (persists to the battle ctx). H: drag feel. |
| 6 | Phase `1-3`: Galacta Bots as monsters; fly the drone; fire `LSHIFT` / `E`, each greys; kill feed populates | **T** + H | `tests/drone.spec.ts` (one-time abilities fire once, reset next round), `tests/render.spec.ts` (Galacta monster token; ability buttons grey on the consume tick; kill feed). H: flying the drone. |
| 7 | Phase `1-4` `SELECT REWARD`: **3** gold cards, `REFRESH 1/1` once, `Select 1 Strengthen Modules`, counter → `x1` | **T** | `tests/practice.spec.ts` (3 offers; single refresh; count), `tests/strengthen.spec.ts`. |
| 8 | Round 2 is PvP with **3** phases; opponent name top-right | **T** | `tests/match.spec.ts` (round 2 battle, 3 phases), `tests/render.spec.ts` (opponent name; empty on PvE). |
| 9 | Lose a round: health drops ~2–4; gain `+1 token per health lost` | **T** | `tests/match.spec.ts` (re-fitted `healthLoss` table), `tests/economy.spec.ts` (HP compensation +1/HP). **Note:** with the M11 HP-loss re-fit an early-round loss is ~2 HP (FIDELITY §3b). |
| 10 | Reach 10 XP in one protocol: badge `1`, meter `/20`, tier-1 bonus cyan, rarity row off `100/0/0` | **T** | `tests/modules.spec.ts` (10 Commons ⇒ L1), `tests/hud.spec.ts` (meter/badge), `tests/display.spec.ts` (rarity odds off 100/0/0 at L1). |
| 11 | Info pane: `XP n/20`, all three tiers, `★=+1 ★=+2 ★=+4` legend, Owned Modules list with **cumulative** values | **T** | `tests/ui-render.spec.ts` (info-pane VM), `tests/display.spec.ts` (`ownedValue` cumulative). |
| 12 | `CHANGE HERO` for `◇5`: offers 3/6/3 by role; swap screen Reserve above Active; a Strengthen hero shows its pip; after confirm the modules return as selectable | **T** | `tests/modules.spec.ts` (3/6/3 offers; `swapHeroAndConvertStrengthen`), `tests/strengthen.spec.ts` (swap conversion invariant), `tests/ui-render.spec.ts` (Reserve/Active order; pip). |
| 13 | `TAB`: scoreboard shows all six lineups, protocol levels, Strengthen counts, top-3 divider | **T** + C | `tests/ui-render.spec.ts` (`scoreboardVM`: 6 lineups; 4 levels + Strengthen count; `topCutoffIndex 3`). C: M11 Tab only toggles when focus is not in a control. |
| 14 | Let a battle run long — **Speed Up Protocol** announces and damage jumps | **T** | `tests/combat.spec.ts` (Speed Up flips at the trigger tick; ×2.2 once), `tests/render.spec.ts` (banner iff `speedUpActive`). |
| 15 | Play to an elimination: that player becomes a phantom and reads `Out of Play` | **T** | `tests/match.spec.ts` (elimination; `phantomLineup` frozen; `alive:false` thereafter), `tests/ui-render.spec.ts` (`Out of Play` row). |
| 16 | Play to the end; placements 1–6 assigned, one player remains | **T** | `tests/match.spec.ts` (200-seed fuzz: one winner, placements {1..6}), `tests/replay.spec.ts` (5 committed full matches). |
| 17 | Re-enter the same seed; the match replays identically | **T** | `tests/determinism.spec.ts` (100× same-seed replay → one boundary-hash sequence). In the UI the seed bar writes `#seed=<n>` and reload re-runs from that seed. |

**Automated coverage: 17 / 17 steps have test or code evidence.** The
**H**-flagged visual / interaction aspects (drag feel, flying the drone, the
arc-fan draft layout, Lighthouse TTI, and confirming zero console errors on the
live deploy) still want a human pass on the deployed build. Record it here.
