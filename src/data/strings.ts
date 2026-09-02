/*
 * Every visible in-game string, verbatim.
 *
 * Sources: the plan's "Appendix — verbatim in-game strings" and its "UI
 * Specification" section (the UI section carries strings the Appendix omits —
 * `Owned Modules:`, the XP legend, `REFRESH 1/1`, the scoreboard columns, the
 * key hints). Casing, punctuation and grammar are preserved exactly, including
 * known quirks:
 *   - `Select 1 Strengthen Modules` — "Modules" stays plural at n = 1 (sic),
 *     confirmed by UBMP_STRENGTHEN_MODULE_PURCHASE_SCREEN.png (1305×734).
 *   - LOCKED_MODULES_FOOTER has NO trailing period.
 *   - PURCHASED_MODULES_TOOLTIP has exactly one trailing period.
 *   - SWAP_CONVERSION_FOOTNOTE keeps its leading `*`.
 *
 * Parameterized strings are functions, never baked constants. Every export here
 * is snapshot-tested so an accidental edit to canonical text fails loudly.
 *
 * Data files import nothing from `ui/` or `render/`.
 */

/** Role as shown in UI copy (title case), distinct from the lowercase `Role` id. */
export type DisplayRole = 'Vanguard' | 'Duelist' | 'Strategist';

/** `Role` id → the title-case name UI copy uses. Source: the plan's roster table. */
export const ROLE_DISPLAY_NAME: Readonly<Record<'vanguard' | 'duelist' | 'strategist', DisplayRole>> = {
  vanguard: 'Vanguard',
  duelist: 'Duelist',
  strategist: 'Strategist',
};

/**
 * `Protocol` id → the proper noun the UI shows (`Protocol: Fortress`, the
 * left-rail tooltip, the info-pane header). Source: the plan's "Protocol level
 * bonuses" table and the "Colour tokens" table.
 */
export const PROTOCOL_DISPLAY_NAME: Readonly<
  Record<'fortress' | 'onslaught' | 'reboot' | 'equilibrium', string>
> = {
  fortress: 'Fortress',
  onslaught: 'Onslaught',
  reboot: 'Reboot',
  equilibrium: 'Equilibrium',
};

/**
 * Short labels for the numeric keys in `PROTOCOL_TIER_BONUSES`, used only by the
 * info-pane tier rows. Source: the plan's "Protocol level bonuses" table wording
 * plus the two info-pane screenshots ("Maximum Health", "Healing Amount").
 */
export const STAT_LABEL: Readonly<Record<string, string>> = {
  maxHealth: 'Max Health',
  damagePct: 'Damage Output',
  healingPct: 'Healing Amount',
  maxHealthPerUniqueRole: 'Max Health / unique role',
  damageAndHealingPctPerUniqueRole: 'Damage & Healing / unique role',
};

// ---------------------------------------------------------------------------
// Mode identity / Draft
// ---------------------------------------------------------------------------

export const MODE_TITLE = "ULTRON'S BATTLE MATRIX PROTOCOL";

export const TAGLINE =
  'Harness your superior intellect! Seek out the perfect solution within the simulation and eradicate all rival subprocesses.';

export const ASSEMBLE_YOUR_TEAM = 'Assemble Your Team';

/** `LINEUP (0/6)` … `LINEUP (6/6)`. */
export const lineup = (n: number): string => `LINEUP (${n}/6)`;

// ---------------------------------------------------------------------------
// Round / phase chrome
// ---------------------------------------------------------------------------

export const PRACTICE_PROTOCOL = 'PRACTICE PROTOCOL';
export const BATTLE_PROTOCOL = 'BATTLE PROTOCOL';
export const PRACTICE_PROTOCOL_REWARD_PHASE = 'PRACTICE PROTOCOL REWARD PHASE';
export const SELECT_REWARD = 'SELECT REWARD';
export const SELECT_POSITION = 'Select Position';
export const WAITING_FOR_OTHERS = 'Waiting for Others';
export const SELECT_MODULES_HEADER = 'Select the Modules you wish to purchase';

/** HUD round-phase indicator: `1-1`, `9-3`, `18-1`. */
export const roundPhase = (round: number, phase: number): string => `${round}-${phase}`;

/** Round-start banner: `ROUND 1 - PRACTICE PROTOCOL`, `ROUND 2 - BATTLE PROTOCOL`. */
export const roundBanner = (round: number, typeLabel: string): string =>
  `ROUND ${round} - ${typeLabel}`;

// ---------------------------------------------------------------------------
// Module Draw / shop
// ---------------------------------------------------------------------------

