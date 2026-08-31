# Battle Matrix — a fan replica of Ultron's Battle Matrix Protocol

## Context

`Proj/` contains only `PLANS/` and `Screenshots/`. We are building, from scratch, a browser
auto-battler that replicates Marvel Rivals' Season 2.5 limited-time mode **Ultron's Battle
Matrix Protocol** (live 6/6/25–6/23/25, now removed from the game) as a personal fan project
hosted on GitHub Pages.

The goal is **mechanical fidelity** first and **UI fidelity** second. The real mode is a
6-player TFT-style auto-battler wrapped around Marvel Rivals' 3D shooter combat: you draft 6
heroes, buy Modules that level up four "Protocols", position your team on a 6×4 grid, and then
*fly an Ultron Drone* over the battle while your heroes fight automatically.

`Screenshots/` holds 15 captures from a YouTube playthrough covering the draft, all four round
phases, the module shop (empty, purchased, and locked states), the Strengthen Module reward
phase, the Change Hero and swap-out flows, the protocol info panes, the battle HUD in both PvP
and PvE, and the full scoreboard. **These are the highest-authority source we have** — they
outrank the wiki and every guide, because they show the shipped product. They confirmed most of
the researched ruleset, corrected two values, and supplied a large amount of UI detail that no
text source published.

Decisions locked with the user:

| Decision | Choice |
|---|---|
| Lobby | Single-player: you + 5 AI opponents, 100% client-side |
| Combat | 2D top-down real-time deterministic tick sim (30 Hz), Canvas2D |
| Art | Abstract role tokens (initials + role silhouette), image-swap hook for later |
| Stack | TypeScript (strict) + Vite + Vitest, **zero runtime dependencies** |

---

## Screenshot evidence index

Implementers: **open the referenced file before building the matching screen.** Each is a
pixel reference for layout, colour, copy, and iconography.

| File | Establishes |
|---|---|
| `UBMP_STARTING_CHARACTER_SELECT_SCREEN.png` | Draft screen: arc-fan hero pool, `LINEUP (0/6)`, 6 empty slots, `Assemble Your Team` + 34 s timer, mode tagline |
| `UBMP_ROUND1_START_SCREEN.png` | Round banner, `1-1` round-phase indicator, 6×4 board, left protocol rail, right player list, `50/50` health, `B DEPLOY` |
| `UBMP_MODULE_PURCHASE_SCREEN.png` | Shop: 3 tabs, rarity-odds row, 4 cards, `PURCHASE ◇5`, `REFRESH ◇1`, `LOCK`, token counter with income preview `10 (+16)` |
| `UBMP_MODULE_PURCHASE_SCREEN_PURCHASED_EXAMPLE.png` | Bought slot goes empty and does not refill; preview drops `(+16)→(+15)` as tokens fall 10→5 |
| `UBMP_MODULE_PURCHASE_SCREEN_LOCKED_BUTTON_EXAMPLE_ZOOMED_IN.png` | Per-card lock badges, `UNLOCK`, greyed refresh, `Locked modules will not be refreshed in the next round`, `UPGRADE` state, red price when unaffordable, rarity odds `86.5 / 12.0 / 1.5` |
| `UBMP_SELECT_POSITION_PHASE.png` | Deploy phase `1-2`, `Select Position`, drag-and-drop on the 6×4 grid, `EXIT EDITING` / `DEPLOY` |
| `UBMP_BATTLE_PROTOCOL_PHASE.png` | PvP battle `2-3`: opponent name top-right, kill feed, drone third-person, `LSHIFT`/`E` buttons, `LALT CURSOR MODE / B MODULES` |
| `UBMP_BATTLE_PROTOCOL_PHASE_PRACTICE_ROUND.png` | PvE battle `1-3`: Galacta Bots are visually distinct monsters, both drone abilities unspent |
| `UBMP_STRENGTHEN_MODULE_PURCHASE_SCREEN.png` | Reward phase `1-4`: `SELECT REWARD`, 3 gold hero cards, `REFRESH 1/1`, `Select 1 Strengthen Modules`, delayed-effect tooltip |
| `UBMP_CHANGE_HERO_PURCHASE_OPTION_SCREEN.png` | `CHANGE HERO` tab: 3 role cards at `◇5`, offer sizes 3 / 6 / 3, protocol meter `23/40` with level badge `2`, streak badges |
| `UBMP_SWAP_HERO_SCREEN_AFTER_PURCHASE.png` | `SELECT HERO TO SWAP OUT`, Reserve/Active rows, per-hero Strengthen pip `x2`, conversion rule footnote |
| `UBMP_SCOREBOARD_VIEW.png` | TAB scoreboard: `Rank / Player Name / Deploy / Initiate Protocol`, all lineups public, top-3 divider |
| `UBMP_LEFTSIDE_ICON_CLICK_INFO_PANE_EXAMPLE.png` | Protocol pane: `XP 16/20`, all three tier bonuses with the earned one highlighted, `★=XP+1 ★=XP+2 ★=XP+4`, Owned Modules list |
| `UBMP_LEFTSIDE_ICON_CLICK_INFO_PANE_EXAMPLE2.png` | Same at `18-1`: owned modules show **cumulative value at owned level**; rarity odds `81/16/3`; `Out of Play` rows; income `0 (+19)` on a 12-win streak |

---

## Source fidelity ledger

Read this before changing any number.

### CONFIRMED by screenshots — previously researched, now proven

Module purchase price **5 tokens** · 4 cards per shop draw · shop lock exists and its exact
semantics · protocol thresholds **10 / 20 / 40** and the level badge / XP-meter display · all
three Fortress and Reboot tier bonuses (`120 / 120 / 240`, `12 % / 12 % / 24 %`) · XP per rarity
**1 / 2 / 4** · six upgrade stars for Common · hero swap **5 tokens** · **50** starting health ·
6 players · 6×4 board · Strengthen Module effect text matches the wiki verbatim · streak bonus
**caps at 4** · base income **15** · interest **+1 per 10 held**.

### CORRECTED by screenshots — the plan was wrong, these are the right values

| Value | Was | Now |
|---|---|---|
| Shop refresh cost | 2 tokens (guessed) | **1 token** — `REFRESH ◇1` |
| HP loss per lost round | `2 + floor(round/3) + survivingEnemies` | Far too steep. Round-9 lobby health was 46/45/40/39/36/35 — ≈2.8 HP per loss. New model below |
| Round identifier | plain round number | **`round-phase`** (`1-1`, `9-3`, `18-1`) — phases are numbered within the round |
| Phase count | 3 | **3 on PvP rounds, 4 on Practice rounds** (a Reward Phase is appended) |
| Strengthen redistribution on swap | "randomly reassigned to another hero" (wiki) | In-game string: **"any equipped Strengthen Modules will be converted to matching usable modules"** — they return to your pool to re-place, not auto-assigned |

