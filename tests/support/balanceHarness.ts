/*
 * M11 balance measurement harness — shared by `tests/balance.spec.ts` (the three
 * M11 gates + the readable tables) and available to run in isolation via
 * `npm run test:balance`.
 *
 * Two instruments:
 *
 *  1. `heroWinRates` — the per-hero win-rate gate (plan §M11: "no hero > 55 % or
 *     < 45 %"). A **paired within-role 1v1 gauntlet**: hero X versus hero Y, one
 *     unit a side, no Base Modules, every protocol at L0, from a fixed neutral
 *     position. Pairs are drawn only within role (a Vanguard is only ever
 *     measured against another Vanguard — a Vanguard-vs-Duelist swap is not a
 *     balance signal). Each pair is fought at several start separations
 *     (`SEPARATIONS`, so range genuinely matters) and in both spawn
 *     orientations (X on the near side / far side, cancelling any side bias). A
 *     battle that reaches the tie cap scores ½. A hero's win rate is its share
 *     of all such 1v1s against its same-role peers. This is deliberately the
 *     *isolated combat-power* reading: no allied healing, no target-switch
 *     cascades, no formation artefact — just "does X out-fight Y from an equal
 *     footing". The 6-hero AI corpus (instrument 2) is where lineup-level
 *     dynamics get exercised.
 *
 *  2. `runCorpus` — one shared 500-match AI-only corpus (`runMatch(seed, [],
 *     createCombatResolver(), { ai: 'aiOnly' })`), instrumented per match for
 *     (a) the winner's dominant protocol and (b) every health-loss event with
 *     its round and the surviving-unit count that produced it. Gates 2 and 3
 *     both read this one corpus — ~48 s once, not ~96 s.
 *
 * PURE-ADJACENT: this file lives under `tests/` and may use `console`; it imports
 * only from `src/sim` + `src/data`, never `src/ui` / `src/render`.
 */

import heroesJson from '../../src/data/heroes.json';
import { BATTLE_TIE_CAP_TICKS } from '../../src/data/authored';
import type { Protocol, Role } from '../../src/data/types';
import { createCombatResolver, simulateBattle } from '../../src/sim/combat';
import type { BattleUnit } from '../../src/sim/combat';
import { runMatch } from '../../src/sim/match';
import { levelsFromXp, PROTOCOLS } from '../../src/sim/modules';
import { RngStream } from '../../src/sim/rng';
import { emptySide } from '../../src/sim/stats';
import type { BattleResult, CombatContext } from '../../src/sim/types';

interface HeroLite {
  readonly id: string;
  readonly role: Role;
}

const HEROES = heroesJson as readonly HeroLite[];
const ROLES: readonly Role[] = ['vanguard', 'duelist', 'strategist'];

export function heroIdsByRole(role: Role): string[] {
  return HEROES.filter((h) => h.role === role).map((h) => h.id);
}

export const ROLE_OF: Readonly<Record<string, Role>> = Object.fromEntries(
  HEROES.map((h) => [h.id, h.role]),
);

// ---------------------------------------------------------------------------
// 1. Per-hero within-role 1v1 gauntlet
// ---------------------------------------------------------------------------

/**
 * Start separations (arena units) between the two duelling sides. Spans from
 * inside every hero's range (a stand-and-trade fight) to well outside it (a
 * closing fight where reach and moveSpeed decide who lands the first shots),
 * so `attackRange` genuinely differentiates heroes without any one distance
 * dominating the average.
 */
const SEPARATIONS: readonly number[] = [4, 8, 12, 18, 26, 40];

/**
 * Strategist duels are 3v3: the tested Strategist plus a fixed Vanguard tank
 * and a fixed Duelist attacker on each side. In a bare 1v1 a Strategist's
 * sustained heal just tops up its own (usually full) health and its team-heal
 * ultimate has no valid target, so a 1v1 collapses to a primary-fire race that
 * badly misreads the role. The shared tank + attacker give the heal — and the
 * heal ult — a real job and make the fight an attrition contest rather than a
 * knife-edge coin flip, while staying byte-identical on both sides so only the
 * Strategist decides the outcome.
 */
const STRAT_DUEL_ALLIES: readonly string[] = ['doctor-strange', 'namor'];

const DUEL_RNG = new RngStream(0xba1a11ce);

