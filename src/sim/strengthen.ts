/*
 * M10 — Strengthen Module registry + combat wiring.
 *
 * `strengthen.json` holds one row per module (id / heroId / slot / name / effect
 * / keybind). This file gives every SOURCED module a runnable combat
 * implementation and a deterministic "it does something" scenario descriptor.
 *
 * M5 scoped ultimates to six authored archetypes and models no discrete
 * non-ult abilities or cooldowns, so essentially every Strengthen effect
 * references a mechanic this 2D sim does not model literally. Each spec therefore
 * carries an `approximation` string (never null) stating the real Rivals
 * mechanic and the closest faithful analogue substituted — e.g. Hawkeye's
 * *One Shot, Four Down* (3 extra Blast Arrows on Piercing Arrow) becomes a flat
 * +% to primary DPS at a documented fraction. `docs/FIDELITY.md` surfaces all of
 * them.
 *
 * Two implementation kinds, both non-stub:
 *   - `passive`  — folded into the owner's `ResolvedUnit` at battle build
 *     (`applyPassiveStrengthen`), applied for the whole battle.
 *   - `onUlt`    — a timed self-buff window opened when the owner casts its
 *     ultimate (`unitStrengthenUlt` + `combat.ts` `maybeCastUlt` / the damage
 *     and attack-cadence functions). This is the faithful reading of the many
 *     modules whose text says "Ultimate Ability" / "During <ult>".
 *
 * Two rows could not be sourced (`STRENGTHEN_SOURCING_GAPS`); they keep the
 * empty skeleton strings and have no spec. Everything else is registered, and
 * `stubStrengthenHandlers()` proves no registered spec is a no-op.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { TICK_RATE_HZ } from '../data/constants';
import heroesJson from '../data/heroes.json';
import strengthenJson from '../data/strengthen.json';
import type { AttackType, StrengthenModuleSkeleton } from '../data/types';

import type { ResolvedUnit } from './stats';

// ---------------------------------------------------------------------------
// Data rows (name / effect / keybind — the canonical text)
// ---------------------------------------------------------------------------

export const STRENGTHEN_ROWS = strengthenJson as unknown as readonly StrengthenModuleSkeleton[];
const ROW_BY_ID = new Map<string, StrengthenModuleSkeleton>(STRENGTHEN_ROWS.map((r) => [r.id, r]));

export function strengthenRow(id: string): StrengthenModuleSkeleton {
  const r = ROW_BY_ID.get(id);
  if (r === undefined) throw new RangeError(`strengthenRow(): unknown Strengthen id "${id}"`);
  return r;
}

export function strengthenModuleName(id: string): string {
  return strengthenRow(id).name;
}
export function strengthenModuleEffect(id: string): string {
  return strengthenRow(id).effect;
}
export function strengthenModuleKeybind(id: string): string {
  return strengthenRow(id).keybind;
}

/** All 78 Strengthen ids, sorted. */
export function allStrengthenIds(): string[] {
  return STRENGTHEN_ROWS.map((r) => r.id).sort();
}

/**
 * Rows M10 could NOT source — Emma Frost's two modules were absent from every
 * reachable source (the wiki and mobalytics return 402/403 to the fetcher; the
 * one complete guide omits her). They keep the empty skeleton strings, have no
 * registered spec, and are excluded from the completeness net. See the report
 * and `docs/FIDELITY.md`.
 */
export const STRENGTHEN_SOURCING_GAPS: readonly string[] = ['emma-frost-s1', 'emma-frost-s2'];

// ---------------------------------------------------------------------------
// Hero lookup (owner attack type → harness spawn geometry)
// ---------------------------------------------------------------------------

interface HeroLite {
  readonly id: string;
  readonly combat: { readonly attackType: AttackType };
}
const HERO_BY_ID = new Map<string, HeroLite>(
  (heroesJson as unknown as readonly HeroLite[]).map((h) => [h.id, h]),
);
function isMelee(heroId: string): boolean {
  return HERO_BY_ID.get(heroId)?.combat.attackType === 'melee';
}

// ---------------------------------------------------------------------------
// Mod vocabulary — every field maps to a `ResolvedUnit` transform
// ---------------------------------------------------------------------------

/** Passive stat deltas. `*Pct` compose multiplicatively; `*Add` are additive. */
export interface StrengthenMods {
  /** `dps *= 1 + x/100` — "increase fire rate / attack frequency / extra projectiles / bounces". */
  readonly dpsPct?: number;
  /** `attackSpeed *= 1 + x/100`. */
  readonly attackSpeedPct?: number;
  /** `healPerSecond *= 1 + x/100` — "increase healing / extra heal / reduce heal cooldown". */
  readonly healPct?: number;
  /** `maxHealth += x`. */
  readonly maxHealthAdd?: number;
  /** `maxHealth *= 1 + x/100`. */
  readonly maxHealthPct?: number;
  /** `bonusHealth += x` (the overhealth pool, depleted first). */
  readonly bonusHealthAdd?: number;
  /** `damageTakenMultiplier *= 1 - x/100` — shields / walls / absorption. */
  readonly damageTakenPct?: number;
  /** `lifestealPct += x`. */
  readonly lifestealPctAdd?: number;
  /** `ultChargeRate *= 1 + x/100` — "reduce ultimate cooldown / gain ult energy". */
  readonly ultChargePct?: number;
  /** `moveSpeed *= 1 + x/100` — "reduce dash / leap cooldown". */
  readonly moveSpeedPct?: number;
  /** `ultEnergyAtRoundStartPct += x`. */
  readonly ultEnergyAtRoundStartPctAdd?: number;
  /** `roundStartDamagePct += x`. */
  readonly roundStartDamagePctAdd?: number;
  /** `roundStartHealingPct += x`. */
  readonly roundStartHealingPctAdd?: number;
  /** `vulnerabilityOnHitPct += x` — reuses the Base Module Vulnerability Mark path. */
  readonly vulnerabilityOnHitPctAdd?: number;
}