### DERIVED — a formula fitted to observed data, not published

**Shop rarity odds.** Three observations, one formula, exact fit on all three:

```
rare%      = 4.0 × Σ(all four protocol levels)
legendary% = 1.5 × count(protocols at level ≥ 2)
common%    = 100 − rare% − legendary%
```

| Observed state | Odds shown | Formula |
|---|---|---|
| All protocols L0 | 100 / 0 / 0 | 4×0=0, 1.5×0=0 ✓ |
| Σlevels 3, one protocol at L2 | 86.5 / 12.0 / 1.5 | 4×3=12, 1.5×1=1.5 ✓ |
| Reboot L2 + Equilibrium L2 (Σ4) | 81.0 / 16.0 / 3.0 | 4×4=16, 1.5×2=3 ✓ |

Reconciles with the wiki's per-protocol unlock rule as: **roll a rarity globally, then pick
among protocols eligible for it** (level ≥1 for Rare, ≥2 for Legendary).

**HP loss on a lost round.** Fitted to the round-9 lobby (59 HP total lost across 6 players
over ~7 PvP rounds ⇒ ≈2.8 per loss):

```
loss = floor((round − 1) / 5) + survivingEnemyUnits     // 1..6 survivors
tie  = ceil(loss / 2)
```

Round 2–5 ⇒ 0 + ~2.5 ≈ 2.5 · round 6–10 ⇒ 1 + ~2.5 ≈ 3.5 · blended ≈2.9. Matches.

### AUTHORED — still unknown, isolated in `src/data/authored.ts`

| Value | Chosen | Reasoning |
|---|---|---|
| Rare / Legendary buy price | 10 / 15 | Common 5 is confirmed; sell values 4/9/14 imply a flat −1 spread. **Note:** every observed card, Common or not, showed `◇5`; a flat 5 for all rarities is a live possibility — test both |
| Phase timers | Draft 40 s · Module 30 s · Position 20 s · Battle 40 s + 20 s Speed Up · Reward 30 s | Observed clocks: draft 34 s, module 22/21/15/8, position 1, battle 39/32, reward 30, waiting 34/32. These are the smallest values consistent with all observations |
| Speed Up trigger | at battle timer 0 | Wiki says "if the battle is taking too long"; the 4th phase icon implies a distinct stage |
| Per-hero combat stats | see `heroes.json` | Base health is canonical (wiki infoboxes); DPS, range, attack speed, ability/ult behaviour are authored |
| Strengthen Module implementations | see M10 | Effect *text* is canonical; the numbers behind Rivals' real abilities are not |
| Round cap | 40, then highest health wins | Round 18 observed; true cap never published |

---

## Canonical Data

Ship all of this as JSON in `src/data/`; do not re-derive it.

### Match structure

- **6 players**, each starting at **50 health** (this is the Ultron Drone's health).
- **Starting tokens: 10.** (Round `1-1` shows every player at `◇10` before any income.)
- Each player is assigned a **random hero pool of 6 Vanguards + 6 Duelists + 6 Strategists (18)**
  and selects **6** as their lineup. The 12 unpicked heroes become that player's **Reserve**.
- Round types:
  - **Practice Protocol (PvE)** — rounds **1, 6, 11, 16, 21**, vs Galacta Bots.
    Reward: **1 Strengthen Module** on rounds 1 and 6; **2** on rounds 11, 16, 21.
  - **Battle Protocol (PvP)** — all other rounds, players paired evenly.
- Losing or tying a PvP round costs health. With an odd player count the unpaired player fights
  a **mirror of a random opponent's lineup**; they lose health on a loss or tie, and a win costs
  the mirrored opponent nothing.
- **Eliminated players become phantom teams.** Losing to a phantom costs you health; beating one
  gives you nothing. Their scoreboard row reads **`Out of Play`**.
- At **0 health** a player is eliminated and placed by players remaining; the match ends at one.

### Round and phase model

The HUD shows **`round-phase`** (`1-1`, `9-3`, `18-1`). A phase-icon strip sits beside it; each
completed phase turns into a **✓**.

| # | Phase | Header string | Occurs |
|---|---|---|---|
| 1 | Module Draw | `Select the Modules you wish to purchase` (round 1 shows the round type, e.g. `PRACTICE PROTOCOL`) | every round |
| 2 | Select Position | `Select Position` | every round |
| 3 | Battle Protocol | `BATTLE PROTOCOL` | every round |
| 4 | Reward | `PRACTICE PROTOCOL REWARD PHASE` | **Practice rounds only** |

- A player who confirms early sees **`Waiting for Others`** with the timer still running.
- The Battle Phase contains the **Speed Up Protocol** sub-stage: **+120 % damage** to all heroes.
- Modules may be bought *during* the Battle Phase (`B MODULES` is live), but **effects apply
  next round** — in-game tooltip: *"The effects of purchased modules take effect in the next round."*
- Hero swaps likewise: *"HEROES SWAPPED IN THIS PHASE WILL TAKE EFFECT IN THE NEXT ROUND."*

### Token economy

| Source | Amount |
|---|---|
| Starting tokens | **10** |
| Base income, start of every round | **15** |
| Interest, at round start | **+1 per 10 tokens held**, **max +5** |
| Win/loss streak | starts at **1**, **+1** per consecutive result, **capped at 4** |
| PvP round win | **+2** (wiki; never visible in a round-start preview — see note) |
| Health compensation | **+1 token per 1 health lost** |
| Module purchase | **−5** (Common, confirmed) |
| Shop refresh | **−1** |
| Hero swap | **−5** |

**Income preview is a shipped feature**: the token counter reads `◇ N (+M)` and updates live as
you spend. Verified twice — `10 (+16)` = 15 + 1 interest, and after spending 5, `5 (+15)` =
15 + 0 interest. A third: `0 (+19)` on a 12-win streak = 15 + 0 interest + 4 streak cap.

> Note: no observed preview includes the wiki's +2 win bonus (`15 + interest + streak` fits all
> three exactly). Implement `+2` as granted at **battle resolution**, not round start, which is
> the only reading consistent with both sources. Flag it in `authored.ts`.

### Module system

Three types: **Base**, **Replacement** (Change Hero), **Strengthen**.

| Rarity | Star colour | XP | Upgrade levels | Buy | Sell |
|---|---|---|---|---|---|
| Common | Blue | 1 | 6 | 5 | 4 |
| Rare | Magenta | 2 | 3 | 10 * | 9 |
| Legendary | Gold | 4 | — | 15 * | 14 |

\* authored — see ledger.

- **Protocol levels: 10 / 20 / 40 XP.** The left-rail meter reads `XP / nextThreshold` with the
  current level as a small badge beneath (e.g. `23/40` with badge `2`).