/** One no-module duel from a fixed neutral position `sep` apart. 'win' == near side. */
function duel(role: Role, nearHero: string, farHero: string, sep: number): BattleResult {
  const lineupOf = (hero: string): string[] =>
    role === 'strategist' ? [hero, ...STRAT_DUEL_ALLIES] : [hero];
  const side = (playerId: number, hero: string): CombatContext['sideA'] => ({
    playerId,
    lineup: lineupOf(hero),
    isPhantom: false,
    isGalactaBots: false,
    modules: emptySide(),
    deployment: null,
    strengthen: null,
  });
  const ctx: CombatContext = {
    round: 7,
    roundType: 'battle',
    matchupKind: 'pvp',
    sideA: side(0, nearHero),
    sideB: side(1, farHero),
    rng: DUEL_RNG.stream(`${nearHero}:${farHero}:${sep}`, 7),
    drones: [],
  };
  return simulateBattle(ctx, {
    tieCapTicks: BATTLE_TIE_CAP_TICKS,
    place: (us: BattleUnit[]) => {
      for (const u of us) {
        u.x = (u.slot - 1) * 5; // spread 1..3 units across the near/far line
        u.y = u.side === 0 ? -sep / 2 : sep / 2;
      }
    },
  }).outcome.result;
}

export interface HeroRate {
  readonly heroId: string;
  readonly role: Role;
  readonly battles: number;
  readonly wins: number;
  readonly winPct: number;
}

export interface HeroWinRateReport {
  readonly rows: readonly HeroRate[];
  readonly totalBattles: number;
  readonly minBattlesPerHero: number;
  /** ±1σ binomial noise on a 50 % hero at `minBattlesPerHero` samples, in percentage points. */
  readonly noiseFloorPP: number;
  readonly worst: HeroRate;
  readonly best: HeroRate;
}

export function heroWinRates(): HeroWinRateReport {
  const acc = new Map<string, { battles: number; wins: number }>();
  for (const h of HEROES) acc.set(h.id, { battles: 0, wins: 0 });

  const credit = (nearHero: string, farHero: string, r: BattleResult): void => {
    const a = acc.get(nearHero)!;
    const b = acc.get(farHero)!;
    a.battles++;
    b.battles++;
    if (r === 'win') a.wins++;
    else if (r === 'loss') b.wins++;
    else {
      a.wins += 0.5;
      b.wins += 0.5;
    }
  };

  for (const role of ROLES) {
    const ids = heroIdsByRole(role);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const x = ids[i]!;
        const y = ids[j]!;
        for (const sep of SEPARATIONS) {
          credit(x, y, duel(role, x, y, sep)); // x near, y far
          credit(y, x, duel(role, y, x, sep)); // y near, x far
        }
      }
    }
  }

  const rows: HeroRate[] = HEROES.map((h) => {
    const a = acc.get(h.id)!;
    return {
      heroId: h.id,
      role: h.role,
      battles: a.battles,
      wins: a.wins,
      winPct: a.battles === 0 ? 0 : (100 * a.wins) / a.battles,
    };
  }).sort((p, q) => p.winPct - q.winPct);

  const minBattles = Math.min(...rows.map((r) => r.battles));
  return {
    rows,
    totalBattles: rows.reduce((n, r) => n + r.battles, 0) / 2,
    minBattlesPerHero: minBattles,
    noiseFloorPP: 100 * Math.sqrt(0.25 / minBattles),
    worst: rows[0]!,
    best: rows[rows.length - 1]!,
  };
}

// ---------------------------------------------------------------------------
// 2. The shared 500-match AI-only corpus
// ---------------------------------------------------------------------------

export type ProtocolBucket = Protocol | 'none';

function dominantProtocol(xp: Readonly<Record<Protocol, number>>): ProtocolBucket {
  const levels = levelsFromXp(xp);
  let best: Protocol | null = null;
  let bestLevel = -1;
  let bestXp = -1;
  for (const p of PROTOCOLS) {
    const l = levels[p];
    const x = xp[p];
    if (l > bestLevel || (l === bestLevel && x > bestXp)) {
      best = p;
      bestLevel = l;
      bestXp = x;
    }
  }
  return best === null || xp[best] === 0 ? 'none' : best;
}

