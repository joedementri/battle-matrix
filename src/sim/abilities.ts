/*
 * M5 — ability + ultimate registry.
 *
 * SCOPE CALL (see the report): 39 bespoke ultimates are NOT M5's job — the
 * ledger already marks ult behaviour as authored. This registry is keyed by a
 * small set of authored ARCHETYPES; every hero maps to one archetype in
 * `heroes.json`, and the per-archetype magnitudes live in
 * `authored.ts -> ULT_ARCHETYPES`. Per-hero flavour is M11 polish.
 *
 * `castUlt(field, caster)` is invoked by `combat.ts` in the abilities/ults tick
 * phase once a unit's ult energy reaches 100% (Infinite Drive's no-consume roll
 * is handled in `combat.ts` before the cast). Burst archetypes queue damage /
 * heal events into `field.queue` so they land in the same "damage & healing"
 * phase as everything else; timed archetypes flip unit-level flags that the
 * damage function and attack cadence already read.
 *
 * PURE: no DOM, no wall clock, no platform RNG, no crypto, no `ui/` / `render/`.
 */

import { ULT_ARCHETYPES } from '../data/authored';

import type { BattleField, BattleUnit } from './combat';

/** Centre an AoE burst on the caster's current target, else the caster itself. */
function aoeCentre(field: BattleField, caster: BattleUnit): { readonly x: number; readonly y: number } {
  if (caster.targetId >= 0) {
    const t = field.units[caster.targetId];
    if (t !== undefined && t.alive) return { x: t.x, y: t.y };
  }
  return { x: caster.x, y: caster.y };
}

export function castUlt(field: BattleField, caster: BattleUnit): void {
  switch (caster.ultArchetype) {
    case 'singleTargetBurst': {
      const spec = ULT_ARCHETYPES.singleTargetBurst;
      if (caster.targetId < 0) return;
      const t = field.units[caster.targetId];
      if (t === undefined || !t.alive) return;
      field.queue.damage(caster.id, t.id, caster.perHitBase * spec.hitsOfPrimary, 'ultimate');
      return;
    }
    case 'aoeBurst': {
      const spec = ULT_ARCHETYPES.aoeBurst;
      const centre = aoeCentre(field, caster);
      const r2 = spec.radius * spec.radius;
      const hit = caster.perHitBase * spec.hitsOfPrimary;
      for (const e of field.units) {
        if (e.side === caster.side || !e.alive) continue;
        const dx = e.x - centre.x;
        const dy = e.y - centre.y;
        if (dx * dx + dy * dy <= r2) field.queue.damage(caster.id, e.id, hit, 'ultimate');
      }
      return;
    }
    case 'sustainedBeam': {
      const spec = ULT_ARCHETYPES.sustainedBeam;
      caster.beamTicks = spec.durationTicks;
      caster.beamBonusPct = spec.bonusDamagePct;
      return;
    }
    case 'teamHealBurst': {
      const spec = ULT_ARCHETYPES.teamHealBurst;
      const heal = caster.perHealBase * spec.healSecondsOfOutput;
      if (heal <= 0) return;
      for (const a of field.units) {
        if (a.side !== caster.side || !a.alive) continue;
        field.queue.heal(caster.id, a.id, heal);
      }
      return;
    }
    case 'shieldDamageReduction': {
      const spec = ULT_ARCHETYPES.shieldDamageReduction;
      for (const a of field.units) {
        if (a.side !== caster.side || !a.alive) continue;
        a.ultShieldTicks = spec.durationTicks;
        a.ultShieldReductionPct = spec.reductionPct;
      }
      return;
    }
    case 'selfBuff': {
      const spec = ULT_ARCHETYPES.selfBuff;
      caster.selfBuffTicks = spec.durationTicks;
      caster.selfBuffDamagePct = spec.damagePct;
      caster.selfBuffAttackSpeedPct = spec.attackSpeedPct;
      return;
    }
  }
}