- Level 1 unlocks Rare for that protocol; Level 2 unlocks Legendary. Bonuses are **cumulative**.
- **Buying a duplicate upgrades it** — the card's button reads `UPGRADE` instead of `PURCHASE`
  and its star row shows the owned level filled with the next star highlighted.

**Two distinct value-display rules — implement both, they differ:**

| Surface | Shows |
|---|---|
| Shop card | the module's **level-1 base value**, always (`Health Expansion … by 90.0` at 1 star; `Charge Acceleration … by 20.0 %` even when several stars are owned) |
| Owned Modules pane | the **cumulative table value at the owned level** (`Initial Healing Boost ★★ → 30.0 %` from the 15/30/60 line; `Healing Enhancement ★★★★ → 32.0 %` from 8/16/24/32/…) |

**Change Hero** costs **5 tokens** and offers three role cards whose pool sizes mirror the
roster: **3 random Vanguards · 6 random Duelists · 3 random Strategists**. Buying one opens
`SELECT HERO TO SWAP OUT` with a **Reserve Heroes** row and an **Active Heroes** row.

**Strengthen Modules** come only from Practice rounds, are chosen from **3 offers** with **one
free refresh** (`REFRESH 1/1`), and display the bound ability's keybind inline (e.g. `LSHIFT`).
The player's total is tracked by a gold counter on the left rail (`X0`, `x1`, `X2`, `X6`).

### Base Module tables — verbatim

Each Common line has 6 values (levels 1–6), each Rare 3, each Legendary 1.

**Protocol: Fortress** (Vanguard · blue)

*Common* — Attack Speed Enhancement: Vanguard primary fire rate & magazine capacity
+4/8/12/16/20/28 % · Damage Enhancement: Vanguard damage done +12/16/20/28 % · Health Expansion:
Vanguard max health +90/180/270/360/450/630 · Defensive Shell: Vanguard damage taken
−6/12/18/24/30/42 % · Charge Acceleration: Vanguard ult energy gain +20/40/60/80/100/140 % ·
Health Suppression: per Vanguard, enemy max health −1/2/3/4/5/7 % · Damage Interference: per
Vanguard, enemy damage output −1/2/3/4/5/7 % · Healing Suppression: per Vanguard, enemy healing
−1/2/3/4/5/7 %

> "Damage Enhancement" is listed with only 4 values in both sources. Reproduce as-is with
> `levels: 4` rather than inventing two more steps.

*Rare* — Health Increment: Vanguard max health +10/20/40 % · Reserve Armor: Vanguards gain
150/300/600 bonus health at round start · Precharged Energy: Vanguards gain 10/20/40 % ult energy
at round start · Last Stand Damage Enhancement: Vanguard damage +2/4/8 % per 200 health lost ·
Steady Recovery: per Vanguard, restore 1.5/3/6 % of lost health per second

*Legendary* — Critical Damage Shell: Vanguards gain 80 % damage reduction for 3 s the first time
their health drops below 30 % · Backup Rebirth: Vanguards revive with 30 % health on first KO ·
Infinite Drive: Vanguards have a 40 % chance not to consume energy per ultimate use

**Protocol: Onslaught** (Duelist · red)

*Common* — Attack Speed Enhancement +8/16/24/32/40/56 % · Damage Enhancement +8/16/24/32/40/56 % ·
Health Expansion +30/60/90/120/150/210 · Defensive Shell −2/4/6/8/10/14 % · Charge Acceleration
+20/40/60/80/100/140 % · Health Suppression / Damage Interference / Healing Suppression: per
Duelist, −1/2/3/4/5/7 %

*Rare* — Initial Damage Enhancement: Duelist damage +20/40/80 % for 10 s at round start · Reserve
Armor: +50/100/200 bonus health at round start · Precharged Energy: +10/20/40 % ult energy at
round start · Vulnerability Mark: Duelists apply 1 stack of 1/2/4 % Vulnerability on damage ·
Life Steal: +4/8/16 % lifesteal

*Legendary* — Annihilator Fury: after each Final Hit, Duelists enter Rampage — fully restore
health, +40 % attack speed and lifesteal · Backup Rebirth: revive with 40 % health on first KO ·
Infinite Drive: 40 % chance not to consume energy per ultimate

**Protocol: Reboot** (Strategist · green)

*Common* — Attack Speed Enhancement +8/16/24/32/40/56 % · Healing Enhancement: Strategist healing
+8/16/24/32/40/56 % · Health Expansion +30/60/90/120/150/210 · Defensive Shell −2/4/6/8/10/14 % ·
Charge Acceleration +20/40/60/80/100/140 % · Health / Damage / Healing Suppression: per
Strategist, −1/2/3/4/5/7 %

*Rare* — Initial Healing Boost: Strategist healing +15/30/60 % for 10 s at round start · Reserve
Armor +50/100/200 · Precharged Energy +10/20/40 % · Overflow Recharge: convert Strategist overflow
healing to 15/30/60 % bonus health · Deadly Healing: Strategist healing abilities also deal
10/20/40 % damage to enemies

> In-game name is **"Initial Healing Boost"**; the wiki says "Initial Healing Enhancement". Use
> the in-game string.

*Legendary* — Double Heal: 40 % chance each heal triggers again · Critical Counter: the first time
a Strategist enters a near-death state, damage taken over the next 3 s converts to healing ·
Infinite Drive: 40 % chance not to consume energy per ultimate

**Protocol: Equilibrium** (role diversity · purple — scales with *unique roles* in the lineup)

*Common* — per unique role: Attack Speed +2/4/6/8/10/14 % · Dual Enhancement (damage AND healing)
+2/4/6/8/10/14 % · Health Expansion +15/30/45/60/75/105 · Defensive Shell −1/2/3/4/5/7 % · Charge
Acceleration +6/12/18/24/30/42 % · Health / Damage / Healing Suppression: enemy −2/4/6/8/10/14 %

*Rare* — per unique role: Initial Dual Enhancement +5/10/20 % damage & healing for 10 s at round
start · Reserve Armor +25/50/100 bonus health at round start · Precharged Energy +3/6/12 % ult
energy at round start · Health Increment +2.5/5/10 % max health · Last Stand Damage Enhancement
+2/4/8 % damage per 200 health lost

*Legendary* — per unique role: Cumulative Dual Enhancement: +1 % damage & healing every second ·
Backup Rebirth: revive with 10 % health per unique role on first KO · Infinite Drive: 10 % chance
not to consume energy per ultimate

### Protocol level bonuses

| Protocol | Lvl 1 (10 XP) | Lvl 2 (20 XP) | Lvl 3 (40 XP) |
|---|---|---|---|
| Fortress | +120 max health, all allies | +120 max health | +240 max health |
| Onslaught | +12 % damage output | +12 % damage | +24 % damage |
| Reboot | +12 % healing | +12 % healing | +24 % healing |
| Equilibrium | per unique role: +20 HP, +2 % dmg & heal | +20 HP, +2 % | +40 HP, +4 % |

