/*
 * Typed shapes for the canonical JSON data files (`heroes.json`, `modules.json`,
 * `strengthen.json`). Types and enums only — no values, no imports. The JSON files
 * are the source of truth; `validate.ts` proves at test time that they conform to
 * the shapes declared here.
 */

// ---------------------------------------------------------------------------
// Heroes
// ---------------------------------------------------------------------------

export type Role = 'vanguard' | 'duelist' | 'strategist';

/**
 * Targeting priority, transcribed from the N / L / H marks on each roster entry
 * in the plan's "Hero roster" table.
 *   nearest          — N — closest enemy unit
 *   lowestMaxHealth   — L — enemy with the lowest resolved max health
 *   highestMaxHealth  — H — enemy with the highest resolved max health
 */
export type Targeting = 'nearest' | 'lowestMaxHealth' | 'highestMaxHealth';

/**
 * How a hero's `attackRange` is interpreted, so the M1 range bands stay checkable:
 *   melee  — Vanguard 3–8, Duelist exactly 5
 *   ranged — Vanguard 12–18, Duelist 20–34, Strategist 16–22
 *   sniper — Duelist 20–34 (long end), lower DPS than a ranged/melee Duelist
 */
export type AttackType = 'melee' | 'ranged' | 'sniper';

/**
 * AUTHORED per-hero combat stats. These live in `heroes.json` (not `authored.ts`)
 * by the deliberate exception recorded in `authored.ts` → AUTHORED_ELSEWHERE.
 *
 * UNIT CONVENTION: `attackRange` and `moveSpeed` are **arena units**, not board
 * cells. A Duelist sniper range of 20–34 cannot be cells on a 6×4 grid; M5 maps
 * the grid into arena space. `dps` is the authored steady-state figure and
 * `attackSpeed` is hits per second, so per-hit damage = `dps / attackSpeed`
 * (derived in M5). M11 tunes every number here against the M7 win-rate gate.
 */
export interface HeroCombat {
  /** Authored steady-state damage per second, before any module or protocol bonus. */
  readonly dps: number;
  /** Authored sustained healing per second (Strategists only). */
  readonly healPerSecond?: number;
  readonly attackType: AttackType;
  /** Arena units. Band depends on role + attackType — see AttackType. */
  readonly attackRange: number;
  /** Attacks per second. */
  readonly attackSpeed: number;
  /** Arena units per second. Vanguard 3.0 · Duelist 3.6–4.4 · Strategist 3.4. */
  readonly moveSpeed: number;
}

/**
 * The six authored ultimate archetypes (M5). 39 bespoke ultimates are out of
 * scope — every hero maps (in `heroes.json`) to one archetype whose baseline
 * magnitudes live in `authored.ts` → `ULT_ARCHETYPES`. Per-hero flavour and
 * tuning is M11 polish. See `src/sim/abilities.ts` for the registry.
 *   singleTargetBurst     — one large hit to the caster's current target
 *   aoeBurst              — a burst to every enemy within a radius
 *   sustainedBeam         — a timed self damage-amplifier
 *   teamHealBurst         — a large instant heal to every ally
 *   shieldDamageReduction — a timed damage-taken reduction for every ally
 *   selfBuff             — a timed self damage + attack-speed buff
 */
export type UltArchetype =
  | 'singleTargetBurst'
  | 'aoeBurst'
  | 'sustainedBeam'
  | 'teamHealBurst'
  | 'shieldDamageReduction'
  | 'selfBuff';

/** AUTHORED per-hero ultimate mapping. Lives in `heroes.json` by the same ledger exception as `combat`. */
export interface HeroUlt {
  readonly archetype: UltArchetype;
}

