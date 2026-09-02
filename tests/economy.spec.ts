import { describe, expect, it } from 'vitest';

import {
  BASE_INCOME,
  HEALTH_COMPENSATION_PER_HP,
  STARTING_TOKENS,
  STREAK_BONUS_CAP,
} from '../src/data/constants';
import * as A from '../src/data/authored';
import {
  applyBattleResolution,
  applyRoundStartIncome,
  hpCompensation,
  interest,
  previewIncome,
  spend,
  streakBonus,
} from '../src/sim/economy';
import type { EconomyStateView, PlayerBattleOutcome } from '../src/sim/economy';
import { runMatch } from '../src/sim/match';
import { RngStream } from '../src/sim/rng';
import { createStubCombatResolver } from '../src/sim/stubCombat';
import type {
  BattleResult,
  CombatContext,
  CombatOutcome,
  CombatResolver,
  MatchupKind,
  StreakKind,
} from '../src/sim/types';

/*
 * Every M3 assertion, encoded. Reference arithmetic is worked out by hand in the
 * comments — never pasted back from the implementation — so a bug in `economy.ts`
 * and a matching bug here cannot pass together.
 *
 * Canonical facts used below, transcribed independently from the plan:
 *   base income 15 · interest +1 per 10 held, cap +5 · streak bonus min(n, 4) ·
 *   +2 PvP win bonus at battle resolution · +1 token per 1 health lost ·
 *   round 1 grants no income · starting tokens 10.
 */

const BASE = 15;
const CAP = 5;

// ---------------------------------------------------------------------------
// Test-state helpers (structurally an EconomyStateView)
// ---------------------------------------------------------------------------

interface TPlayer {
  id: number;
  alive: boolean;
  tokens: number;
  streak: number;
  streakKind: StreakKind;
}

function player(p: Partial<TPlayer> = {}): TPlayer {
  return {
    id: p.id ?? 0,
    alive: p.alive ?? true,
    tokens: p.tokens ?? 0,
    streak: p.streak ?? 0,
    streakKind: p.streakKind ?? 'none',
  };
}

/** `round` defaults to 3 — any round >= 2 pays income; use 1 for the no-income case. */
function state(round: number, ...players: TPlayer[]): EconomyStateView & { round: number; players: TPlayer[] } {
  return { round, players: players.length > 0 ? players : [player()] };
}

function resolve(
  s: EconomyStateView,
  o: Partial<PlayerBattleOutcome> & Pick<PlayerBattleOutcome, 'result' | 'matchupKind'>,
): void {
  applyBattleResolution(s, {
    playerId: o.playerId ?? 0,
    result: o.result,
    matchupKind: o.matchupKind,
    healthBefore: o.healthBefore ?? 50,
    rawHealthLoss: o.rawHealthLoss ?? 0,
  });
}

// ---------------------------------------------------------------------------
// interest()
// ---------------------------------------------------------------------------