### Hero roster (39) — role, canonical base health, targeting priority

**N** = nearest enemy · **L** = lowest max health · **H** = highest max health.

**Vanguards (10)** — Captain America 575 **L** · Doctor Strange 575 **N** · Emma Frost 600 **N** ·
Groot 700 **N** · Hulk 700 **N** · Magneto 650 **N** · Peni Parker 650 **N** · The Thing 700 **N** ·
Thor 600 **N** · Venom 675 **L**

**Duelists (20)** — Black Panther 275 **L** · Black Widow 250 **L** · Hawkeye 250 **N** ·
Hela 250 **N** · Human Torch 250 **N** · Iron Fist 300 **N** · Iron Man 250 **N** · Magik 250 **L** ·
Mister Fantastic 375 **N** · Moon Knight 275 **N** · Namor 275 **N** · Psylocke 250 **L** ·
Scarlet Witch 250 **L** · Spider-Man 250 **L** · Squirrel Girl 275 **N** · Star-Lord 250 **N** ·
Storm 250 **N** · The Punisher 300 **N** · Winter Soldier 275 **N** · Wolverine 350 **H**

**Strategists (9)** — Adam Warlock 275 **N** · Cloak & Dagger 275 **N** · Invisible Woman 275 **N** ·
Jeff the Land Shark 250 **N** · Loki 275 **N** · Luna Snow 275 **N** · Mantis 250 **N** ·
Rocket Raccoon 250 **N** · Ultron 250 **N**

> Hulk's infobox lists 200 (Bruce Banner) / 700 (Hulk). Use **700**. Record both with a comment.

### Ultron Drone (the player)

Health **50** = player health. One of 6 random colours per match: Blue, Yellow, White, Default,
Red, Green. Map: **Age of Ultron: Digital Duel Grounds**.

| Input | Ability | Effect |
|---|---|---|
| LMB | Encephalo-Ray | Burning energy beam, **very minimal damage**, infinite ammo (`∞` in the HUD) |
| LSHIFT | One-Time Damage | One-time damage to **all surviving enemy units** |
| E | One-Time Healing | One-time healing to **all surviving allied units** |
| LALT | Cursor Mode | Releases mouse-look to interact with UI |
| B | Modules | Opens the module menu mid-battle |

---

## UI Specification

The real UI is a **dark navy** (`#161B2B`-ish) panel system over the 3D arena, with a single
**gold/amber accent** (`#FFC800`-ish) for the active tab underline, primary buttons, timers, and
titles. Headings are heavy italic condensed uppercase. Replicate the *structure and language*
exactly; the arena beneath is our 2D canvas instead of their 3D scene.

### Colour tokens

| Token | Use |
|---|---|
| Fortress blue `#4A6BD8` | Vanguard cards, protocol 1 icon |
| Onslaught red `#C8383C` | Duelist cards, protocol 2 icon |
| Reboot green `#2E9E5B` | Strategist cards, protocol 3 icon |
| Equilibrium purple `#8B44C4` | Role-diversity cards, protocol 4 icon |
| Common star `#6E8BE8` · Rare star `#E040C0` · Legendary star `#FFD400` | Rarity throughout |
| Strengthen gold `#E8A020` | Strengthen cards, the strengthen counter |
| Change-Hero lavender `#9A8FD8` | The three role cards |
| Win-streak green / Loss-streak red | Scoreboard streak badges |

### Persistent chrome (present in every in-round screen)

- **Top centre** — `⏱ round-phase` · phase-icon strip (completed phases become ✓) · phase name
  and countdown beneath.
- **Left rail** — four protocol icons stacked (Fortress, Onslaught, Reboot, Equilibrium), each
  showing `XP / nextThreshold` with a level badge; the active/highlighted one is gold. Below
  them, the gold **Strengthen Module counter** (`X2`). Clicking any icon opens its **info pane**.
- **Right panel** — player list **sorted by health descending**: portrait with a health ring and
  numeric health, name, streak badge (green = wins, red = losses, with the count), and `◇tokens`.
  Eliminated players show **`Out of Play`** in place of health. Two view tabs.
- **Bottom centre** — the player's `50/50` health bar.
- **Bottom right** — contextual key hints (`TAB SCOREBOARD`, `ESC MENU`, `B DEPLOY`).

### Protocol info pane (`UBMP_LEFTSIDE_ICON_CLICK_INFO_PANE_EXAMPLE*.png`)

Header: protocol icon + level badge, `Protocol: <Name>`, `XP n / threshold`. Then all three tier
bonuses stacked, with **earned tiers in cyan** and unearned in white. Then the legend row
`★ = XP+1 · ★ = XP+2 · ★ = XP+4`. Then a scrollable **`Owned Modules:`** list — each entry is
the module name in its rarity colour, its star row at the **owned level**, and its **cumulative
value at that level**.

### Screen inventory