/** A timed self-buff opened when the owner casts its ultimate. */
export interface StrengthenUltWindow {
  readonly durationSeconds: number;
  /** +% own damage during the window. */
  readonly damagePct?: number;
  /** +% own attack speed during the window. */
  readonly attackSpeedPct?: number;
  /** -% damage taken during the window. */
  readonly damageTakenPct?: number;
}

// ---------------------------------------------------------------------------
// Scenario descriptor — what the harness forces so the module can fire
// ---------------------------------------------------------------------------

export type StrengthenMeasure =
  | 'ownerDamageDealt'
  | 'ownerDamageTaken'
  | 'ownerHealthRemaining'
  | 'allyHealthRemaining'
  | 'ticksToResolve';

export interface StrengthenScenario {
  /** Side A — the module owner is always index 0 (dense unit id 0). */
  readonly lineupA: readonly string[];
  readonly lineupB: readonly string[];
  /** Tie cap; picked so neither run resolves by elimination (a clean same-window compare). */
  readonly battleTicks: number;
  /** Owner↔enemy spawn gap along the deploy axis (arena units). */
  readonly spawnGap: number;
  /** Prime the owner's ult (`ultEnergy = 1`) so it fires on tick 1. */
  readonly primeUlt: boolean;
  /** Owner (id 0) starts at this fraction of resolved max health. */
  readonly ownerHealthFraction: number;
  /** Ally (id 1), when present, starts at this fraction. */
  readonly allyHealthFraction: number;
  /** Park side-B units beyond the first far back — keeps side B alive and out of the fight. */
  readonly parkBackUnits: boolean;
  readonly measure: StrengthenMeasure;
  readonly expect: 'increase' | 'decrease';
  readonly seed: number;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface StrengthenSpec {
  readonly moduleId: string;
  readonly heroId: string;
  /** One line: what this module does in the sim. */
  readonly summary: string;
  /** The real Rivals mechanic vs the faithful analogue substituted. Never null. */
  readonly approximation: string;
  readonly trigger: 'passive' | 'onUlt';
  readonly passive?: StrengthenMods;
  readonly ultWindow?: StrengthenUltWindow;
  readonly scenario: StrengthenScenario;
}

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

function gapFor(owner: string): number {
  return isMelee(owner) ? 7 : 22;
}

/** Owner pours damage into a 700-HP wall it cannot kill in the window. */
function offScenario(owner: string, seed: number): StrengthenScenario {
  return {
    lineupA: [owner],
    lineupB: ['the-thing'],
    battleTicks: 90,
    spawnGap: gapFor(owner),
    primeUlt: false,
    ownerHealthFraction: 1,
    allyHealthFraction: 1,
    parkBackUnits: false,
    measure: 'ownerDamageDealt',
    expect: 'increase',
    seed,
  };
}

/** Owner (a bruiser) soaks a low-DPS chipper; a parked wall keeps side B alive. */
function tankScenario(owner: string, seed: number): StrengthenScenario {
  return {
    lineupA: [owner],
    lineupB: ['doctor-strange', 'the-thing'],
    battleTicks: 100,
    spawnGap: 24,
    primeUlt: false,
    ownerHealthFraction: 1,
    allyHealthFraction: 1,
    parkBackUnits: true,
    measure: 'ownerHealthRemaining',
    expect: 'increase',
    seed,
  };
}

/** Owner (a healer) mends a wounded ally; the sole enemy is parked far — pure output test. */
function healScenario(owner: string, seed: number): StrengthenScenario {
  return {
    lineupA: [owner, 'the-thing'],
    lineupB: ['groot'],
    battleTicks: 120,
    spawnGap: 60,
    primeUlt: false,
    ownerHealthFraction: 1,
    allyHealthFraction: 0.35,
    parkBackUnits: false,
    measure: 'allyHealthRemaining',
    expect: 'increase',
    seed,
  };
}

/**
 * Ult primed on tick 1 (its burst is identical with/without — the window opens
 * afterwards). The owner then pours buffed primaries into a deep bench of tanks
 * it cannot exhaust; a melee owner dies at the same tick either way, so the
 * accumulated-damage compare stays fair.
 */
const ULT_OFF_WALL: readonly string[] = [
  'the-thing',
  'groot',
  'hulk',
  'venom',
  'magneto',
  'peni-parker',
  'captain-america',
  'thor',
  'the-punisher',
  'black-widow',
];
function ultOffScenario(owner: string, seed: number): StrengthenScenario {
  return {
    lineupA: [owner],
    lineupB: ULT_OFF_WALL,
    battleTicks: 130,
    spawnGap: isMelee(owner) ? 4 : 22,
    primeUlt: true,
    ownerHealthFraction: 1,
    allyHealthFraction: 1,
    parkBackUnits: false,
    measure: 'ownerDamageDealt',
    expect: 'increase',
    seed,
  };
}

/**
 * Ult primed on tick 1 (its burst, if any, is identical with/without). A 700-HP
 * melee tank then chips the owner while the -damage-taken buff is live. We
 * measure incoming damage directly — the cleanest read of a pure damage-
 * reduction buff — so it works for a `teamHealBurst` owner (no ult damage) and
 * an `aoeBurst` owner (whose primed burst dents but cannot one-shot the tank)
 * alike, and the owner's own healing cannot mask it.
 */
function ultTankScenario(owner: string, seed: number): StrengthenScenario {
  return {
    lineupA: [owner],
    lineupB: ['the-thing'],
    battleTicks: 120,
    spawnGap: 6,
    primeUlt: true,
    ownerHealthFraction: 1,
    allyHealthFraction: 1,
    parkBackUnits: false,
    measure: 'ownerDamageTaken',
    expect: 'decrease',
    seed,
  };
}

// ---------------------------------------------------------------------------
// Spec constructors
// ---------------------------------------------------------------------------

/** A stable per-module harness seed — a small string hash of the id, no shared state. */
function seedOf(moduleId: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < moduleId.length; i++) h = Math.imul(h ^ moduleId.charCodeAt(i), 0x01000193);
  return (h >>> 0) || 1;
}