describe('interest(tokens) = min(floor(tokens / 10), 5)', () => {
  it('reproduces the interest table exactly', () => {
    expect(interest(0)).toBe(0); //  floor(0/10)   = 0
    expect(interest(9)).toBe(0); //  floor(9/10)   = 0
    expect(interest(10)).toBe(1); // floor(10/10)  = 1
    expect(interest(29)).toBe(2); // floor(29/10)  = 2
    expect(interest(50)).toBe(5); // floor(50/10)  = 5
    expect(interest(137)).toBe(5); // floor(137/10) = 13 -> capped at 5
  });

  it('is computed on the raw balance, not balance + base income', () => {
    // 10 held: floor(10/10) = 1. Adding base 15 first would give floor(25/10) = 2.
    expect(interest(10)).toBe(1);
    // 5 held: floor(5/10) = 0. Adding base 15 first would give floor(20/10) = 2.
    expect(interest(5)).toBe(0);
  });

  it('never earns on a non-positive balance', () => {
    expect(interest(-1)).toBe(0);
    expect(interest(-100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The three-screenshot preview regression test — the milestone's anchor
// ---------------------------------------------------------------------------

describe('previewIncome — the three observed screenshots, exactly', () => {
  it('10 tokens, no streak  ->  +16   (15 base + floor(10/10)=1 interest + 0 streak)', () => {
    const bd = previewIncome(state(1, player({ tokens: 10, streakKind: 'none', streak: 0 })), 0);
    expect(bd).toEqual({ base: 15, interest: 1, streak: 0, total: 16 });
  });

  it('5 tokens, no streak  ->  +15   (15 base + floor(5/10)=0 interest + 0 streak)', () => {
    // The purchased-example screenshot: spending 10 -> 5 drops the preview (+16) -> (+15).
    const bd = previewIncome(state(1, player({ tokens: 5, streakKind: 'none', streak: 0 })), 0);
    expect(bd).toEqual({ base: 15, interest: 0, streak: 0, total: 15 });
  });

  it('0 tokens, 12-win streak  ->  +19   (15 base + 0 interest + min(12,4)=4 streak)', () => {
    const bd = previewIncome(state(18, player({ tokens: 0, streakKind: 'win', streak: 12 })), 0);
    expect(bd).toEqual({ base: 15, interest: 0, streak: 4, total: 19 });
  });

  it('none of the three previews includes the +2 PvP win bonus', () => {
    // 15 + interest + streak fits all three to the digit; +2 would break every one.
    expect(previewIncome(state(3, player({ tokens: 10 })), 0).total).toBe(16);
    expect(previewIncome(state(3, player({ tokens: 5 })), 0).total).toBe(15);
    expect(previewIncome(state(3, player({ tokens: 0, streakKind: 'win', streak: 12 })), 0).total).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// previewIncome — total, forward-looking, single source of truth
// ---------------------------------------------------------------------------

describe('previewIncome — properties', () => {
  it('is total: an eliminated or unknown player is all zeros', () => {
    const s = state(3, player({ id: 0, alive: false, tokens: 100, streak: 4, streakKind: 'win' }));
    expect(previewIncome(s, 0)).toEqual({ base: 0, interest: 0, streak: 0, total: 0 });
    expect(previewIncome(s, 99)).toEqual({ base: 0, interest: 0, streak: 0, total: 0 });
  });

  it('total is always base + interest + streak', () => {
    const rng = new RngStream(0x50c).stream('preview-prop');
    for (let i = 0; i < 500; i++) {
      const kinds: StreakKind[] = ['none', 'win', 'loss'];
      const s = state(
        rng.int(2, 40),
        player({
          tokens: rng.int(0, 400),
          streak: rng.int(0, 20),
          streakKind: rng.pick(kinds),
        }),
      );
      const bd = previewIncome(s, 0);
      expect(bd.total).toBe(bd.base + bd.interest + bd.streak);
      expect(bd.base).toBe(BASE_INCOME);
      expect(bd.interest).toBe(interest(s.players[0]!.tokens));
      expect(bd.streak).toBeLessThanOrEqual(STREAK_BONUS_CAP);
    }
  });

  it('drops (+16) -> (+15) the moment the balance falls from 10 to 5 (the purchased-example screenshot)', () => {
    const s = state(3, player({ tokens: 10 }));
    expect(previewIncome(s, 0).total).toBe(16);
    expect(spend(s, 0, 5)).toBe(true);
    expect(previewIncome(s, 0).total).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Streak counter
// ---------------------------------------------------------------------------

describe('win/loss streak counter', () => {
  it('is 0 / "none" before any PvP result has been recorded', () => {
    const p = player();
    expect(p.streak).toBe(0);
    expect(p.streakKind).toBe('none');
    expect(streakBonus('none', 0)).toBe(0);
    // and round 1's forward-looking preview therefore carries no streak bonus
    expect(previewIncome(state(1, p), 0).streak).toBe(0);
  });

  it('five consecutive wins yield streak bonuses 1, 2, 3, 4, 4 — never 5', () => {
    const s = state(3, player({ tokens: 0 }));
    const bonuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      resolve(s, { result: 'win', matchupKind: 'pvp' });
      bonuses.push(previewIncome(s, 0).streak);
    }
    expect(bonuses).toEqual([1, 2, 3, 4, 4]); // min(count, 4): 1,2,3,4,min(5,4)
    expect(s.players[0]!.streak).toBe(5); // raw counter keeps climbing past the cap
    expect(s.players[0]!.streakKind).toBe('win');
  });

  it('a loss after a win streak resets the counter to 1 (a loss streak), not 0 and not 4', () => {
    const s = state(3, player({ tokens: 0 }));
    for (let i = 0; i < 3; i++) resolve(s, { result: 'win', matchupKind: 'pvp' });
    expect(s.players[0]!).toMatchObject({ streak: 3, streakKind: 'win' });

    resolve(s, { result: 'loss', matchupKind: 'pvp', healthBefore: 50, rawHealthLoss: 6 });
    expect(s.players[0]!.streakKind).toBe('loss');
    expect(s.players[0]!.streak).toBe(1); // reset to STREAK_START, not 0, not carried
  });

  it('a same-kind result increments; an opposite result resets to 1', () => {
    const s = state(3, player({ tokens: 0 }));
    resolve(s, { result: 'loss', matchupKind: 'pvp', rawHealthLoss: 4 }); // loss/1
    resolve(s, { result: 'loss', matchupKind: 'pvp', rawHealthLoss: 4 }); // loss/2
    resolve(s, { result: 'loss', matchupKind: 'pvp', rawHealthLoss: 4 }); // loss/3
    expect(s.players[0]!).toMatchObject({ streak: 3, streakKind: 'loss' });
    resolve(s, { result: 'win', matchupKind: 'pvp' }); // -> win/1
    expect(s.players[0]!).toMatchObject({ streak: 1, streakKind: 'win' });
  });
});

// ---------------------------------------------------------------------------
// HP compensation
// ---------------------------------------------------------------------------

describe('HP compensation (+1 token per 1 health lost)', () => {
  it('losing 8 HP grants exactly +8 tokens', () => {
    expect(HEALTH_COMPENSATION_PER_HP).toBe(1);
    const s = state(3, player({ tokens: 0 }));
    resolve(s, { result: 'loss', matchupKind: 'pvp', healthBefore: 50, rawHealthLoss: 8 });
    expect(s.players[0]!.tokens).toBe(8);
  });

  it('is clamped to health ACTUALLY lost after the floor at 0 (HP_COMPENSATION_CLAMP)', () => {
    expect(A.HP_COMPENSATION_CLAMP).toBe('actualHealthLost');
    // A player on 3 HP takes a raw 5-point loss.
    //   'actualHealthLost' (our call): min(5, 3) = 3  ->  +3 tokens
    //   'rawLossAmount'              : 5              ->  +5 tokens
    const s = state(3, player({ tokens: 0 }));
    resolve(s, { result: 'loss', matchupKind: 'pvp', healthBefore: 3, rawHealthLoss: 5 });
    expect(s.players[0]!.tokens).toBe(3);

    // the pure helper, both readings spelled out
    expect(hpCompensation(3, 5)).toBe(3); // clamped
    expect(hpCompensation(50, 8)).toBe(8); // unclamped, fits
    expect(hpCompensation(50, 0)).toBe(0); // no loss, no pay
    expect(hpCompensation(0, 4)).toBe(0); // already dead: nothing left to lose
  });

  it('a tie that costs health still pays compensation', () => {
    const s = state(3, player({ tokens: 0, streak: 2, streakKind: 'win' }));
    resolve(s, { result: 'tie', matchupKind: 'pvp', healthBefore: 20, rawHealthLoss: 3 });
    expect(s.players[0]!.tokens).toBe(3); // +3 for the health lost
    expect(s.players[0]!).toMatchObject({ streak: 2, streakKind: 'win' }); // streak untouched
  });
});

// ---------------------------------------------------------------------------
// +2 PvP win bonus — at resolution, never in the preview
// ---------------------------------------------------------------------------

describe('+2 PvP win bonus', () => {
  it('is granted at battle resolution, not round start', () => {
    expect(A.PVP_WIN_TOKEN_BONUS).toBe(2);
    expect(A.PVP_WIN_TOKEN_BONUS_TIMING).toBe('atBattleResolution');

    // resolution: a PvP win adds +2 (no health lost -> no compensation)
    const s = state(3, player({ tokens: 0 }));
    resolve(s, { result: 'win', matchupKind: 'pvp' });
    expect(s.players[0]!.tokens).toBe(2);
    expect(s.players[0]!).toMatchObject({ streak: 1, streakKind: 'win' });

    // round start: a player who just won still previews only base + interest + streak
    const won = state(3, player({ tokens: 0, streak: 1, streakKind: 'win' }));
    expect(previewIncome(won, 0)).toEqual({ base: 15, interest: 0, streak: 1, total: 16 });
  });
});

// ---------------------------------------------------------------------------
// applyRoundStartIncome — order, round 1, eliminated players
// ---------------------------------------------------------------------------

describe('applyRoundStartIncome', () => {
  it('round 1 grants nothing (the 1-1 screenshot shows every player at 10)', () => {
    const s = state(1, player({ tokens: 10 }), player({ id: 1, tokens: 10 }));
    applyRoundStartIncome(s);
    expect(s.players.map((p) => p.tokens)).toEqual([10, 10]);
  });

  it('round 2+ grants base + interest + streak, in that summation order', () => {
    const s = state(2, player({ tokens: 23, streak: 1, streakKind: 'win' }));
    applyRoundStartIncome(s);
    // 23 + (15 + floor(23/10)=2 + min(1,4)=1) = 23 + 18 = 41
    expect(s.players[0]!.tokens).toBe(41);
  });

  it('equals the sum of previewIncome over living players (single source of truth)', () => {
    const rng = new RngStream(99).stream('rsi-prop');
    for (let i = 0; i < 200; i++) {
      const kinds: StreakKind[] = ['none', 'win', 'loss'];
      const s = state(
        rng.int(2, 40),
        player({ id: 0, tokens: rng.int(0, 200), streak: rng.int(0, 9), streakKind: rng.pick(kinds) }),
        player({ id: 1, alive: false, tokens: rng.int(0, 200) }),
        player({ id: 2, tokens: rng.int(0, 200), streak: rng.int(0, 9), streakKind: rng.pick(kinds) }),
      );
      const previews = s.players.map((p) => previewIncome(s, p.id).total);
      const before = s.players.map((p) => p.tokens);
      applyRoundStartIncome(s);
      s.players.forEach((p, idx) => {
        expect(p.tokens).toBe(before[idx]! + previews[idx]!);
      });
    }
  });

  it('skips eliminated players entirely — no income, no interest, no streak progression', () => {
    const s = state(3, player({ id: 0, tokens: 10 }), player({ id: 1, alive: false, tokens: 7, streak: 2, streakKind: 'loss' }));
    applyRoundStartIncome(s);
    expect(s.players[0]!.tokens).toBe(26); // 10 + 15 + 1
    expect(s.players[1]!).toMatchObject({ tokens: 7, streak: 2, streakKind: 'loss' }); // frozen
  });
});

// ---------------------------------------------------------------------------
// The three ambiguity calls, each pinned by an authored.ts constant
// ---------------------------------------------------------------------------

describe('M3 ambiguity calls (documented in authored.ts, not buried in a branch)', () => {
  it('Practice (PvE) rounds do not touch the streak — PVE_TOUCHES_STREAK = false', () => {
    expect(A.PVE_TOUCHES_STREAK).toBe(false);
    const s = state(6, player({ tokens: 0, streak: 2, streakKind: 'win' }));
    resolve(s, { result: 'win', matchupKind: 'pve' });
    resolve(s, { result: 'loss', matchupKind: 'pve' });
    expect(s.players[0]!).toMatchObject({ tokens: 0, streak: 2, streakKind: 'win' });
  });

  it('a PvP tie leaves the streak unchanged — TIE_STREAK_BEHAVIOUR = "unchanged"', () => {
    expect(A.TIE_STREAK_BEHAVIOUR).toBe('unchanged');
    const s = state(4, player({ tokens: 0, streak: 3, streakKind: 'win' }));
    resolve(s, { result: 'tie', matchupKind: 'pvp', healthBefore: 40, rawHealthLoss: 2 });
    expect(s.players[0]!).toMatchObject({ streak: 3, streakKind: 'win', tokens: 2 });
  });

  it('beating a phantom or mirror pays nothing — PHANTOM_MIRROR_WIN_PAYS = false', () => {
    expect(A.PHANTOM_MIRROR_WIN_PAYS).toBe(false);
    for (const kind of ['phantom', 'mirror'] as MatchupKind[]) {
      const s = state(5, player({ tokens: 7, streak: 2, streakKind: 'loss' }));
      resolve(s, { result: 'win', matchupKind: kind });
      // no +2, no streak increment, no reset of the existing loss streak
      expect(s.players[0]!).toMatchObject({ tokens: 7, streak: 2, streakKind: 'loss' });
    }
  });

  it('losing to a phantom or mirror is a real loss — advances the loss streak and pays compensation', () => {
    for (const kind of ['phantom', 'mirror'] as MatchupKind[]) {
      const s = state(5, player({ tokens: 0, streak: 2, streakKind: 'win' }));
      resolve(s, { result: 'loss', matchupKind: kind, healthBefore: 50, rawHealthLoss: 4 });
      expect(s.players[0]!).toMatchObject({ tokens: 4, streak: 1, streakKind: 'loss' });
    }
  });

  it('a tie against a phantom or mirror advances the loss streak — PHANTOM_MIRROR_TIE_ADVANCES_LOSS_STREAK = true', () => {
    // The one place two plan rulings collide; this follows the literal phantom wording.
    expect(A.PHANTOM_MIRROR_TIE_ADVANCES_LOSS_STREAK).toBe(true);
    const s = state(5, player({ tokens: 0, streak: 3, streakKind: 'win' }));
    resolve(s, { result: 'tie', matchupKind: 'phantom', healthBefore: 50, rawHealthLoss: 2 });
    expect(s.players[0]!).toMatchObject({ tokens: 2, streak: 1, streakKind: 'loss' });
  });
});

// ---------------------------------------------------------------------------
// spend — refuses, never clamps
// ---------------------------------------------------------------------------

describe('spend', () => {
  it('refuses an unaffordable spend rather than clamping; refuses negatives, non-integers, dead/unknown players', () => {
    const s = state(3, player({ id: 0, tokens: 10 }), player({ id: 1, alive: false, tokens: 5 }));

    expect(spend(s, 0, 11)).toBe(false); // overspend by 1
    expect(s.players[0]!.tokens).toBe(10); // unchanged — NOT clamped to 0
    expect(spend(s, 0, -1)).toBe(false); // negative
    expect(spend(s, 0, 2.5)).toBe(false); // non-integer
    expect(spend(s, 0, Number.NaN)).toBe(false);
    expect(spend(s, 0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(s.players[0]!.tokens).toBe(10);

    expect(spend(s, 0, 10)).toBe(true); // exact balance ok
    expect(s.players[0]!.tokens).toBe(0);
    expect(spend(s, 0, 0)).toBe(true); // zero is a no-op success
    expect(s.players[0]!.tokens).toBe(0);

    expect(spend(s, 1, 1)).toBe(false); // eliminated player
    expect(spend(s, 9, 1)).toBe(false); // unknown player
  });

  it('tokens never go negative over random sequences of legal/illegal spends, income and resolutions', () => {
    const results: BattleResult[] = ['win', 'loss', 'tie'];
    for (let seed = 1; seed <= 250; seed++) {
      const rng = new RngStream(seed).stream('m3-token-fuzz');
      const s = state(2, player({ tokens: rng.int(0, 30) }));
      const p = s.players[0]!;
      for (let step = 0; step < 60; step++) {
        const before = p.tokens;
        switch (rng.int(0, 2)) {
          case 0: {
            const amount = rng.int(-2, 20);
            const ok = spend(s, 0, amount);
            if (ok) {
              expect(amount).toBeGreaterThanOrEqual(0);
              expect(p.tokens).toBe(before - amount);
            } else {
              expect(p.tokens).toBe(before); // refused: no change at all
            }
            break;
          }
          case 1: {
            s.round = rng.int(1, 12);
            applyRoundStartIncome(s);
            expect(p.tokens).toBeGreaterThanOrEqual(before); // income only ever adds
            break;
          }
          default: {
            resolve(s, {
              result: rng.pick(results),
              matchupKind: 'pvp',
              healthBefore: rng.int(0, 50),
              rawHealthLoss: rng.int(0, 12),
            });
            expect(p.tokens).toBeGreaterThanOrEqual(before); // resolution only ever adds
          }
        }
        expect(p.tokens).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(p.tokens)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 12-round scripted win/loss ledger — hand-computed, literal expected table
// ---------------------------------------------------------------------------

describe('12-round scripted ledger (independent hand-computation)', () => {
  interface Row {
    round: number;
    type: 'battle' | 'practice';
    result: BattleResult; // for practice: a PvE 'win', must not move the streak
    rawLoss: number; // raw HP-loss the M2 formula would assign this round
    spend: number; // tokens spent this round, after income
    // expected AT END OF ROUND:
    income: number; // income granted at this round's start (0 on round 1)
    tokens: number;
    streak: number;
    streakKind: StreakKind;
    health: number;
  }

  // interest i(t) = min(floor(t/10), 5) ; streak bonus sb(kind,n) = kind==='none' ? 0 : min(n,4)
  const LEDGER: Row[] = [
    // r1 practice: round-1 income is 0; PvE is health-neutral and streak-neutral.
    { round: 1, type: 'practice', result: 'win', rawLoss: 0, spend: 0, income: 0, tokens: 10, streak: 0, streakKind: 'none', health: 50 },

    // r2 battle WIN: income 15 + i(10)=1 + sb(none)=0 = 16 -> 26 ; spend 5 -> 21 ; +2 win -> 23 ; streak none->win/1
    { round: 2, type: 'battle', result: 'win', rawLoss: 0, spend: 5, income: 16, tokens: 23, streak: 1, streakKind: 'win', health: 50 },

    // r3 battle WIN: 15 + i(23)=2 + sb(win,1)=1 = 18 -> 41 ; +2 -> 43 ; win/1->win/2
    { round: 3, type: 'battle', result: 'win', rawLoss: 0, spend: 0, income: 18, tokens: 43, streak: 2, streakKind: 'win', health: 50 },

    // r4 battle LOSS: 15 + i(43)=4 + sb(win,2)=2 = 21 -> 64 ; spend 15 -> 49 ; +6 comp -> 55 ; win/2 -> loss/1 ; health 50-6=44
    { round: 4, type: 'battle', result: 'loss', rawLoss: 6, spend: 15, income: 21, tokens: 55, streak: 1, streakKind: 'loss', health: 44 },

    // r5 battle LOSS: 15 + i(55)=5 + sb(loss,1)=1 = 21 -> 76 ; spend 50 -> 26 ; +6 comp -> 32 ; loss/1->loss/2 ; 44-6=38
    { round: 5, type: 'battle', result: 'loss', rawLoss: 6, spend: 50, income: 21, tokens: 32, streak: 2, streakKind: 'loss', health: 38 },

    // r6 practice: 15 + i(32)=3 + sb(loss,2)=2 = 20 -> 52 ; PvE: no streak change, no health change
    { round: 6, type: 'practice', result: 'win', rawLoss: 0, spend: 0, income: 20, tokens: 52, streak: 2, streakKind: 'loss', health: 38 },

    // r7 battle TIE: 15 + i(52)=5 + sb(loss,2)=2 = 22 -> 74 ; +3 comp -> 77 ; tie leaves streak (loss/2) ; 38-3=35
    { round: 7, type: 'battle', result: 'tie', rawLoss: 3, spend: 0, income: 22, tokens: 77, streak: 2, streakKind: 'loss', health: 35 },

    // r8 battle WIN: 15 + i(77)=5 + sb(loss,2)=2 = 22 -> 99 ; +2 -> 101 ; loss/2 -> win/1
    { round: 8, type: 'battle', result: 'win', rawLoss: 0, spend: 0, income: 22, tokens: 101, streak: 1, streakKind: 'win', health: 35 },

    // r9 battle WIN: 15 + i(101)=5 + sb(win,1)=1 = 21 -> 122 ; +2 -> 124 ; win/1->win/2
    { round: 9, type: 'battle', result: 'win', rawLoss: 0, spend: 0, income: 21, tokens: 124, streak: 2, streakKind: 'win', health: 35 },

    // r10 battle WIN: 15 + i(124)=5 + sb(win,2)=2 = 22 -> 146 ; +2 -> 148 ; win/2->win/3
    { round: 10, type: 'battle', result: 'win', rawLoss: 0, spend: 0, income: 22, tokens: 148, streak: 3, streakKind: 'win', health: 35 },

    // r11 practice: 15 + i(148)=5 + sb(win,3)=3 = 23 -> 171 ; PvE: streak/health unchanged
    { round: 11, type: 'practice', result: 'win', rawLoss: 0, spend: 0, income: 23, tokens: 171, streak: 3, streakKind: 'win', health: 35 },

    // r12 battle WIN: 15 + i(171)=5 + sb(win,3)=3 = 23 -> 194 ; +2 -> 196 ; win/3->win/4
    { round: 12, type: 'battle', result: 'win', rawLoss: 0, spend: 0, income: 23, tokens: 196, streak: 4, streakKind: 'win', health: 35 },
  ];

  it('matches the hand-computed table row for row', () => {
    const s = state(1, player({ tokens: STARTING_TOKENS }));
    const p = s.players[0]! as TPlayer & { health: number };
    p.health = 50;

    for (const row of LEDGER) {
      s.round = row.round;

      const beforeIncome = p.tokens;
      applyRoundStartIncome(s);
      expect(p.tokens - beforeIncome, `r${row.round} income`).toBe(row.income);
      if (row.round >= 2) {
        expect(p.tokens - beforeIncome, `r${row.round} income == previewIncome`).toBe(
          // previewIncome recomputed on the pre-income balance
          previewIncome(state(row.round, player({ tokens: beforeIncome, streak: p.streak, streakKind: p.streakKind })), 0).total,
        );
      }

      if (row.spend > 0) {
        expect(spend(s, 0, row.spend), `r${row.round} spend`).toBe(true);
      }

      // mirror match.ts: apply the raw HP loss, then hand the result to economy
      const healthBefore = p.health;
      if (row.rawLoss > 0) p.health -= row.rawLoss;
      applyBattleResolution(s, {
        playerId: 0,
        result: row.result,
        matchupKind: row.type === 'practice' ? 'pve' : 'pvp',
        healthBefore,
        rawHealthLoss: row.rawLoss,
      });

      expect(p.tokens, `r${row.round} tokens`).toBe(row.tokens);
      expect(p.streak, `r${row.round} streak`).toBe(row.streak);
      expect(p.streakKind, `r${row.round} streakKind`).toBe(row.streakKind);
      expect(p.health, `r${row.round} health`).toBe(row.health);
    }

    // sanity: the streak bonus never exceeded the cap across the whole ledger
    expect(streakBonus(p.streakKind, p.streak)).toBe(CAP - 1); // min(4, 4) = 4
    expect(BASE).toBe(BASE_INCOME);
  });
});

// ---------------------------------------------------------------------------
// Integration through runMatch — the seam is really wired
// ---------------------------------------------------------------------------

const stub = (): CombatResolver => createStubCombatResolver();

function forcedLoserResolver(loserId: number): CombatResolver {
  return {
    resolve(ctx: CombatContext): CombatOutcome {
      if (ctx.matchupKind === 'pve') return { result: 'win', survivingUnits: 6 };
      if (ctx.matchupKind === 'phantom' || ctx.matchupKind === 'mirror') {
        return { result: 'loss', survivingUnits: 6 };
      }
      if (ctx.sideA.playerId === loserId) return { result: 'loss', survivingUnits: 6 };
      if (ctx.sideB.playerId === loserId) return { result: 'win', survivingUnits: 6 };
      return { result: 'tie', survivingUnits: 1 };
    },
  };
}

describe('economy wired into match.ts', () => {
  it('start at 10; round 1 pays no income; round-2 income lands per previewIncome', () => {
    // M7 wires the shop into the Module Draw phase, so bots may spend from round
    // 1 (e.g. the Protocol Rusher dumps its 10 starting tokens). The economy
    // engine is unchanged; this asserts the INCOME wiring via each player's
    // spend-agnostic `tokenLedger.earned`, plus the literal balances on the
    // human seat, which takes no shop actions.
    expect(STARTING_TOKENS).toBe(10);
    for (const seed of [1, 7, 2024]) {
      const res = runMatch(seed, [], stub());
      const human = res.boundaries[0]!.state.players.findIndex((p) => p.isHuman);

      expect(res.boundaries[0]!.state.players.every((p) => p.tokens === 10), `seed ${seed} draft`).toBe(true);

      const oneOne = res.boundaries.find((b) => b.label === '1-1')!;
      expect(oneOne.state.players[human]!.tokens, `seed ${seed} 1-1 human`).toBe(10);
      expect(
        oneOne.state.players.every((p) => p.tokenLedger.earned === 10),
        `seed ${seed} 1-1 no income earned`,
      ).toBe(true);

      const oneFour = res.boundaries.find((b) => b.label === '1-4')!; // end of the Practice round
      const twoOne = res.boundaries.find((b) => b.label === '2-1')!;
      for (const p of twoOne.state.players) {
        const grant = previewIncome(oneFour.state, p.id).total;
        const earnedDelta = p.tokenLedger.earned - oneFour.state.players[p.id]!.tokenLedger.earned;
        expect(earnedDelta, `seed ${seed} p${p.id} round-2 income into ledger`).toBe(grant);
      }
      expect(twoOne.state.players[human]!.tokens, `seed ${seed} 2-1 human`).toBe(26); // 10 + 15 + floor(10/10)
    }
  });

  it('an eliminated player accrues nothing for the rest of a full simulated match', () => {
    const res = runMatch(2024, [], forcedLoserResolver(3));
    const p3 = res.finalState.players[3]!;
    expect(p3.alive).toBe(false);
    const elim = p3.eliminatedRound!;

    // p3's tokens at the last boundary of their elimination round
    const lastOfElim = [...res.boundaries].reverse().find((b) => b.round === elim)!;
    const frozen = lastOfElim.state.players[3]!.tokens;
    expect(frozen).toBeGreaterThan(STARTING_TOKENS); // they did earn while alive (income + lots of compensation)

    for (const b of res.boundaries) {
      if (b.round > elim) {
        expect(b.state.players[3]!.tokens, `p3 frozen @${b.label}`).toBe(frozen);
      }
    }
    expect(res.finalState.players[3]!.tokens).toBe(frozen);
  });

  it('the HUD-facing previewIncome stays consistent for every player at every boundary (500-state sweep)', () => {
    let checked = 0;
    for (const seed of [11, 222, 3333, 44444, 555555]) {
      const res = runMatch(seed, [], stub());
      for (const b of res.boundaries) {
        for (const p of b.state.players) {
          const bd = previewIncome(b.state, p.id);
          expect(bd.total).toBe(bd.base + bd.interest + bd.streak);
          if (!p.alive) {
            expect(bd).toEqual({ base: 0, interest: 0, streak: 0, total: 0 });
          } else {
            expect(bd.base).toBe(BASE_INCOME);
            expect(bd.interest).toBe(interest(p.tokens));
            expect(bd.streak).toBe(streakBonus(p.streakKind, p.streak));
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