export interface HpLossByBucket {
  /** `floor((round-1)/5)` bucket: 0 for rounds 2-5, 1 for 6-10, ... */
  readonly bucket: number;
  readonly events: number;
  readonly totalHp: number;
  readonly meanHp: number;
}

export interface CorpusReport {
  readonly matches: number;
  readonly protocolWins: Readonly<Record<ProtocolBucket, number>>;
  readonly protocolShare: Readonly<Record<ProtocolBucket, number>>;
  readonly topProtocol: { readonly protocol: ProtocolBucket; readonly share: number };

  /** Every health-loss event (a PvP/phantom/mirror loss OR tie that cost HP). */
  readonly hpLossEvents: number;
  readonly hpLossTotal: number;
  readonly hpLossPerRoundLoss: number;

  /** The same, counting clean losses only (ties excluded). */
  readonly lossOnlyEvents: number;
  readonly lossOnlyPerLoss: number;

  /** Mean HP per round-loss split by the formula's `floor((round-1)/5)` bucket. */
  readonly byBucket: readonly HpLossByBucket[];

  /** Sanity: matches that produced a winner. */
  readonly decisiveMatches: number;

  /** First few winners' protocol-XP maps + dominant bucket, for diagnosis. */
  readonly winnerSamples: readonly {
    readonly seed: number;
    readonly xp: Readonly<Record<Protocol, number>>;
    readonly dominant: ProtocolBucket;
  }[];
  /** Distribution of winners by (bucket, level) — e.g. how deep the equilibrium builds go. */
  readonly winnerLevelHistogram: Readonly<Record<string, number>>;

  /** Diagnosis: histogram of the `survivingUnits` value on each round-loss. */
  readonly survivorHistogram: Readonly<Record<number, number>>;
  /** Fraction of round-loss events that came from a tie (vs a clean loss). */
  readonly tieFraction: number;
  /** Histogram of the round a match ended on. */
  readonly matchEndRoundHistogram: Readonly<Record<number, number>>;
  /** Mean HP lost per round-loss with `survivingUnits` clamped to [1,N] for N in 2..6 — a what-if for the DERIVED clamp. */
  readonly meanHpUnderSurvivorCap: Readonly<Record<number, number>>;
  /** what-if grid `"<survivorCap>/<roundDivisor>"` -> mean HP/round-loss under that DERIVED re-fit. */
  readonly meanHpRefit: Readonly<Record<string, number>>;
}

export interface CorpusConfig {
  readonly seeds: number;
  readonly startSeed?: number;
}

