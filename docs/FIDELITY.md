# FIDELITY — where the replica's data comes from, and where it doesn't

This document records the **provenance and fidelity grade** of every piece of
canonical text and data in the replica that was sourced from outside the plan.
M10 starts it with the **Strengthen Modules** section; M11 completes the rest
(hero stats, module tables, the derived formulas — the plan's "Source fidelity
ledger" becomes living documentation here).

Fidelity grades used below:

| Grade | Meaning |
|---|---|
| **A** | Verbatim in-game text, from a screenshot (`Screenshots/`) — the highest-authority source. |
| **B** | Verbatim from a wiki / first-party patch notes. |
| **C** | A secondary guide. Names are trustworthy; effect *wording* is the outlet's, not the game's. |
| **—** | Unsourced. Left blank in the data; never invented. |

---

## Strengthen Modules (M10)

**Scope.** 39 heroes × 2 = **78** rows in `src/data/strengthen.json`. The row
**ids are unchanged from the M1 skeleton** (`${heroId}-s${slot}`) — M4/M6 state,
tests and goldens key off them.

### Sourcing status

| | Count | Notes |
|---|---:|---|
| **Grade A** — screenshot-verbatim (name + effect + keybind) | **3** | `loki-s2` *Loki's Sanctuary*, `hela-s1` *Soul Reaper*, `groot-s2` *Ghost Thornlash Wall* — all from `Screenshots/UBMP_STRENGTHEN_MODULE_PURCHASE_SCREEN.png`. |
| **Grade C** — secondary guide (name + effect; keybind unknown) | **73** | Destructoid, *"Best Strengthen Modules in Marvel Rivals Ultron's Battle Matrix Protocol event"*. Effect text is the outlet's style-normalized wording (see the conflict note). |
| **Grade C** — guide mechanic + plan-supplied numbers | **1** | `jeff-the-land-shark-s1` *Looting Leviathan* — Destructoid for the name/mechanic, the M10 milestone text for the rarity table (verbatim). The one-sentence effect string is reconstructed from those two. |
| **Unsourced** — left blank, reported | **2** | `emma-frost-s1`, `emma-frost-s2`. |

**Retrieval date for every web source below: 2026-09-02.**

### Sources

| Source | URL | Result |
|---|---|---|
| Reward screenshot | `Screenshots/UBMP_STRENGTHEN_MODULE_PURCHASE_SCREEN.png` | **Used.** 3 modules, verbatim, with keybind chips. Outranks everything else. |
| Destructoid — "Best Strengthen Modules…" | `https://www.destructoid.com/best-strengthen-modules-in-marvel-rivals-ultrons-battle-matrix-protocol-event/` | **Used.** The only reachable *complete* list: 38 of 39 heroes × 2. No keybinds. Style-normalized copy. |
| Marvel Rivals Fandom wiki | `https://marvelrivals.fandom.com/wiki/Ultron%27s_Battle_Matrix_Protocol` | **Unreachable** — HTTP 402 to the fetcher (and via `api.php` / `?action=raw`). This is the source the plan expected; its verbatim strings could not be retrieved here. |
| Mobalytics — Battle Matrix modules + per-hero pages | `https://mobalytics.gg/marvel-rivals/battle-matrix/modules` (and `…/heroes/<id>`) | **Unreachable** — HTTP 403 (Cloudflare). |
| marvelrivals.gg — "All Modules in…" | `https://marvelrivals.gg/all-modules-in-ultrons-battle-matrix-protocol-mode/` | **Unreachable** — HTTP 403. |
| Wayback Machine (fandom snapshot) | `web.archive.org/web/2025/…` | **Unreachable** — the fetcher refuses `web.archive.org`. |
| Reader proxy | `r.jina.ai` | **Unreachable** — HTTP 401 (now key-gated). |
| Epiccarry / gamer.org / boostingfactory / marvel-rivals.net | — | Reachable but carry **no** module list. |

> Emma Frost's two modules are the only rows missing: she is absent from
> Destructoid's list, and no reachable source enumerates the mode's modules.
> Per M10 ("do not fabricate a name, an effect string, or a keybind"), both rows
> keep the empty skeleton strings. `src/sim/strengthen.ts` →
> `STRENGTHEN_SOURCING_GAPS` and `validate.ts` → `STRENGTHEN_GAP_IDS` list them;
> `tests/strengthen.spec.ts` asserts they are *exactly* the two blank rows.

### Screenshot-versus-source conflicts

The plan asked to verify *Loki's Sanctuary*, *Soul Reaper* and *Ghost Thornlash
Wall* against the wiki "word for word". The wiki was unreachable, but Destructoid
carries all three, and its versions differ from the screenshot **only in
house-style rendering** — never in an ability name, a number, or clause order:

| Row | Screenshot (Grade A — used) | Destructoid (Grade C) |
|---|---|---|
| `loki-s2` | `…cooldown by 18s, and increase Force Field Core health by 100.` + `LSHIFT` chip | `…cooldown by 18 seconds, and increase Force Field Core health by 100.` (no chip) |
| `hela-s1` | `…fire rate and magazine capacity by 70%.` + mouse-glyph chip | `…fire rate and magazine capacity by 70 percent.` (no chip) |
| `groot-s2` | `Reduce Thornlash Wall cooldown by 4s and passive trigger interval by 0.2s; Increase Thornlash Wall max count by 1.` + `LSHIFT` chip | `…by four seconds and… by 0.2 seconds; Increase… max count by one.` (no chip) |

**Resolution: screenshot wins** for these 3 (the plan's authority order). The
conflict is stylistic (`70%` vs `70 percent`, `18s` vs `18 seconds`, digit vs
number-word) and the omitted inline keybind chip — not substantive.

Two lower-confidence transcription calls on the screenshot rows, both flagged:

- **`hela-s1` keybind = `LMB`.** The chip after "Nightsword Thorn" is a
  *mouse glyph*, not the letters "LMB". Nightsword Thorn is Hela's primary fire,
  so `LMB` is the faithful reading — but it is an icon interpretation, not
  literal on-screen text.
- **`loki-s2` trailing period.** The card text wraps at "…health by 100" and a
  final period is not clearly legible at the screenshot's resolution; one was
  added for consistency with the other two Grade-A rows (both end `…`).

### The other 73 rows

Effect strings are **Destructoid's wording, verbatim as that outlet published
it** — i.e. style-normalized: "percent" not "%", "seconds" not "s", small numbers
spelled out, the inline keybind chip dropped. They were **not** hand-edited into
the game's house style (that would be manufacturing strings the game may not
match), and they were **not** verified against in-game text or the wiki. The
`character-for-character` snapshot in `tests/strengthen.spec.ts` guards them
against *accidental* edits; it does not certify them as the exact in-game copy.

**Keybinds for these 73 rows are unknown** (`keybind: ""`). Destructoid gives
none, and the bind-per-ability mapping could not be web-verified for this mode
(the reward screenshot showed *Thornlash Wall* on `LSHIFT`, which is not the
standard-mode bind, so the mode's control scheme cannot be assumed). The bound
ability's *name* is still present — it is inside the effect text, which is where
the game renders the chip.

### Full provenance table

`trigger` is the combat-implementation kind (`src/sim/strengthen.ts`):
`passive` = folded into the hero's resolved stats for the whole battle;
`onUlt` = a timed self-buff opened when the hero casts its ultimate.

| id | hero | module | trigger | grade | keybind |
|---|---|---|---|---|---|
| `captain-america-s1` | captain-america | Lawbreaker of Physics | passive | C — guide, style-normalized | (unknown) |
| `captain-america-s2` | captain-america | Captain Shield Throw | passive | C — guide, style-normalized | (unknown) |
| `doctor-strange-s1` | doctor-strange | Mercy of Denak | passive | C — guide, style-normalized | (unknown) |
| `doctor-strange-s2` | doctor-strange | Turbulent Maelstrom of Madness | passive | C — guide, style-normalized | (unknown) |
| `emma-frost-s1` | emma-frost | — | — | **UNSOURCED** | — |
| `emma-frost-s2` | emma-frost | — | — | **UNSOURCED** | — |
| `groot-s1` | groot | Great Ironwood Wall | passive | C — guide, style-normalized | (unknown) |
| `groot-s2` | groot | Ghost Thornlash Wall | passive | **A — screenshot verbatim** | `LSHIFT` |
| `hulk-s1` | hulk | Gamma Shield Bomb | passive | C — guide, style-normalized | (unknown) |
| `hulk-s2` | hulk | Gamma Shield Generator | passive | C — guide, style-normalized | (unknown) |
| `magneto-s1` | magneto | Wrath of Magneto | onUlt | C — guide, style-normalized | (unknown) |
| `magneto-s2` | magneto | Meteor Gravitation | onUlt | C — guide, style-normalized | (unknown) |
| `peni-parker-s1` | peni-parker | Field of Spider-Nests | passive | C — guide, style-normalized | (unknown) |
| `peni-parker-s2` | peni-parker | Web Hunting | passive | C — guide, style-normalized | (unknown) |
| `the-thing-s1` | the-thing | Yancy Street Rampage | passive | C — guide, style-normalized | (unknown) |
| `the-thing-s2` | the-thing | Invincible Haymaker | passive | C — guide, style-normalized | (unknown) |
| `thor-s1` | thor | Odin's Blessing | onUlt | C — guide, style-normalized | (unknown) |
| `thor-s2` | thor | Enjoy the Thunder | onUlt | C — guide, style-normalized | (unknown) |
| `venom-s1` | venom | Guaranteed Survival | passive | C — guide, style-normalized | (unknown) |
| `venom-s2` | venom | King in Black | passive | C — guide, style-normalized | (unknown) |
| `black-panther-s1` | black-panther | Endless Rend | passive | C — guide, style-normalized | (unknown) |
| `black-panther-s2` | black-panther | Bast Avatar | onUlt | C — guide, style-normalized | (unknown) |
| `black-widow-s1` | black-widow | Red Room Rifle 2099 | passive | C — guide, style-normalized | (unknown) |
| `black-widow-s2` | black-widow | Sniper Elite | passive | C — guide, style-normalized | (unknown) |
| `hawkeye-s1` | hawkeye | One Shot, Four Down | passive | C — guide, style-normalized | (unknown) |
| `hawkeye-s2` | hawkeye | Quick Draw | passive | C — guide, style-normalized | (unknown) |
| `hela-s1` | hela | Soul Reaper | passive | **A — screenshot verbatim** | `LMB` (glyph) |
| `hela-s2` | hela | Split Nightsword Thorn | passive | C — guide, style-normalized | (unknown) |
| `human-torch-s1` | human-torch | Chongming Heritage | passive | C — guide, style-normalized | (unknown) |
| `human-torch-s2` | human-torch | Amaterasu | passive | C — guide, style-normalized | (unknown) |
| `iron-fist-s1` | iron-fist | Martial Art Master | passive | C — guide, style-normalized | (unknown) |
| `iron-fist-s2` | iron-fist | Strength Taken, Strength Used | passive | C — guide, style-normalized | (unknown) |
| `iron-man-s1` | iron-man | Last Stand | passive | C — guide, style-normalized | (unknown) |
| `iron-man-s2` | iron-man | Proton Cannon | onUlt | C — guide, style-normalized | (unknown) |
| `magik-s1` | magik | Dance of Pain | passive | C — guide, style-normalized | (unknown) |
| `magik-s2` | magik | Echo of Limbo | passive | C — guide, style-normalized | (unknown) |
| `mister-fantastic-s1` | mister-fantastic | Rubber Boxer | passive | C — guide, style-normalized | (unknown) |
| `mister-fantastic-s2` | mister-fantastic | New Reflexive Rubber | passive | C — guide, style-normalized | (unknown) |
| `moon-knight-s1` | moon-knight | Random Items Go!!!! | passive | C — guide, style-normalized | (unknown) |
| `moon-knight-s2` | moon-knight | Super Ankh | passive | C — guide, style-normalized | (unknown) |
| `namor-s1` | namor | Imperius Rex | passive | C — guide, style-normalized | (unknown) |
| `namor-s2` | namor | Monstro Spawns Army | onUlt | C — guide, style-normalized | (unknown) |
| `psylocke-s1` | psylocke | Shin Dance of the Butterfly | onUlt | C — guide, style-normalized | (unknown) |
| `psylocke-s2` | psylocke | Slash Combo | onUlt | C — guide, style-normalized | (unknown) |
| `scarlet-witch-s1` | scarlet-witch | Pure Chaos | passive | C — guide, style-normalized | (unknown) |
| `scarlet-witch-s2` | scarlet-witch | Enhanced Seal | onUlt | C — guide, style-normalized | (unknown) |
| `spider-man-s1` | spider-man | Better Webs | passive | C — guide, style-normalized | (unknown) |
| `spider-man-s2` | spider-man | A More Friendly Neighborhood | onUlt | C — guide, style-normalized | (unknown) |
| `squirrel-girl-s1` | squirrel-girl | Mega Evolution Slingshot | passive | C — guide, style-normalized | (unknown) |
| `squirrel-girl-s2` | squirrel-girl | Acorn Bowling | passive | C — guide, style-normalized | (unknown) |
| `star-lord-s1` | star-lord | Unfading Starlight | onUlt | C — guide, style-normalized | (unknown) |
| `star-lord-s2` | star-lord | Real Legend | onUlt | C — guide, style-normalized | (unknown) |
| `storm-s1` | storm | Perfect Storm | passive | C — guide, style-normalized | (unknown) |
| `storm-s2` | storm | Wind Power Generator | passive | C — guide, style-normalized | (unknown) |
| `the-punisher-s1` | the-punisher | Microchip Implant | passive | C — guide, style-normalized | (unknown) |
| `the-punisher-s2` | the-punisher | Insect Repellent Smokescreen | passive | C — guide, style-normalized | (unknown) |
| `winter-soldier-s1` | winter-soldier | Greater Kraken Impact | onUlt | C — guide, style-normalized | (unknown) |
| `winter-soldier-s2` | winter-soldier | Here We Go Again | passive | C — guide, style-normalized | (unknown) |
| `wolverine-s1` | wolverine | Immortal | passive | C — guide, style-normalized | (unknown) |
| `wolverine-s2` | wolverine | Quenchless Rage | passive | C — guide, style-normalized | (unknown) |
| `adam-warlock-s1` | adam-warlock | Forge to Revive | onUlt | C — guide, style-normalized | (unknown) |
| `adam-warlock-s2` | adam-warlock | Fighting Nation Descent | onUlt | C — guide, style-normalized | (unknown) |
| `cloak-and-dagger-s1` | cloak-and-dagger | Veil of Sky | passive | C — guide, style-normalized | (unknown) |
| `cloak-and-dagger-s2` | cloak-and-dagger | Entangled Light and Darkness | passive | C — guide, style-normalized | (unknown) |
| `invisible-woman-s1` | invisible-woman | Best Guardian | passive | C — guide, style-normalized | (unknown) |
| `invisible-woman-s2` | invisible-woman | Greater Psionic Vortex | passive | C — guide, style-normalized | (unknown) |
| `jeff-the-land-shark-s1` | jeff-the-land-shark | Looting Leviathan | passive | C — guide + **plan** rarity table | (unknown) |
| `jeff-the-land-shark-s2` | jeff-the-land-shark | Split Water Columns | passive | C — guide, style-normalized | (unknown) |
| `loki-s1` | loki | Final Illusion | passive | C — guide, style-normalized | (unknown) |
| `loki-s2` | loki | Loki's Sanctuary | passive | **A — screenshot verbatim** | `LSHIFT` |
| `luna-snow-s1` | luna-snow | Ice Shards Therapy | passive | C — guide, style-normalized | (unknown) |
| `luna-snow-s2` | luna-snow | Applause | passive | C — guide, style-normalized | (unknown) |
| `mantis-s1` | mantis | Natural Protection | passive | C — guide, style-normalized | (unknown) |
| `mantis-s2` | mantis | Floral Flourish | passive | C — guide, style-normalized | (unknown) |
| `rocket-raccoon-s1` | rocket-raccoon | Full-Time Medic | passive | C — guide, style-normalized | (unknown) |
| `rocket-raccoon-s2` | rocket-raccoon | B.R.B.A.S.A.P. | passive | C — guide, style-normalized | (unknown) |
| `ultron-s1` | ultron | Software Update | passive | C — guide, style-normalized | (unknown) |
| `ultron-s2` | ultron | One for All | onUlt | C — guide, style-normalized | (unknown) |

---

## Strengthen Module implementations (approximations)

M5 scoped ultimates to six authored archetypes and models **no discrete
non-ult abilities and no cooldowns**. So **every one of the 76 implemented
modules is an approximation** — the closest faithful analogue the sim can
express — and each spec in `src/sim/strengthen.ts` carries an `approximation`
string naming the real mechanic and the substitute (`tests/strengthen.spec.ts`
asserts none is null and none is a no-op).

The substitution rules, by pattern:

| Real mechanic (from the effect text) | Sim substitute |
|---|---|
| "increase X fire rate / attack frequency / magazine / extra projectiles / more bounces" (on the primary) | `+% primary DPS` (± `+% attack speed` for the cadence flavour) |
| "reduce cooldown of a damage ability" / "more frequent damage zone / summons" | `+% primary DPS` (more uptime ≈ more damage) |
| "reduce cooldown of a heal ability" / "extra heal columns / splash / clones" | `+% healing output` |
| "shield / wall / damage-absorb / self-heal-on-cast" | `−% damage taken` and/or `+bonus health` / `+% max health` |
| "lifesteal / restore health on hit / Healing Factor" | `+lifesteal %` |
| "Ultimate Ability: +damage / +range / +duration / during <ult>" | an **`onUlt`** timed self-buff opened on the cast (`+% damage`, `+% attack speed`, or `−% damage taken`) — 17 modules |
| per-KO / per-victory / per-final-hit escalation (Iron Man *Last Stand*, Winter Soldier *Here We Go Again*, Black Widow *Sniper Elite*) | a flat "one-trigger's-worth" bonus, folded passively; the escalation itself is not modelled |
| CC (stun / root / ensnare / Unstoppable / knockback / gravity pull) | not modelled — folded into a small `+% DPS` or `−% damage taken` instead |
| Jeff *Looting Leviathan* (grants Base Modules on a devour) | see below — the grant path is real and isolated; the in-battle stand-in is `+15% ult charge + 6% healing output` |

The magnitudes are **authored, deliberately modest, and untuned** (the real
Rivals numbers behind these abilities are not canonical — plan ledger). M11
tunes; see the "possible M11 balance concerns" list in the M10 report.

### Jeff the Land Shark — *Looting Leviathan* (the special case)

`jeff-the-land-shark-s1` grants Base Modules on **its own rarity table**, keyed
by how many enemies Jeff's ultimate devoured, and **bypasses the derived shop
odds formula entirely**:

| Devoured | Common | Rare | Legendary (game: "Epic") |
|---:|---:|---:|---:|
| 4 | 90% | 8% | 2% |
| 5 | 60% | 30% | 10% |
| 6+ | 0% | 70% | 30% |

This table is **plan-supplied** (the M10 milestone text — the only Strengthen
numeric data the plan provides) and used exactly as written. It lives in
`src/data/constants.ts` → `LOOTING_LEVIATHAN_RARITY_TABLE`; the grant path is
`src/sim/modules.ts` → `lootingLeviathanRarityOdds` / `rollLootingLeviathanRarity`
/ `grantLootingLeviathanModules`. That path **never calls `modules.rarityOdds`**
and **never touches a shop draw**, and its 100 000-roll test
(`tests/strengthen.spec.ts`) draws from a dedicated named substream
(`stream('looting-leviathan', …)`) so it cannot shift any other consumer's rolls.
Combat cannot grant modules mid-battle, so in a running battle the module's
stand-in is a small ult-charge + healing nudge; the loot grant is a data path
for a future milestone to fire from the ult-devour count.