function heroOf(moduleId: string): string {
  return strengthenRow(moduleId).heroId;
}

function off(moduleId: string, summary: string, approximation: string, passive: StrengthenMods): StrengthenSpec {
  const heroId = heroOf(moduleId);
  return { moduleId, heroId, summary, approximation, trigger: 'passive', passive, scenario: offScenario(heroId, seedOf(moduleId)) };
}
function tank(moduleId: string, summary: string, approximation: string, passive: StrengthenMods): StrengthenSpec {
  const heroId = heroOf(moduleId);
  return { moduleId, heroId, summary, approximation, trigger: 'passive', passive, scenario: tankScenario(heroId, seedOf(moduleId)) };
}
function heal(moduleId: string, summary: string, approximation: string, passive: StrengthenMods): StrengthenSpec {
  const heroId = heroOf(moduleId);
  return { moduleId, heroId, summary, approximation, trigger: 'passive', passive, scenario: healScenario(heroId, seedOf(moduleId)) };
}
function ultOff(moduleId: string, summary: string, approximation: string, ultWindow: StrengthenUltWindow): StrengthenSpec {
  const heroId = heroOf(moduleId);
  return { moduleId, heroId, summary, approximation, trigger: 'onUlt', ultWindow, scenario: ultOffScenario(heroId, seedOf(moduleId)) };
}
function ultTank(moduleId: string, summary: string, approximation: string, ultWindow: StrengthenUltWindow): StrengthenSpec {
  const heroId = heroOf(moduleId);
  return { moduleId, heroId, summary, approximation, trigger: 'onUlt', ultWindow, scenario: ultTankScenario(heroId, seedOf(moduleId)) };
}

// ---------------------------------------------------------------------------
// The registry — 76 sourced modules (Emma Frost's 2 are gaps)
// ---------------------------------------------------------------------------