export const TAB_SELECT = 'SELECT';
export const TAB_ACTIVATED = 'ACTIVATED';
export const TAB_CHANGE_HERO = 'CHANGE HERO';

export const BTN_PURCHASE = 'PURCHASE';
export const BTN_UPGRADE = 'UPGRADE';
export const BTN_REFRESH = 'REFRESH';
export const BTN_LOCK = 'LOCK';
export const BTN_UNLOCK = 'UNLOCK';
export const BTN_SELECT = 'SELECT';
export const BTN_CONFIRM = 'CONFIRM';
export const BTN_CANCEL = 'CANCEL';
/** Select Position primary button. Screenshot: `EXIT EDITING` / `DEPLOY`. (`B DEPLOY` is the key hint.) */
export const BTN_DEPLOY = 'DEPLOY';

/** Shop footer under a locked card. NO trailing period (verbatim). */
export const LOCKED_MODULES_FOOTER =
  'Locked modules will not be refreshed in the next round';

/** Delayed-effect tooltip. Exactly one trailing period (verbatim). */
export const PURCHASED_MODULES_TOOLTIP =
  'The effects of purchased modules take effect in the next round.';

export const TOKEN_SYMBOL = '◇';

/** Token cost badge: `◇5`, `◇1`. */
export const diamondCost = (n: number): string => `${TOKEN_SYMBOL}${n}`;

/** Token counter with live income preview: `10 (+16)`. */
export const incomePreview = (tokens: number, preview: number): string =>
  `${tokens} (+${preview})`;

// ---------------------------------------------------------------------------
// Change Hero / Swap-out
// ---------------------------------------------------------------------------

export const CHOOSE_VANGUARD = 'CHOOSE VANGUARD';
export const CHOOSE_DUELIST = 'CHOOSE DUELIST';
export const CHOOSE_STRATEGIST = 'CHOOSE STRATEGIST';

/** Role card title: `CHOOSE VANGUARD` / `CHOOSE DUELIST` / `CHOOSE STRATEGIST`. */
export const chooseRoleCardTitle = (role: DisplayRole): string =>
  `CHOOSE ${role.toUpperCase()}`;

/**
 * Role card body: `Choose One of 3 Random Vanguards to Replace a Current Hero`.
 * Confirmed against UBMP_CHANGE_HERO_PURCHASE_OPTION_SCREEN.png (1303×735).
 */
export const chooseOneOfRandom = (n: number, role: DisplayRole): string =>
  `Choose One of ${n} Random ${role}s to Replace a Current Hero`;

export const SELECT_HERO_TO_SWAP_OUT = 'SELECT HERO TO SWAP OUT';

export const HEROES_SWAPPED_SUBTITLE =
  'HEROES SWAPPED IN THIS PHASE WILL TAKE EFFECT IN THE NEXT ROUND.';

export const RESERVE_HEROES = 'RESERVE HEROES';
export const ACTIVE_HEROES = 'ACTIVE HEROES';

/** Swap-out footnote. Keeps its leading `*`; one trailing period (verbatim). */
export const SWAP_CONVERSION_FOOTNOTE =
  '*When a hero is swapped, any equipped Strengthen Modules will be converted to matching usable modules.';

// ---------------------------------------------------------------------------
// Reward phase
// ---------------------------------------------------------------------------

/**
 * Reward-phase instruction. `Select 1 Strengthen Modules` verbatim — "Modules"
 * stays plural at n = 1 (sic). The `❗` shown beside it in-game is an icon, not
 * part of the string.
 */
export const selectNStrengthen = (n: number): string =>
  `Select ${n} Strengthen Modules`;

/** Reward-phase refresh button: one free refresh. */
export const REFRESH_1_1 = 'REFRESH 1/1';

// ---------------------------------------------------------------------------
// Left rail / Protocol info pane
// ---------------------------------------------------------------------------

export const OWNED_MODULES = 'Owned Modules:';

/**
 * Star-tier XP legend, from the UI Specification section. The plan states this
 * twice and they differ — line 53 `★=XP+1 ★=XP+2 ★=XP+4` (no spaces/separators)
 * vs the UI-spec form used here. UBMP_LEFTSIDE_ICON_CLICK_INFO_PANE_EXAMPLE.png
 * (1309×732) renders three separate pills with spaces around `=` and no literal
 * middot; `XP_LEGEND_PARTS` is the render-ready split, `XP_LEGEND` the joined
 * documentation form.
 */
export const XP_LEGEND_PARTS = ['★ = XP+1', '★ = XP+2', '★ = XP+4'] as const;
export const XP_LEGEND = XP_LEGEND_PARTS.join(' · ');