export function runCorpus(cfg: CorpusConfig): CorpusReport {
  const resolver = createCombatResolver();
  const start = cfg.startSeed ?? 0;

  const protocolWins: Record<ProtocolBucket, number> = {
    fortress: 0,
    onslaught: 0,
    reboot: 0,
    equilibrium: 0,
    none: 0,
  };
  let decisive = 0;
  const winnerSamples: CorpusReport['winnerSamples'][number][] = [];
  const winnerLevelHistogram: Record<string, number> = {};

  let hpEvents = 0;
  let hpTotal = 0;
  let lossEvents = 0;
  let lossTotal = 0;
  let tieEvents = 0;
  const buckets = new Map<number, { events: number; totalHp: number }>();
  const survivorHistogram: Record<number, number> = {};
  const matchEndRoundHistogram: Record<number, number> = {};
  const capTotals: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  /** what-if grid: `${survivorCap}/${roundDivisor}` -> summed re-fitted HP loss. */
  const refitTotals: Record<string, number> = {};

  const noteLoss = (round: number, hp: number, survivors: number, isTie: boolean): void => {
    if (hp <= 0) return;
    hpEvents++;
    hpTotal += hp;
    if (isTie) tieEvents++;
    else {
      lossEvents++;
      lossTotal += hp;
    }
    survivorHistogram[survivors] = (survivorHistogram[survivors] ?? 0) + 1;
    const b = Math.floor((round - 1) / 5);
    const cur = buckets.get(b) ?? { events: 0, totalHp: 0 };
    cur.events++;
    cur.totalHp += hp;
    buckets.set(b, cur);
    // What-if: recompute the DERIVED loss with `survivingEnemyUnits` capped lower.
    for (const cap of [2, 3, 4, 5, 6]) {
      const raw = Math.floor((round - 1) / 5) + Math.min(cap, Math.max(1, survivors));
      capTotals[cap]! += isTie ? Math.ceil(raw / 2) : raw;
    }
    // What-if grid: cap the survivor term AND vary the round divisor (a re-fit).
    for (const cap of [2, 3]) {
      for (const div of [5, 6, 7, 8, 10]) {
        const raw = Math.floor((round - 1) / div) + Math.min(cap, Math.max(1, survivors));
        const key = `${cap}/${div}`;
        refitTotals[key] = (refitTotals[key] ?? 0) + (isTie ? Math.ceil(raw / 2) : raw);
      }
    }
  };

  for (let seed = start; seed < start + cfg.seeds; seed++) {
    const res = runMatch(seed >>> 0, [], resolver, { ai: 'aiOnly' });

    const w = res.finalState.winnerId;
    if (w !== null) {
      decisive++;
      const xp = res.finalState.players[w]!.protocolXp;
      const dominant = dominantProtocol(xp);
      protocolWins[dominant]++;
      if (winnerSamples.length < 12) winnerSamples.push({ seed: seed >>> 0, xp: { ...xp }, dominant });
      const lvl = dominant === 'none' ? 0 : levelsFromXp(xp)[dominant];
      const key = `${dominant} L${lvl}`;
      winnerLevelHistogram[key] = (winnerLevelHistogram[key] ?? 0) + 1;
    }
    const endRound = res.finalState.round;
    matchEndRoundHistogram[endRound] = (matchEndRoundHistogram[endRound] ?? 0) + 1;

    for (const b of res.boundaries) {
      if (b.kind !== 'battle') continue;
      for (const m of b.state.matchups) {
        if (m.kind === 'pve') continue;
        const isTie = m.resultA === 'tie';
        const survivors = m.survivingUnits ?? 1;
        noteLoss(b.round, m.healthLossA, survivors, isTie);
        if (m.kind === 'pvp') noteLoss(b.round, m.healthLossB, survivors, isTie);
      }
    }
  }

  const share = (n: number): number => (decisive === 0 ? 0 : (100 * n) / decisive);
  const protocolShare: Record<ProtocolBucket, number> = {
    fortress: share(protocolWins.fortress),
    onslaught: share(protocolWins.onslaught),
    reboot: share(protocolWins.reboot),
    equilibrium: share(protocolWins.equilibrium),
    none: share(protocolWins.none),
  };
  const realProtocols: readonly ProtocolBucket[] = PROTOCOLS;
  const top = realProtocols
    .map((p) => ({ protocol: p, share: protocolShare[p] }))
    .sort((a, b) => b.share - a.share)[0]!;

  const byBucket: HpLossByBucket[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, v]) => ({
      bucket,
      events: v.events,
      totalHp: v.totalHp,
      meanHp: v.events === 0 ? 0 : v.totalHp / v.events,
    }));

  return {
    matches: cfg.seeds,
    protocolWins,
    protocolShare,
    topProtocol: top,
    hpLossEvents: hpEvents,
    hpLossTotal: hpTotal,
    hpLossPerRoundLoss: hpEvents === 0 ? 0 : hpTotal / hpEvents,
    lossOnlyEvents: lossEvents,
    lossOnlyPerLoss: lossEvents === 0 ? 0 : lossTotal / lossEvents,
    byBucket,
    decisiveMatches: decisive,
    winnerSamples,
    winnerLevelHistogram,
    survivorHistogram,
    tieFraction: hpEvents === 0 ? 0 : tieEvents / hpEvents,
    matchEndRoundHistogram,
    meanHpUnderSurvivorCap: {
      2: hpEvents === 0 ? 0 : capTotals[2]! / hpEvents,
      3: hpEvents === 0 ? 0 : capTotals[3]! / hpEvents,
      4: hpEvents === 0 ? 0 : capTotals[4]! / hpEvents,
      5: hpEvents === 0 ? 0 : capTotals[5]! / hpEvents,
      6: hpEvents === 0 ? 0 : capTotals[6]! / hpEvents,
    },
    meanHpRefit: Object.fromEntries(
      Object.entries(refitTotals).map(([k, v]) => [k, hpEvents === 0 ? 0 : v / hpEvents]),
    ),
  };
}