const SPEC_LIST: readonly StrengthenSpec[] = [
  // --- Vanguards --------------------------------------------------------------
  off('captain-america-s1', 'Sentinel Strike deflects and chains — more shield throughput', 'Real: Sentinel Strike gains deflection + a no-return re-cast. Sim has no discrete Sentinel Strike; substituted +18% primary DPS.', { dpsPct: 18 }),
  off('captain-america-s2', '+80% Sentinel Strike attack frequency, fully throwable', 'Real: +80% Sentinel Strike frequency. Substituted +25% primary DPS / +12% attack speed (Sentinel Strike is a fraction of output).', { dpsPct: 25, attackSpeedPct: 12 }),
  off('doctor-strange-s1', '+80% Daggers of Denak fire rate & magazine, +2 projectiles', 'Real: buffs Strange\'s primary (Daggers of Denak). No magazine/projectile-count model; substituted +40% primary DPS / +15% attack speed.', { dpsPct: 40, attackSpeedPct: 15 }),
  off('doctor-strange-s2', '-6s Maelstrom of Madness cooldown; stacking damage instances', 'Real: shorter cooldown + escalating Maelstrom hits. Substituted +14% primary DPS / +10% ult charge (more casts).', { dpsPct: 14, ultChargePct: 10 }),
  tank('groot-s1', 'Ironwood Wall: -10s cd, +400 wall HP, +1 count', 'Real: a bigger, more frequent shielding wall for the team. Deployables aren\'t modelled; substituted -12% damage taken on the owner.', { damageTakenPct: 12 }),
  off('groot-s2', 'Thornlash Wall: -4s cd, -0.2s trigger interval, +1 count [screenshot-verbatim]', 'Real: a more frequent damaging wall. Deployables aren\'t modelled; substituted +16% primary DPS.', { dpsPct: 16 }),
  off('hulk-s1', 'Indestructible Guard shields explode on end', 'Real: an AoE burst when each shield ends. No shield-end event; substituted +12% primary DPS + -8% damage taken.', { dpsPct: 12, damageTakenPct: 8 }),
  tank('hulk-s2', 'Faster Indestructible Guard; refreshes after 200 damage', 'Real: near-permanent Indestructible Guard uptime. No shield ability; substituted -15% damage taken.', { damageTakenPct: 15 }),
  ultOff('magneto-s1', 'Ultimate: +2s duration, +800 absorption limit', 'Real: a longer, higher-cap absorb-and-throw ult. Substituted a 4s post-cast buff: +20% damage, -30% damage taken.', { durationSeconds: 4, damagePct: 20, damageTakenPct: 30 }),
  ultOff('magneto-s2', 'Ultimate meteor pulls nearby enemies to the centre', 'Real: a gravity pull before the meteor lands (better clustering ⇒ more hits). Substituted +25% damage for 3s after the ult.', { durationSeconds: 3, damagePct: 25 }),
  off('peni-parker-s1', 'Bionic Spider-Nest: -12s cd, +3 nests, +100% drone production', 'Real: far more Spider-Drones on the field. Summons aren\'t modelled; substituted +20% primary DPS.', { dpsPct: 20 }),
  off('peni-parker-s2', 'Enemies in the webs 2s get ensnared', 'Real: a rooting web zone. No zone/CC model; substituted +12% primary DPS.', { dpsPct: 12 }),
  off('the-thing-s1', 'Yancy Street Charge: +5s duration, 1s stun on collision', 'Real: a longer charge that stuns. No charge/stun model; substituted +10% move speed + 8% primary DPS.', { dpsPct: 8, moveSpeedPct: 10 }),
  off('the-thing-s2', 'Stone Haymaker: 50% chance of a knockback Super Punch', 'Real: a random heavy punch with edge-kill potential. No knockback/edge model; substituted +15% primary DPS.', { dpsPct: 15 }),
  ultOff('thor-s1', 'Ultimate: +3m range, -0.3s aerial DoT interval', 'Real: a wider, faster-ticking ult. Substituted +30% damage for 4s after the ult.', { durationSeconds: 4, damagePct: 30 }),
  ultOff('thor-s2', 'During Awakening Ruse: +80% firing speed, piercing lightning', 'Real: a firing-speed self-buff on Awakening Ruse. Modelled as a 5s post-ult buff: +50% attack speed, +20% damage.', { durationSeconds: 5, attackSpeedPct: 50, damagePct: 20 }),
  tank('venom-s1', 'Symbiotic Resilience: -7s cd, +0.3 extra-health coeff, restore 30% lost HP', 'Real: a stronger, more frequent self-heal shield. No cooldown/heal ability; substituted +12% max health + 8% lifesteal.', { maxHealthPct: 12, lifestealPctAdd: 8 }),
  tank('venom-s2', 'Devour permanently converts 10% of damage dealt to max health (cap 1,200)', 'Real: a damage→max-health accrual up to +1,200. Not modelled over a battle; substituted a flat +400 max health (a mid-fight accrual toward the cap).', { maxHealthAdd: 400 }),
  // --- Duelists -------------------------------------------------------------
  off('black-panther-s1', 'Sprint Rend: +40 base damage, hits refund Spear Toss / Spinning Kick cd', 'Real: a bigger Sprint Rend that resets other abilities. No ability cooldowns; substituted +22% primary DPS.', { dpsPct: 22 }),
  ultOff('black-panther-s2', 'Ultimate: +100 base damage, +3 Bast avatars', 'Real: a harder-hitting ult with more avatars. Substituted +40% damage for 4s after the ult.', { durationSeconds: 4, damagePct: 40 }),
  off('black-widow-s1', '+80% Red Room Rifle firing speed & magazine', 'Real: buffs Widow\'s primary rifle. No magazine model; substituted +40% primary DPS / +20% attack speed.', { dpsPct: 40, attackSpeedPct: 20 }),
  off('black-widow-s2', 'Straight Shooter: +10 dmg/hit, +5 per final hit up to +260', 'Real: a per-final-hit ramp capping at +260. The escalation isn\'t modelled; substituted a flat +18% primary DPS (a mid-ramp average).', { dpsPct: 18 }),
  off('hawkeye-s1', 'Piercing Arrow additionally fires three Blast Arrows', 'Real (plan example): 3 extra projectiles at a fraction of primary. 3 Blast Arrows ≈ 1/3 of a primary hit each, on Piercing Arrow (~a quarter of output) ⇒ +25% primary DPS.', { dpsPct: 25 }),
  off('hawkeye-s2', 'Piercing Arrow -0.3s charge, +100% Archer\'s Focus ramp', 'Real: faster charge + focus stacking. No charge/focus model; substituted +15% primary DPS / +12% attack speed.', { dpsPct: 15, attackSpeedPct: 12 }),
  off('hela-s1', '+70% Nightsword Thorn fire rate & magazine [screenshot-verbatim]', 'Real: buffs Hela\'s primary (Nightsword Thorn). No fire-rate/magazine model; substituted +40% primary DPS / +25% attack speed for the +70% figure.', { dpsPct: 40, attackSpeedPct: 25 }),
  off('hela-s2', '+4 Nightsword Thorn projectiles', 'Real: 4 extra primary projectiles. Substituted +30% primary DPS (partial hits / spread).', { dpsPct: 30 }),
  off('human-torch-s1', 'Blazing Blast -1s cd, Flame Field +4s duration', 'Real: more Flame Field uptime. No zone model; substituted +14% primary DPS.', { dpsPct: 14 }),
  off('human-torch-s2', 'Flame Field burns for 6% of max health per second', 'Real: a %max-health burn zone. No zone model; substituted +18% primary DPS.', { dpsPct: 18 }),
  off('iron-fist-s1', 'Dragon\'s Defense -6s cd; upgraded Yat Jee Chung Kuen', 'Real: a stronger core combo + more parries. Substituted +16% primary DPS + -8% damage taken.', { dpsPct: 16, damageTakenPct: 8 }),
  off('iron-fist-s2', 'Dragon\'s Defense converts blocked damage into extra Yat Jee damage', 'Real: block→damage conversion. No parry event; substituted +14% primary DPS + 6% lifesteal.', { dpsPct: 14, lifestealPctAdd: 6 }),
  tank('iron-man-s1', '+250 Bonus Health & +600 ult energy per teammate KO', 'Real: stacks per ally KO. The per-KO trigger isn\'t modelled; substituted a flat one-KO\'s-worth: +250 bonus health + 20% starting ult energy.', { bonusHealthAdd: 250, ultEnergyAtRoundStartPctAdd: 20 }),
  ultOff('iron-man-s2', 'Ultimate: +500 base damage, +5m range', 'Real: a much harder Unibeam. Substituted +50% damage for 4s after the ult.', { durationSeconds: 4, damagePct: 50 }),
  tank('magik-s1', 'Stepping Discs cd -2s per hit taken; +200 Bonus Health on cast', 'Real: a defensive blink refunded by taking damage. No blink/cooldown; substituted +200 bonus health + 8% move speed.', { bonusHealthAdd: 200, moveSpeedPct: 8 }),
  off('magik-s2', 'Eldritch Whirl +4m range; Limbo Demon +6s', 'Real: longer melee reach + a longer-lived demon summon. Substituted +16% primary DPS.', { dpsPct: 16 }),
  off('mister-fantastic-s1', 'Stretch Punch: +1m range / hit, +10% Inflated damage / hit', 'Real: a ramping punch that pays off in Inflated form. Substituted +18% primary DPS.', { dpsPct: 18 }),
  tank('mister-fantastic-s2', 'Reflexive Rubber: -8s cd, 1,000 absorb, bonus health on end', 'Real: a bigger, more frequent damage-absorb with a health payout. Substituted -14% damage taken + 150 bonus health.', { damageTakenPct: 14, bonusHealthAdd: 150 }),
  off('moon-knight-s1', 'Crescent Dart / Moon Blade: +3 bounces, -10% decay per bounce', 'Real: more ricochets that keep their damage. Substituted +20% primary DPS.', { dpsPct: 20 }),
  off('moon-knight-s2', 'Ancient Ankh -8s cd, +2m pull range', 'Real: a more frequent, wider gravity well. No zone/CC model; substituted +12% primary DPS.', { dpsPct: 12 }),
  off('namor-s1', 'Wrath of the Seven Seas -3s cd; Monstro Spawn berserk +2s', 'Real: more frequent Monstro Spawn attacks. Summons aren\'t modelled; substituted +16% primary DPS.', { dpsPct: 16 }),
  ultOff('namor-s2', 'Aquatic Dominion: -9s cd, +4 Monstro Spawns, +50 HP, +8s', 'Real: many more summoned Monstro Spawns from the ult. Substituted +35% damage for 5s after the ult.', { durationSeconds: 5, damagePct: 35 }),
  ultOff('psylocke-s1', 'Ultimate: +50 base damage, -0.2s between slashes', 'Real: a faster, harder Dance of the Butterfly. Substituted +40% damage / +20% attack speed for 4s after the ult.', { durationSeconds: 4, damagePct: 40, attackSpeedPct: 20 }),
  ultOff('psylocke-s2', 'A final hit during the Ultimate extends its duration by 1s', 'Real: the ult self-extends on kills. Substituted +20% damage for 5s after the ult.', { durationSeconds: 5, damagePct: 20 }),
  off('scarlet-witch-s1', 'Chaos Control attacks three targets at once', 'Real: Scarlet Witch\'s Chaos Control siphon becomes multi-target. Substituted +25% effective primary DPS.', { dpsPct: 25 }),
  ultOff('scarlet-witch-s2', 'Ultimate: +4m range, +2s bind duration', 'Real: a wider, longer Reality Erasure. Substituted +30% damage for 4s after the ult.', { durationSeconds: 4, damagePct: 30 }),
  off('spider-man-s1', 'Web Cluster -1.5s cd; hits bind for 0.5s', 'Real: more frequent Web Cluster with a micro-root. Substituted +14% primary DPS.', { dpsPct: 14 }),
  ultOff('spider-man-s2', 'Ultimate: +4m range, +2s bind duration', 'Real: a wider, longer Spectacular Spin. Substituted +30% damage for 4s after the ult.', { durationSeconds: 4, damagePct: 30 }),
  off('squirrel-girl-s1', '+30% Burst Acorn firing speed & magazine; edge bounces', 'Real: buffs Squirrel Girl\'s primary. Substituted +22% primary DPS / +12% attack speed.', { dpsPct: 22, attackSpeedPct: 12 }),
  off('squirrel-girl-s2', '50% chance to also fire Squirrel Guards', 'Real: a chance for extra summoned attackers. Summons aren\'t modelled; substituted +18% primary DPS.', { dpsPct: 18 }),
  ultOff('star-lord-s1', 'During Blaster Barrage, refresh duration per 300 damage dealt', 'Real: a self-extending damage ult. Substituted +35% damage for 5s after the ult.', { durationSeconds: 5, damagePct: 35 }),
  ultOff('star-lord-s2', 'Ultimate locks and attacks three enemies at once', 'Real: a multi-lock ult. Substituted +30% damage for 4s after the ult.', { durationSeconds: 4, damagePct: 30 }),
  off('storm-s1', 'Goddess Boost -10s cd; -1s Thunderstorm lightning interval', 'Real: a more frequent, faster-ticking damage aura. Substituted +18% primary DPS / +10% attack speed.', { dpsPct: 18, attackSpeedPct: 10 }),
  off('storm-s2', 'Wind Blade: 30% chance to trigger Chain Lightning', 'Real: a proc chance for bonus chained damage. Substituted +20% primary DPS.', { dpsPct: 20 }),
  off('the-punisher-s1', 'Adjudication: +50% fire rate & magazine, +2 projectiles, pierce', 'Real: a heavily-buffed weapon mode. Substituted +30% primary DPS / +15% attack speed.', { dpsPct: 30, attackSpeedPct: 15 }),
  off('the-punisher-s2', 'Scourge Grenade -4s cd; hits apply 10% Vulnerability', 'Real: a Vulnerability debuff on hit. Wired through the real Vulnerability Mark path at 2%/stack; grenade cd ⇒ +6% primary DPS.', { vulnerabilityOnHitPctAdd: 2, dpsPct: 6 }),
  ultOff('winter-soldier-s1', 'Ultimate: +3m slam range', 'Real: a wider Kraken Impact. Substituted +30% damage for 3s after the ult.', { durationSeconds: 3, damagePct: 30 }),
  off('winter-soldier-s2', 'Per surviving match win: +4% ult insta-KO threshold, up to 75%', 'Real: a cross-round permanent execute-threshold ramp. Not modelled across rounds; substituted a flat +10% primary DPS + 8% ult charge.', { dpsPct: 10, ultChargePct: 8 }),
  tank('wolverine-s1', 'Regenerative Healing Factor cooldown refreshes after 800 damage', 'Real: near-permanent self-heal uptime. No cooldown/heal ability; substituted +12% lifesteal + 8% max health.', { lifestealPctAdd: 12, maxHealthPct: 8 }),
  off('wolverine-s2', 'Feral Leap -8s cd; +3% Berserk Claw Strike extra damage', 'Real: more gap-close + more low-health execute damage. Substituted +14% primary DPS + 8% move speed.', { dpsPct: 14, moveSpeedPct: 8 }),
  // --- Strategists --------------------------------------------------------------
  ultTank('adam-warlock-s1', 'Ultimate: +100 post-revival health, +2s Invincible', 'Real: a team-revive ult with a longer invuln. Modelled as a 3s -40% damage-taken buff on the caster after the ult.', { durationSeconds: 3, damageTakenPct: 40 }),
  ultOff('adam-warlock-s2', 'Ultimate-revived allies deal +80% damage for 5s', 'Real: a post-revive damage buff for the team. Applied to the caster as +40% damage for 5s after the ult.', { durationSeconds: 5, damagePct: 40 }),
  heal('cloak-and-dagger-s1', 'Light Explosion / Terror Cape -9s cd; +4m curtain width', 'Real: more frequent, wider heal/damage curtains. No curtain zones; substituted +15% healing output + 10% primary DPS.', { healPct: 15, dpsPct: 10 }),
  heal('cloak-and-dagger-s2', 'Light Curtain and Dark Curtain fire together', 'Real: both curtains on every cast (heal + damage at once). Substituted +18% healing output + 10% primary DPS.', { healPct: 18, dpsPct: 10 }),
  heal('invisible-woman-s1', 'Guardian Shield: +2m radius, +750 max health, +100/s recovery', 'Real: a much larger, tougher deployable shield for the team. Substituted -15% damage taken + 12% healing output on the owner.', { damageTakenPct: 15, healPct: 12 }),
  heal('invisible-woman-s2', 'Psionic Vortex: -8s cd, +2m range, stronger pull', 'Real: a more frequent, wider damage/CC vortex. Substituted +14% primary DPS + 8% healing output.', { dpsPct: 14, healPct: 8 }),
  heal('jeff-the-land-shark-s1', 'Looting Leviathan — devour ≥3 enemies to loot Base Modules', 'Real: the ult grants Base Modules on its own rarity table (see `lootingLeviathanRarityOdds` / `rollLootingLeviathanRarity` in modules.ts — isolated from the shop draw). Combat cannot grant mid-battle modules; the in-battle stand-in is +15% ult charge + 6% healing output.', { ultChargePct: 15, healPct: 6 }),
  heal('jeff-the-land-shark-s2', 'Joyful Splash fires two additional water columns', 'Real: 2 extra heal columns per cast. Substituted +25% healing output.', { healPct: 25 }),
  heal('loki-s1', 'Doppelganger -9s cd, +1 illusion (max 2), +50% healing coeff', 'Real: more healing clones. Clones aren\'t modelled; substituted +22% healing output.', { healPct: 22 }),
  heal('loki-s2', 'Regeneration Domain -18s cd; +100 Force Field Core HP [screenshot-verbatim]', 'Real: a more frequent heal zone + a tougher barrier. No zone/barrier; substituted +18% healing output + -10% damage taken.', { healPct: 18, damageTakenPct: 10 }),
  heal('luna-snow-s1', 'Ice Arts shards also heal for 20% of max health', 'Real: a %max-health heal rider on the primary. Substituted +20% healing output.', { healPct: 20 }),
  heal('luna-snow-s2', 'Ice Arts -10s cd, +50% shard firing speed, +1m width', 'Real: more frequent, faster Ice Arts. Substituted +18% healing output + 10% primary DPS.', { healPct: 18, dpsPct: 10 }),
  heal('mantis-s1', 'Healing Flower / Allied Inspiration / Natural Anger grant Unstoppable', 'Real: a CC-immunity rider on Mantis\'s buffs. No CC model; substituted +14% healing output + -8% damage taken.', { healPct: 14, damageTakenPct: 8 }),
  heal('mantis-s2', 'Healing Flower / Allied Inspiration splash to nearby allies', 'Real: single-target buffs become small AoEs. Substituted +22% healing output.', { healPct: 22 }),
  heal('rocket-raccoon-s1', 'Repair Mode: +40% fire rate & magazine, +3s, heal limit 10', 'Real: a much stronger healing beam. Substituted +30% healing output.', { healPct: 30 }),
  heal('rocket-raccoon-s2', 'B.R.B. -38s cd, +4 self-reviving beacons', 'Real: near-permanent revive-beacon coverage. No revive beacons; substituted +12% healing output + 10% ult charge.', { healPct: 12, ultChargePct: 10 }),
  off('ultron-s1', 'Imperative: Firewall -6s cd', 'Real: a more frequent damage field. No field/cooldown; substituted +12% primary DPS.', { dpsPct: 12 }),
  ultTank('ultron-s2', 'Imperative: Patch gives every ally a giant drone (weaker base heal)', 'Real: the ult hands the whole team a shielding/healing drone. Modelled as a 4s -25% damage-taken buff on the caster after the ult; the "-base heal efficiency" downside is not modelled.', { durationSeconds: 4, damageTakenPct: 25 }),
];