export interface Hero {
  /** kebab-case, unique. `id === slugify(name)` — see `validate.ts` → slugify. */
  readonly id: string;
  /** Roster wording, verbatim (e.g. "The Thing", "Cloak & Dagger", "Star-Lord"). */
  readonly name: string;
  readonly role: Role;
  /** CANONICAL. Wiki infobox value, transcribed from the plan's roster table. */
  readonly baseHealth: number;
  readonly targeting: Targeting;
  readonly combat: HeroCombat;
  /** AUTHORED ultimate archetype mapping (M5). */
  readonly ult: HeroUlt;
  /** Free-text note where the source carries an oddity (e.g. Hulk's 200/700 split). */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Base Modules
// ---------------------------------------------------------------------------

export type Rarity = 'common' | 'rare' | 'legendary';

export type Protocol = 'fortress' | 'onslaught' | 'reboot' | 'equilibrium';

/**
 * How a module's per-level `values[]` entry scales when resolved onto a lineup:
 *   flat          — used as-is on every qualifying unit (e.g. "Vanguard max health +90")
 *   perRoleUnit   — multiplied by the count of the protocol's role units fielded
 *                   (e.g. "per Vanguard, enemy max health −1%")
 *   perUniqueRole — multiplied by the number of unique roles in the lineup, 1..3
 *                   (every non-legendary Equilibrium module)
 */
export type ModuleScope = 'flat' | 'perRoleUnit' | 'perUniqueRole';

/** Who the effect lands on. `enemy` for the Suppression / Interference / Mark lines. */
export type ModuleTarget = 'ally' | 'enemy';

/**
 * Machine-readable stat key for M4's stat resolver. `behavioural` marks a
 * Legendary whose effect is dispatched by `effectId`, not by a numeric `values[]`.
 */
export type ModuleStat =
  | 'attackSpeed'
  | 'damage'
  | 'healing'
  | 'damageAndHealing'
  | 'maxHealth'
  | 'damageTaken'
  | 'ultCharge'
  | 'lifesteal'
  | 'lostHealthRegen'
  | 'lastStandDamage'
  | 'vulnerability'
  | 'overflowToBonusHealth'
  | 'healingAsDamage'
  | 'bonusHealthAtRoundStart'
  | 'ultEnergyAtRoundStart'
  | 'enemyMaxHealth'
  | 'enemyDamageOutput'
  | 'enemyHealing'
  | 'behavioural';

export interface BaseModule {
  /** `${protocol}-${slugify(name)}`. Namespaced because names recur across protocols. */
  readonly id: string;
  readonly protocol: Protocol;
  readonly rarity: Rarity;
  /** Verbatim display name (e.g. "Initial Healing Boost", not "Initial Healing Enhancement"). */
  readonly name: string;
  readonly stat: ModuleStat;
  readonly scope: ModuleScope;
  readonly target: ModuleTarget;
  /**
   * Number of upgrade levels === `values.length`. Common 6 / Rare 3 / Legendary 1,
   * **except** Fortress "Damage Enhancement" which the source ships with only 4
   * (see `quirk`).
   */
  readonly levels: number;
  /**
   * Per-level cumulative table values, transcribed digit-for-digit from the plan's
   * four protocol sections. The 6th Common entry is a source-authored jump, never
   * the next arithmetic step. Legendary modules carry the placeholder `[1]`.
   */
  readonly values: readonly number[];
  /** Display template using `{value}` (the level-appropriate table entry). */
  readonly effect: string;
  /** Stable dispatch key for M4/M5. Legendary modules only. */
  readonly effectId?: string;
  /** Note recording a known source quirk (asserted, not silently normalized). */
  readonly quirk?: string;
  /**
   * Best-effort transcription of the exact in-game shop-card text (level-1 value
   * baked in) from `observedIn`. Pending high-DPI verification in M8.
   */
  readonly observedShopText?: string;
  /**
   * Best-effort transcription of the exact Owned-Modules-pane text (cumulative
   * value at the owned star level baked in) from `observedIn`. M4 consumes the
   * cumulative-value display rule; captured here where a screenshot shows it.
   */
  readonly observedOwnedText?: string;
  /** Screenshot file(s) backing `observedShopText` / `observedOwnedText`. */
  readonly observedIn?: string;
}

// ---------------------------------------------------------------------------
// Strengthen Modules — M1 skeleton only
// ---------------------------------------------------------------------------

/**
 * One of a hero's two Strengthen Module slots. In M1 every row carries only
 * `id` / `heroId` / `slot`; `name` / `effect` / `keybind` are deliberately empty
 * placeholders. Canonical names, effect text and keybinds are M10 work sourced
 * from the wiki and screenshots — they are NOT in this plan and must not be
 * invented here. See `authored.ts` → STRENGTHEN_JSON_IS_SKELETON.
 */
export interface StrengthenModuleSkeleton {
  /** `${heroId}-s${slot}`, unique. */
  readonly id: string;
  readonly heroId: string;
  readonly slot: 1 | 2;
  /** Empty in M1. Filled in M10. */
  readonly name: string;
  /** Empty in M1. Filled in M10. */
  readonly effect: string;
  /** Empty in M1. Filled in M10 (e.g. "LSHIFT"). */
  readonly keybind: string;
}

// ---------------------------------------------------------------------------
// Galacta Bots — M6 (the Practice Protocol PvE opponent)
// ---------------------------------------------------------------------------

/**
 * One Galacta Bot archetype. AUTHORED (M6), stored in `galacta.json` by the same
 * ledger exception as hero `combat` stats — see `authored.ts` →
 * `AUTHORED_ELSEWHERE.galactaWaves`. Galacta Bots are team-agnostic `Unit`s in
 * the sim: no protocols, no modules. `role` is a NOMINAL deploy role used only
 * for formation placement and unique-role counting.
 */
export interface GalactaArchetype {
  /** kebab-case, unique, e.g. "galacta-swarm" — also the M9 monster-art key. */
  readonly id: string;
  readonly role: Role;
  readonly baseHealth: number;
  readonly targeting: Targeting;
  readonly ult: HeroUlt;
  readonly combat: HeroCombat;
}

/** How many of each archetype a Practice round fields, before per-round scaling. */
export interface GalactaWaveSpec {
  /** The Practice round this composition is the base for (1 / 6 / 11 / 16 / 21). */
  readonly round: number;
  /** archetype id → count (positive integer). */
  readonly units: Readonly<Record<string, number>>;
}

export interface GalactaData {
  readonly archetypes: readonly GalactaArchetype[];
  readonly waves: readonly GalactaWaveSpec[];
}

// ---------------------------------------------------------------------------
// validate.ts
// ---------------------------------------------------------------------------

export interface Problem {
  /** Stable, greppable code (e.g. "heroes/role-count"). */
  readonly code: string;
  readonly message: string;
}