1. **Draft** — mode title + tagline (*"Harness your superior intellect! Seek out the perfect
   solution within the simulation and eradicate all rival subprocesses."*), the 18-hero pool as
   a fanned arc of portrait cards with hover name tooltips, six empty lineup slots along the
   bottom, `LINEUP (n/6)` confirm, `Assemble Your Team` + countdown.
2. **Module Draw** — tabs `SELECT · ACTIVATED · CHANGE HERO` with a gold underline on the active
   one; rarity-odds row `★ n% ★ n% ★ n%`; `◇ tokens (+preview)`; four cards; `REFRESH ◇1` and
   `LOCK`/`UNLOCK`.
   - **Card**: protocol-coloured banner with the protocol icon, module name in caps, effect text
     (level-1 value), a 6/3/1 star row at the owned level, and a footer button reading
     `PURCHASE` or `UPGRADE` with `◇price` — **price renders red when unaffordable**.
   - A purchased card's slot **goes empty and does not refill** for the rest of the phase.
   - Locked cards carry a gold padlock badge; refresh greys out; footer reads
     *"Locked modules will not be refreshed in the next round"*.
3. **Change Hero tab** — three lavender cards: `CHOOSE VANGUARD` / `CHOOSE DUELIST` /
   `CHOOSE STRATEGIST`, described as *"Choose One of N Random <Role>s to Replace a Current Hero"*
   with N = 3 / 6 / 3, each `SELECT ◇5`.
4. **Swap-out** — `SELECT HERO TO SWAP OUT`, subtitle *"HEROES SWAPPED IN THIS PHASE WILL TAKE
   EFFECT IN THE NEXT ROUND."*, a grey **`RESERVE HEROES`** row above a blue **`ACTIVE HEROES`**
   row with a `⇄` between them; the chosen pair is outlined gold; heroes carrying Strengthen
   Modules show a pip (`x2`). Footnote: *"*When a hero is swapped, any equipped Strengthen
   Modules will be converted to matching usable modules."* Then `CONFIRM` / `CANCEL`.
5. **Select Position** — the 6×4 grid rendered in perspective with drag-and-drop hex tokens,
   `EXIT EDITING` and `DEPLOY`.
6. **Battle** — your name top-left, **opponent name top-right**, a kill feed (`KILLER ⟶ weapon ⟶
   VICTIM`), long segmented health bars above every unit, the drone in third person, and the two
   ability buttons `LSHIFT` / `E` which grey out once spent. Hint bar: `LALT CURSOR MODE / B MODULES`.
7. **Reward (Practice rounds only)** — big `SELECT REWARD` title, **three** gold Strengthen cards
   with hero art, ability keybind chips inline in the description, `REFRESH 1/1`, and
   `❗ Select N Strengthen Modules`.
8. **Scoreboard (TAB)** — columns `Rank · Player Name · Deploy · Initiate Protocol`. **Deploy**
   shows every player's six hero portraits; **Initiate Protocol** shows their four protocol
   levels plus their Strengthen count. A divider marks the **top-3 cutoff**; rows below it dim.
   **All opponent information is public** — lineups, protocol levels, tokens, health, streaks.
9. **Final standings**.

---

## Architecture

```
battle-matrix/
├─ .github/workflows/deploy.yml     GitHub Pages via actions/deploy-pages
├─ index.html
├─ vite.config.ts                   base: '/battle-matrix/'
├─ src/
│  ├─ data/
│  │  ├─ heroes.json                39 heroes: role, baseHealth, targeting, combat stats
│  │  ├─ modules.json               all Base Modules, verbatim tables
│  │  ├─ strengthen.json            78 Strengthen Modules (39 heroes × 2)
│  │  ├─ strings.ts                 every in-game string, verbatim (see Appendix)
│  │  ├─ constants.ts               CANONICAL values only
│  │  └─ authored.ts                every AUTHORED + DERIVED value, one place
│  ├─ sim/                          PURE. No DOM, no globals, no Date.now, no Math.random.
│  │  ├─ rng.ts                     seeded PRNG + named substreams
│  │  ├─ types.ts
│  │  ├─ match.ts                   round/phase machine, pairing, phantoms, elimination
│  │  ├─ economy.ts                 income, interest, streak, HP compensation, preview
│  │  ├─ modules.ts                 rarity odds, draws, buy/upgrade/sell, protocol XP
│  │  ├─ stats.ts                   module stack → resolved per-unit combat stats
│  │  ├─ combat.ts                  30 Hz tick sim
│  │  ├─ abilities.ts               ability + ultimate registry
│  │  └─ effects.ts                 buffs, debuffs, shields, revives, vulnerability
│  ├─ ai/                           bot policies (draft, economy, modules, deploy, drone)
│  ├─ ui/
│  │  ├─ chrome/                    top bar, left rail, right panel, health bar, hints
│  │  ├─ screens/                   draft, shop, changeHero, swapOut, deploy, reward,
│  │  │                             scoreboard, standings
│  │  └─ theme.css                  colour tokens above
│  ├─ render/                       Canvas2D battle renderer, token art, kill feed
│  └─ main.ts
└─ tests/                           Vitest — unit, invariant, golden-replay
```

**The one architectural rule:** `src/sim/` is pure and headless. Seed + ordered action list in,
whole match out. Nothing in `sim/` may import from `ui/` or `render/`, or touch `window`,
`Math.random`, or `Date`.

---

## Milestones

Each milestone ends with a green test suite. Do not start the next until **Exit** holds.

---

### M0 — Scaffold and deploy pipeline

**Build:** Vite (vanilla-ts), strict TypeScript (`strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`), Vitest, ESLint. `vite.config.ts` sets `base: '/battle-matrix/'`.
`.github/workflows/deploy.yml` builds on push to `main` and publishes via
`actions/upload-pages-artifact` + `actions/deploy-pages`. Placeholder title screen.

**Assertions:** `tsconfig` has `"strict": true`; `package.json` `dependencies` is empty; build
output contains no absolute `/assets` paths.

**Tests:** `npm run build` succeeds · `npm test` runs with 1 smoke test · lint exits 0.

**Exit:** placeholder is live at the Pages URL with no 404s.

---

### M1 — Canonical data layer

**Build:** `heroes.json`, `modules.json`, `strings.ts`, `constants.ts`, `authored.ts`, and a
`validate.ts` that runs at test time. Author combat stats from these bands, tune in M11:

| Role | Health | DPS | Range | Move |
|---|---|---|---|---|
| Vanguard | 575–700 (canonical) | 55–85 | 3–8 melee, 12–18 ranged | 3.0 |
| Duelist | 250–375 (canonical) | 110–170 | 5 melee, 20–34 sniper | 3.6–4.4 |
| Strategist | 250–275 (canonical) | 45–70 + heal 60–95 | 16–22 | 3.4 |

**Assertions:**
- Exactly 39 heroes: 10 Vanguard, 20 Duelist, 9 Strategist.
- Every `baseHealth` matches the canonical table exactly.
- The three targeting lists partition the roster — no hero missing, none in two lists.
- Every Base Module's `values.length` is 6 / 3 / 1 by rarity — **except** Fortress "Damage
  Enhancement" at 4, asserted as a known source quirk.
- Sell values 4 / 9 / 14; XP 1 / 2 / 4; thresholds `[10, 20, 40]`; starting tokens 10; base
  income 15; starting health 50; refresh cost 1; Common buy 5; swap 5.
- Change-Hero offer sizes are `{vanguard: 3, duelist: 6, strategist: 3}`.
- Every hero id is unique, kebab-case, and referenced by `strengthen.json` exactly twice.

**Tests:** `tests/data.spec.ts` — the above, plus a snapshot of every module effect string and
every UI string in `strings.ts` so accidental edits to canonical text fail loudly.

**Exit:** data tests green; `authored.ts` holds every non-canonical number and nothing else does.

---

### M2 — Deterministic RNG and the round/phase machine

**Build:** `rng.ts` (mulberry32 + a `RngStream` class giving shop, combat, and each AI their own
**named substream**). `match.ts`: 6 players at 50 HP and 10 tokens · pool assignment (6/6/6) ·
draft · the **round-phase loop** (3 phases, 4 on Practice rounds) · PvE at 1/6/11/16/21 · PvP
pairing · odd-count mirror rule · phantoms · damage · elimination and placement.

Pairing: shuffle living players, pair sequentially, preferring a pairing that avoids an opponent
faced in the previous 2 rounds when one exists.

**Assertions:**
- Same seed + same action list ⇒ byte-identical state at every phase boundary.
- Rounds 1, 6, 11, 16, 21 are `practice` and have **4** phases; all others `battle` with **3**.
- Phase ids advance `1→2→3(→4)` and the display string is `${round}-${phase}`.
- Every living player is in exactly one pairing per PvP round; with an odd count exactly one gets
  a mirror matchup.
- A player at ≤0 HP is eliminated that round, placed at `livingPlayers + 1`, and thereafter reads
  `Out of Play`.
- Beating a phantom changes nothing for the phantom's owner.
- Placements across a finished match = 6, distinct, 1–6.

**Tests:** `tests/match.spec.ts` — determinism · a forced-loss run 50→0 asserting placement ·
odd-count mirror · 200-seed fuzz: every match terminates with one winner and no HP below 0
without elimination · phase-count-by-round-type table test.

**Exit:** a headless match runs end to end on stub combat and always yields a valid standing.

---

### M3 — Economy engine

**Build:** `economy.ts`. Round-start income resolves in this fixed order: **base 15 → interest →
streak**. The **+2 PvP win bonus is applied at battle resolution**, not round start (see ledger).
HP compensation grants +1 per health lost, at the moment health is lost. Streak: same-result
rounds increment, opposite result resets to 1; bonus `min(streak, 4)`.
Interest `min(floor(tokens / 10), 5)`. Export `previewIncome(state)` for the HUD.

**Assertions:**
- Starting tokens are exactly 10.
- Interest: 0→0, 9→0, 10→1, 29→2, 50→5, 137→5.
- Streak over 5 consecutive wins yields 1, 2, 3, 4, 4 — never 5.
- A loss after a win streak resets the counter to 1 (loss streak), not 0.
- Losing 8 HP grants exactly +8 tokens.
- **`previewIncome` reproduces the three observed screenshots exactly:** 10 tokens, no streak →
  `+16`; 5 tokens, no streak → `+15`; 0 tokens, 12-win streak → `+19`.
- Tokens never go negative; eliminated players accrue no income.

**Tests:** `tests/economy.spec.ts` — interest table · a 12-round scripted win/loss ledger checked
against hand-computed values · **the three-screenshot preview regression test** · a property test
that `tokens >= 0` after any sequence of legal purchases.

---

### M4 — Module system

**Build:** `modules.ts` + `stats.ts`.

- **Rarity odds** from the derived formula; expose them so the shop can render the `★ n%` row.
- Draw 4 offers: roll rarity globally, then pick among protocols eligible for that rarity
  (level ≥1 Rare, ≥2 Legendary). A purchased slot **goes empty and does not refill this phase**.
- Buy Common 5 (Rare 10 / Legendary 15, authored). Duplicates **upgrade**; Legendary cannot.
- Sell 4 / 9 / 14, **removing its XP**, which can drop a protocol level.
- Refresh **1 token**; `LOCK` carries the current four into the next round and disables refresh.
- Change Hero 5 tokens → 3 / 6 / 3 role offers → swap-out; the outgoing hero's Strengthen Modules
  are **converted back to selectable modules**, not auto-assigned.
- Protocol XP → level `[10, 20, 40]`, bonuses cumulative (Fortress L3 = 120+120+240 = +480).
- Two display helpers, tested separately: `shopCardValue(module)` → **level-1 value**;
  `ownedValue(module, level)` → **cumulative value at level**.
- `stats.ts` folds everything into a `ResolvedUnit`.

Aggregation order — implement and test exactly this:
`baseHealth → flat additive health (Health Expansion, Fortress/Equilibrium level bonuses) →
percentage health multipliers (Health Increment) → round-start bonus health (Reserve Armor, added
last, never multiplied)`. Damage:
`baseDps × (1 + Σ damage%) × (1 + protocolLevel%) × (1 − enemy Damage Interference)`.

**Assertions:**
- Rarity odds match all three observed samples exactly (100/0/0, 86.5/12/1.5, 81/16/3).
- A Rare module never appears while its protocol is L0 (fuzz 10 000 draws); Legendary never below L2.
- 10 Commons in one protocol ⇒ exactly L1; 10 Common + 5 Rare = 20 XP ⇒ L2.
- Selling below a threshold drops the level and its bonus.
- A Common upgraded 6 times sits at value 6 and cannot upgrade again.
- **`shopCardValue` reproduces the screenshots**: Fortress Health Expansion → `90.0`; Onslaught
  Charge Acceleration → `20.0 %` regardless of owned stars.
- **`ownedValue` reproduces the screenshots**: Initial Healing Boost ★★ → `30.0 %`; Healing
  Enhancement ★★★★ → `32.0 %`; Health Expansion ★★ → `60.0`.
- Equilibrium scales with **unique roles (1–3)**, not hero count: 6 Duelists ×1, a 2-2-2 ×3.
- Change-Hero offers are 3 / 6 / 3 by role and never offer a hero already in the lineup.
- Tokens spent + held + refunds = tokens earned, over any sequence.

**Tests:** `tests/modules.spec.ts` (odds fit, gating fuzz, XP ladder, upgrade cap, sell-down,
lock/refresh) · `tests/display.spec.ts` (the two value rules against screenshot values) ·
`tests/stats.spec.ts` (golden `ResolvedUnit[]` snapshot — the regression net for M11 balancing).

---

### M5 — Combat simulation core (headless)

**Build:** `combat.ts` — fixed **30 Hz** integer tick, no wall-clock. Per tick, in this order:
`effects → target acquisition → movement → attacks → abilities/ults → damage & healing →
death checks`. Iterate units in a stable id order.

- Targeting per canonical priority; re-acquire only when the target dies or leaves range >0.5 s.
- Units close to `attackRange`, then fire on their attack-speed cadence.
- Ult energy accrues from damage dealt/taken and healing done, scaled by Charge Acceleration;
  at 100 % the unit casts (Infinite Drive rolls its 40 % no-consume here).
- **Speed Up Protocol** at battle-timer 0: **+120 % damage** to all heroes. A hard cap ends it as
  a **tie**.
- Emit a **kill event stream** (`killer`, `weapon`, `victim`) for the HUD kill feed.
- Result `win`/`loss`/`tie` + surviving unit count, feeding M2's damage formula.

**Assertions:**
- Same seed + inputs ⇒ identical tick-by-tick log; hash 100 runs, all equal.
- No unit exceeds resolved max health except via explicit bonus-health effects.
- Battles always terminate within `maxTicks`; the sim throws rather than looping.
- Speed Up multiplies damage by exactly 2.2, applied once, never stacking per tick.
- Targeting: a Wolverine facing a 700 HP and a 250 HP enemy picks the 700; a Venom picks the 250.
- Damage-taken and damage-output reductions are multiplicative, not additive.
- Excess healing is discarded unless Overflow Recharge is active.
- Every KO produces exactly one kill event.

**Tests:** `tests/combat.spec.ts` — determinism hash · targeting matrix over all three priorities ·
a 1v1 with known stats against a hand-computed time-to-kill (±1 tick) · Speed Up timing ·
`tests/replay.spec.ts` golden replays: 5 fixed seeds with committed full-match outcomes.

---

### M6 — Ultron Drone and Practice Protocol

**Build:** Drone with free 2D movement, `Encephalo-Ray` on hold-LMB (infinite ammo), and the two
**one-time-per-battle** abilities on `LSHIFT` and `E`. Both grey out once spent and reset next
round. Random colour from the canonical six. Galacta Bot waves for rounds 1, 6, 11, 16, 21,
scaling with round number, paying 1 / 1 / 2 / 2 / 2 Strengthen Modules — presented as **3 offers
with one free refresh**.

**Assertions:**
- Each one-time ability fires at most once per Battle Phase and resets next round.
- One-Time Damage hits every living enemy and no allies; One-Time Healing the reverse.
- Encephalo-Ray's whole-battle damage is <5 % of a Duelist's — never a win condition.
- PvE rounds award exactly 1 / 1 / 2 / 2 / 2 by round.
- Offers are always 3 cards, always for heroes **in the current lineup**, refresh usable once.
- The Drone cannot be damaged; its 50 HP changes only through round results.

**Tests:** `tests/drone.spec.ts` · `tests/practice.spec.ts` (reward counts, lineup scoping,
single refresh).

---

### M7 — AI opponents

**Build:** five bots, each a policy bundle:

| Archetype | Economy | Modules | Deploy |
|---|---|---|---|
| Greedy Banker | holds for max interest | buys only at 50+ tokens | standard 2-2-2 |
| Protocol Rusher | spends to zero | forces one protocol to L3 | stacks that role |
| Equilibrium Purist | balanced | Equilibrium only | strict 2-2-2 |
| Streak Rider | rides loss streaks | opportunistic | aggressive front-load |
| Adaptive | interest to r8, then spend | best-value pick | counters the last opponent seen |

Deploy heuristic: Vanguards front row, ranged Duelists back, melee Duelists flanking, Strategists
back-centre. Drone policy: One-Time Damage when ≥3 enemies are below 40 % HP; One-Time Healing
when ≥2 allies are below 40 %.

**Assertions:**
- Every AI decision draws from its **own named substream** — adding a bot never shifts another's
  or the player's rolls.
- No AI spends below 0 or buys a rarity-locked module.
- Every AI fields exactly 6 heroes each round with no empty slot.
- Over 100 seeded AI-only matches no archetype wins <5 % or >50 %.

**Tests:** `tests/ai.spec.ts` — 10 000-turn legality fuzz · substream isolation · the 100-match
distribution report.

---

### M8 — UI shell, chrome, and menu screens

**Build:** `theme.css` with the colour tokens above. The persistent chrome (top bar with
`round-phase` + phase-icon strip + timer, left protocol rail with XP meters and level badges and
the Strengthen counter, right player list sorted by health with streak badges and `Out of Play`,
bottom health bar, contextual key hints). Then the menu screens: **Draft**, **Module Draw** with
all three tabs, **Change Hero**, **Swap-out**, **Select Position**, **Reward**, **Scoreboard**,
**Final Standings**. Protocol **info pane** on left-rail click.

Every visible string comes from `strings.ts`. Hero tokens: role-coloured shape (Vanguard shield /
Duelist blade / Strategist cross) with 2-letter initials and a Strengthen pip, resolved through a
single `resolveHeroArt(hero)` so a later image drop-in touches one file.

**Assertions:**
- The UI dispatches **actions** into the sim and renders **state** out of it — no rule lives in a
  component. Grep-enforced: no arithmetic on tokens/health/XP outside `src/sim/`.
- The HUD income preview equals `economy.previewIncome` for any state (500 random states).
- The rarity-odds row equals `modules.rarityOdds` for any protocol-level combination.
- Left-rail meters read `xp/nextThreshold` with the correct level badge at every XP value 0–60.
- Shop cards render `PURCHASE` vs `UPGRADE` correctly, show the **level-1 value**, fill the star
  row to the **owned level**, and render the price red exactly when `tokens < price`.
- A purchased card's slot empties and stays empty for the phase.
- `LOCK` disables `REFRESH` and shows the padlock on all four cards.
- Change-Hero cards read "Choose One of **3/6/3** Random …" matching the role.
- Swap-out shows Reserve above Active and blocks confirm until one of each is selected.
- Drag-and-drop cannot double-occupy a cell, exceed 6 heroes, or place on the enemy half.
- Scoreboard shows all six lineups, all four protocol levels, and the Strengthen count per player,
  with the top-3 divider.
- Layout works 1280×720 → 1920×1080 and degrades legibly to 1024 wide.

**Tests:** `tests/ui-actions.spec.ts` (every UI action maps to a legal sim action) ·
`tests/hud.spec.ts` (preview, odds row, meters, card states against the screenshot values) ·
`docs/QA.md` — a side-by-side checklist pairing each screen with its screenshot.

---

### M9 — Battle renderer and battle HUD

**Build:** Canvas2D renderer at devicePixelRatio scaling: the arena, unit tokens with long
segmented health bars, ult-charge bars, damage numbers, optional target lines, and the drone.
Battle HUD: your name top-left, **opponent name top-right**, the **kill feed** fed by M5's kill
events, `LSHIFT`/`E` ability buttons that grey when spent, `LALT CURSOR MODE / B MODULES` hints,
and the `50/50` health bar. Galacta Bots render as visually distinct monster tokens, not heroes.
Speed Up Protocol announces itself on screen.

**Assertions:**
- The renderer receives a **readonly** snapshot and never mutates sim state.
- Rendering is decoupled from the tick: the sim runs at a fixed 30 Hz regardless of frame rate,
  and the renderer interpolates.
- The kill feed shows every kill event once, in order, capped at the most recent N.
- Ability buttons grey exactly when the sim marks them spent.
- `B` opens the module menu mid-battle and purchases made there are flagged **next-round**.
- 60 fps with 12 units + effects on a mid-range laptop.

**Tests:** `tests/render.spec.ts` (snapshot immutability, kill-feed ordering, interpolation
independence from tick rate) · manual QA against the two battle screenshots.

---

### M10 — Strengthen Modules (78 total)

**Build:** `strengthen.json` with all 39 heroes × 2, using the **canonical effect text** —
verified against the screenshots, which show *Loki's Sanctuary*, *Soul Reaper*, and *Ghost
Thornlash Wall* matching the wiki word for word. Each card displays the bound **ability keybind
chip** inline. Each module gets an implementation in `abilities.ts`.

Where a module references a real Rivals ability the sim doesn't model deeply, implement the
closest faithful analogue and annotate it — e.g. Hawkeye's *One Shot, Four Down* becomes 3 extra
projectiles at a documented fraction of primary damage.

**Assertions:**
- Exactly 78 modules, exactly 2 per hero, every one with a runnable implementation (no reachable
  `TODO` handler).
- Effect text matches the canonical strings character-for-character (snapshot test).
- Every module measurably changes its hero's simulated output — a scripted 1v1 with it active
  differs from one without. This catches silently-unwired effects.
- Jeff's *Looting Leviathan* rarity distribution over 100 000 seeded rolls is within ±1 % of
  4 → 90/8/2, 5 → 60/30/10, 6+ → 0/70/30.
- Swapping a hero converts their equipped modules back to selectable modules; the player's total
  Strengthen count is unchanged by the swap.

**Tests:** `tests/strengthen.spec.ts` — completeness, text snapshot, the per-module "it does
something" harness, the Jeff distribution, and the swap-conversion invariant.

---

### M11 — Balance, polish, ship

**Build:** Tune authored hero stats against the M7 distribution gate. Seed entry + shareable seed
in the URL hash. `?debug=1` overlay showing tick count, resolved stats, and the event log. Write
`docs/FIDELITY.md` — this plan's ledger as living documentation. Accessibility: full keyboard
navigation of shop and board, `prefers-reduced-motion`, and a colour-blind-safe palette (role
*shapes* must carry the same information as role colours).

Prominent fan-project disclaimer in footer and README: unofficial, non-commercial, not affiliated
with NetEase Games, Marvel, or Disney; no game assets redistributed.

**Assertions:**
- No hero has >55 % or <45 % win rate over 500 seeded mirror-lineup matches.
- No single protocol wins >40 % of 500 seeded AI matches.
- **Average HP lost per round loss over 500 simulated matches falls in 2.5–3.5**, matching the
  observed round-9 lobby.
- Bundle <500 KB gzipped; interactive in <2 s cold.
- `npm test` green, `npm run build` clean, no `any` outside declared boundaries.
- The deployed URL plays a full match with no console error.

---

## Verification

```bash
npm test                    # Vitest: all specs
npm run test:determinism    # 100× same-seed replay hashing
npm run build               # tsc + vite production build
npm run preview             # serve dist/ locally, play a full match
```

End-to-end acceptance on the deployed URL — **keep the matching screenshot open for each step**:

1. Draft: 18-hero pool of 6/6/6, `LINEUP (0/6)` fills to 6, timer counts down.
2. Round `1-1` is a Practice round with **4** phase icons; header names the phase; you start with
   **◇10** and the preview reads **(+16)**.
3. Buy one module for **◇5** — the slot empties, tokens read **5**, preview drops to **(+15)**,
   and the matching protocol meter ticks to `1/10`.
4. `REFRESH` costs **1**. `LOCK` greys refresh and badges all four cards.
5. Phase `1-2` `Select Position`: drag onto the 6×4 grid; placement persists into battle.
6. Phase `1-3`: Galacta Bots appear as monsters; fly the drone; fire `LSHIFT` and `E` and confirm
   each greys out; kill feed populates.
7. Phase `1-4` `SELECT REWARD`: **3** gold cards, `REFRESH 1/1` usable once, `Select 1 Strengthen
   Modules`, and the left-rail Strengthen counter goes to `x1`.
8. Round 2 is PvP with **3** phases; opponent name appears top-right.
9. Lose a round: health drops by roughly **2–4**, and you gain **+1 token per health lost**.
10. Reach 10 XP in one protocol: level badge shows `1`, the meter switches to `/20`, the tier-1
    bonus turns cyan in the info pane, and the rarity row moves off `100 / 0 / 0`.
11. Open the info pane: `XP n/20`, all three tiers listed, the `★=+1 ★=+2 ★=+4` legend, and the
    Owned Modules list showing **cumulative** values at owned star level.
12. `CHANGE HERO` for **◇5**: offers read 3 / 6 / 3 by role; the swap screen shows Reserve above
    Active; a hero with Strengthen Modules shows its pip; after confirming, those modules return
    as selectable modules.
13. `TAB`: scoreboard shows all six lineups, protocol levels, Strengthen counts, top-3 divider.
14. Let a battle run long — **Speed Up Protocol** announces and damage jumps.
15. Play to an elimination: that player becomes a phantom and reads **`Out of Play`**.
16. Play to the end; placements 1–6 assigned, one player remains.
17. Re-enter the same seed; the match replays identically.

---

## Appendix — verbatim in-game strings

Put these in `strings.ts`; they are snapshot-tested.

```
Harness your superior intellect! Seek out the perfect solution within the
simulation and eradicate all rival subprocesses.

Assemble Your Team            LINEUP (n/6)
PRACTICE PROTOCOL             BATTLE PROTOCOL
Select Position               Waiting for Others
Select the Modules you wish to purchase
PRACTICE PROTOCOL REWARD PHASE          SELECT REWARD
SELECT · ACTIVATED · CHANGE HERO
PURCHASE · UPGRADE · REFRESH · LOCK · UNLOCK · SELECT · CONFIRM · CANCEL
Locked modules will not be refreshed in the next round
The effects of purchased modules take effect in the next round.
Select 1 Strengthen Modules
CHOOSE VANGUARD / CHOOSE DUELIST / CHOOSE STRATEGIST
Choose One of N Random <Role>s to Replace a Current Hero
SELECT HERO TO SWAP OUT
HEROES SWAPPED IN THIS PHASE WILL TAKE EFFECT IN THE NEXT ROUND.
RESERVE HEROES · ACTIVE HEROES
*When a hero is swapped, any equipped Strengthen Modules will be converted
to matching usable modules.
Rank · Player Name · Deploy · Initiate Protocol
Out of Play
TAB SCOREBOARD · ESC MENU · ESC BACK · B DEPLOY · B MODULES
EXIT EDITING · LALT CURSOR MODE
```

---

## Open items, deliberately deferred

- **Rare / Legendary buy price.** Every observed card showed `◇5` regardless of rarity. A flat 5
  for all rarities is plausible; 10/15 is the assumption. One file to change.
- **The +2 PvP win bonus** never appears in a round-start income preview. Modelled as granted at
  battle resolution. If footage shows otherwise, correct `economy.ts` only.
- **The `◇1` corner badge** on Strengthen and Change-Hero cards has no confirmed meaning
  (quantity? sell value?). Rendered but inert until identified.
- **Exact phase timers** remain estimates bounded by observed clocks.
- **Round cap.** PvE is documented through round 21 and round 18 was observed; a safety cap at
  round 40 resolves by highest remaining health.