export const STRENGTHEN_SPECS: Readonly<Record<string, StrengthenSpec>> = Object.fromEntries(
  SPEC_LIST.map((s) => [s.moduleId, s]),
);

// ---------------------------------------------------------------------------
// Completeness net
// ---------------------------------------------------------------------------

/** Sourced module ids with no registered spec — must be empty. */
export function missingStrengthenHandlers(): string[] {
  const gaps = new Set(STRENGTHEN_SOURCING_GAPS);
  return allStrengthenIds()
    .filter((id) => !gaps.has(id) && !Object.prototype.hasOwnProperty.call(STRENGTHEN_SPECS, id))
    .sort();
}

/** Registered specs pointing at an id that is not in the data — must be empty. */
export function staleStrengthenHandlers(): string[] {
  const known = new Set(allStrengthenIds());
  return Object.keys(STRENGTHEN_SPECS)
    .filter((id) => !known.has(id))
    .sort();
}

/** Registered specs that would not change combat (no passive mod, no ult window) — must be empty. */
export function stubStrengthenHandlers(): string[] {
  const out: string[] = [];
  for (const [id, spec] of Object.entries(STRENGTHEN_SPECS)) {
    const p = spec.passive;
    const passiveActive =
      p !== undefined && Object.values(p).some((v) => typeof v === 'number' && v !== 0);
    const w = spec.ultWindow;
    const ultActive =
      w !== undefined &&
      ((w.damagePct ?? 0) !== 0 || (w.attackSpeedPct ?? 0) !== 0 || (w.damageTakenPct ?? 0) !== 0);
    if (!passiveActive && !ultActive) out.push(id);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Applying a module set to a unit
// ---------------------------------------------------------------------------

/** Cosmetic 6-dp rounding so golden snapshots don't carry float noise. */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * Fold every `passive`-trigger Strengthen module in `moduleIds` into a NEW
 * `ResolvedUnit`. `*Pct` mods compose multiplicatively; `*Add` mods are additive.
 * `onUlt` modules contribute nothing here — see `unitStrengthenUlt`.
 */
export function applyPassiveStrengthen(base: ResolvedUnit, moduleIds: readonly string[]): ResolvedUnit {
  if (moduleIds.length === 0) return base;

  let dpsMul = 1;
  let healMul = 1;
  let atkSpdMul = 1;
  let hpMul = 1;
  let ultMul = 1;
  let moveMul = 1;
  let dmgTakenMul = 1;
  let hpAdd = 0;
  let bonusAdd = 0;
  let lifestealAdd = 0;
  let ultEnergyStartAdd = 0;
  let rsDmgAdd = 0;
  let rsHealAdd = 0;
  let vulnAdd = 0;
  let touched = false;

  for (const id of moduleIds) {
    const spec = STRENGTHEN_SPECS[id];
    if (spec === undefined || spec.trigger !== 'passive' || spec.passive === undefined) continue;
    const m = spec.passive;
    touched = true;
    if (m.dpsPct) dpsMul *= 1 + m.dpsPct / 100;
    if (m.attackSpeedPct) atkSpdMul *= 1 + m.attackSpeedPct / 100;
    if (m.healPct) healMul *= 1 + m.healPct / 100;
    if (m.maxHealthPct) hpMul *= 1 + m.maxHealthPct / 100;
    if (m.ultChargePct) ultMul *= 1 + m.ultChargePct / 100;
    if (m.moveSpeedPct) moveMul *= 1 + m.moveSpeedPct / 100;
    if (m.damageTakenPct) dmgTakenMul *= 1 - m.damageTakenPct / 100;
    if (m.maxHealthAdd) hpAdd += m.maxHealthAdd;
    if (m.bonusHealthAdd) bonusAdd += m.bonusHealthAdd;
    if (m.lifestealPctAdd) lifestealAdd += m.lifestealPctAdd;
    if (m.ultEnergyAtRoundStartPctAdd) ultEnergyStartAdd += m.ultEnergyAtRoundStartPctAdd;
    if (m.roundStartDamagePctAdd) rsDmgAdd += m.roundStartDamagePctAdd;
    if (m.roundStartHealingPctAdd) rsHealAdd += m.roundStartHealingPctAdd;
    if (m.vulnerabilityOnHitPctAdd) vulnAdd += m.vulnerabilityOnHitPctAdd;
  }
  if (!touched) return base;

  const maxHealth = round6((base.maxHealth + hpAdd) * hpMul);
  const bonusHealth = round6(base.bonusHealth + bonusAdd);
  return {
    ...base,
    maxHealth,
    bonusHealth,
    startingHealth: round6(maxHealth + bonusHealth),
    dps: round6(base.dps * dpsMul),
    healPerSecond: round6(base.healPerSecond * healMul),
    attackSpeed: round6(base.attackSpeed * atkSpdMul),
    moveSpeed: round6(base.moveSpeed * moveMul),
    damageTakenMultiplier: round6(base.damageTakenMultiplier * Math.max(0, dmgTakenMul)),
    ultChargeRate: round6(base.ultChargeRate * ultMul),
    ultEnergyAtRoundStartPct: round6(base.ultEnergyAtRoundStartPct + ultEnergyStartAdd),
    lifestealPct: round6(base.lifestealPct + lifestealAdd),
    roundStartDamagePct: round6(base.roundStartDamagePct + rsDmgAdd),
    roundStartHealingPct: round6(base.roundStartHealingPct + rsHealAdd),
    vulnerabilityOnHitPct: round6(base.vulnerabilityOnHitPct + vulnAdd),
  };
}

/** The combined `onUlt` self-buff a unit carries from `moduleIds`, or `null` if none. */
export interface UnitStrengthenUlt {
  readonly durationTicks: number;
  readonly dmgPct: number;
  readonly atkSpdPct: number;
  readonly dmgTakenPct: number;
}

export function unitStrengthenUlt(moduleIds: readonly string[]): UnitStrengthenUlt | null {
  let durationTicks = 0;
  let dmgPct = 0;
  let atkSpdPct = 0;
  let dmgTakenPct = 0;
  for (const id of moduleIds) {
    const spec = STRENGTHEN_SPECS[id];
    if (spec === undefined || spec.trigger !== 'onUlt' || spec.ultWindow === undefined) continue;
    const w = spec.ultWindow;
    durationTicks = Math.max(durationTicks, Math.round(w.durationSeconds * TICK_RATE_HZ));
    dmgPct += w.damagePct ?? 0;
    atkSpdPct += w.attackSpeedPct ?? 0;
    dmgTakenPct += w.damageTakenPct ?? 0;
  }
  if (durationTicks === 0) return null;
  return { durationTicks, dmgPct, atkSpdPct, dmgTakenPct };
}