/** Info-pane header: `Protocol: Fortress`, `Protocol: Reboot`. */
export const protocolPaneTitle = (protocolName: string): string =>
  `Protocol: ${protocolName}`;

/** Left-rail XP meter: `16/20`, `23/40`. */
export const xpMeter = (xp: number, threshold: number): string => `${xp}/${threshold}`;

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

export const COL_RANK = 'Rank';
export const COL_PLAYER_NAME = 'Player Name';
export const COL_DEPLOY = 'Deploy';
export const COL_INITIATE_PROTOCOL = 'Initiate Protocol';

/** Health cell for an eliminated (phantom) player. */
export const OUT_OF_PLAY = 'Out of Play';

/**
 * Final-standings screen title (screen 9). No screenshot exists for this screen;
 * the plan says keep it "consistent with the scoreboard's language", so this is
 * authored to match the scoreboard's `Rank` framing.
 */
export const FINAL_STANDINGS = 'FINAL STANDINGS';

// ---------------------------------------------------------------------------
// Contextual key hints
// ---------------------------------------------------------------------------

export const HINT_TAB_SCOREBOARD = 'TAB SCOREBOARD';
export const HINT_ESC_MENU = 'ESC MENU';
export const HINT_ESC_BACK = 'ESC BACK';
export const HINT_B_DEPLOY = 'B DEPLOY';
export const HINT_B_MODULES = 'B MODULES';
export const HINT_EXIT_EDITING = 'EXIT EDITING';
export const HINT_LALT_CURSOR_MODE = 'LALT CURSOR MODE';
export const HINT_ENTER_CHAT = 'ENTER CHAT';

// ---------------------------------------------------------------------------
// Battle / arena
// ---------------------------------------------------------------------------

/**
 * The map the battle (and the Ultron Drone) plays over. Also mirrored in
 * `constants.ts` as `ARENA_MAP`; `data.spec.ts` asserts the two stay in sync.
 */
export const ARENA_MAP_NAME = 'Age of Ultron: Digital Duel Grounds';

// ---------------------------------------------------------------------------
// Battle HUD (M9) — the renderer overlay
// ---------------------------------------------------------------------------

/**
 * The Speed Up Protocol on-screen announcement. No screenshot captures the exact
 * announcement copy (the wiki only names the stage), so this is AUTHORED to
 * match the mode's heading voice and the phase-strip label — noted in the M9
 * report.
 */
export const SPEED_UP_PROTOCOL = 'SPEED UP PROTOCOL';

/** Keycap glyphs for the two one-time drone abilities and the infinite-ammo beam. */
export const KEY_LSHIFT = 'LSHIFT';
export const KEY_E = 'E';
export const INFINITE_AMMO = '∞';

/** The three drone abilities, named per the plan's "Ultron Drone" table. */
export const DRONE_ABILITY_ENCEPHALO_RAY = 'Encephalo-Ray';
export const DRONE_ABILITY_ONE_TIME_DAMAGE = 'One-Time Damage';
export const DRONE_ABILITY_ONE_TIME_HEALING = 'One-Time Healing';

/**
 * Kill-feed weapon labels, keyed by M5's `DamageSource` union values
 * (`primary` / `ability` / `ultimate` / `module` / `drone`). Rendered between
 * the killer and victim names as `KILLER  ⟶  weapon  ⟶  VICTIM`.
 */
export const KILL_FEED_WEAPON: Readonly<Record<string, string>> = {
  primary: 'Primary',
  ability: 'Ability',
  ultimate: 'Ultimate',
  module: 'Module',
  drone: 'Ultron Drone',
};

/** The arrow drawn on either side of the kill-feed weapon label. */
export const KILL_FEED_ARROW = '⟶';

/** Centred battle hint under the health bar: `LALT CURSOR MODE / B MODULES`. */
export const battleHint = (): string => `${HINT_LALT_CURSOR_MODE} / ${HINT_B_MODULES}`;

/** LALT toggles between pointer-drives-drone and pointer-free-for-UI (2D adaptation of the original's mouse-look release). */
export const CURSOR_MODE_ON = 'CURSOR MODE';
export const CURSOR_MODE_OFF = 'DRONE CONTROL';

/**
 * The canvas font family stack for the battle renderer — the same faces as CSS
 * `--bm-font`, kept here (not `src/render/`) so the string-enforcement grep over
 * `src/render/**` never trips on a bare `'Roboto Condensed', …` literal.
 */
export const FONT_FAMILY_STACK =
  "'Roboto Condensed', 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif";

/** Compose a Canvas2D `font` value: `battleFont('800 italic 16px')`. */
export const battleFont = (sizeAndStyle: string): string => `${sizeAndStyle} ${FONT_FAMILY_STACK}`;
