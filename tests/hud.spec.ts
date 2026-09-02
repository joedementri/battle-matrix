import { describe, expect, it } from 'vitest';

import * as S from '../src/data/strings';
import { CHANGE_HERO_COST } from '../src/data/constants';
import heroesJson from '../src/data/heroes.json';
import type { Protocol } from '../src/data/types';

import { previewIncome } from '../src/sim/economy';
import { runMatch } from '../src/sim/match';
import {
  PROTOCOLS,
  levelsFromXp,
  rarityOdds,
  totalStrengthen,
} from '../src/sim/modules';
import type { ProtocolLevels, ShopCard, ShopState } from '../src/sim/modules';
import { leftRailMeter } from '../src/sim/selectors';
import { createStubCombatResolver } from '../src/sim/stubCombat';
import type { MatchState } from '../src/sim/types';

import { leftRailVM } from '../src/ui/viewmodels/chrome';
import { incomePreviewVM, rarityOddsVM, shopCardVM, shopVM } from '../src/ui/viewmodels/shop';
import { changeHeroCardsVM, swapOutVM } from '../src/ui/viewmodels/changeHero';
import { scoreboardVM } from '../src/ui/viewmodels/scoreboard';

/*
 * M8 `tests/hud.spec.ts` — every screenshot-derived assertion tested against the
 * PURE VIEW MODELS (no DOM). Reference numbers are transcribed independently
 * from the plan / screenshots, never pasted from the implementation.
 */

const HERO_IDS = (heroesJson as unknown as { id: string }[]).map((h) => h.id);

// ---------------------------------------------------------------------------
// 1. HUD income preview === economy.previewIncome  (500-state sweep)
// ---------------------------------------------------------------------------

describe('income preview equals economy.previewIncome', () => {
  it('matches for every player at every phase boundary across several matches (>500 states)', () => {
    let checked = 0;
    for (const seed of [1, 77, 4242, 90210, 700007]) {
      const res = runMatch(seed, [], createStubCombatResolver());
      for (const b of res.boundaries) {
        for (const p of b.state.players) {
          const vm = incomePreviewVM(b.state, p.id);
          expect(vm.preview, `seed ${seed} @${b.label} p${p.id}`).toBe(previewIncome(b.state, p.id).total);
          expect(vm.text).toBe(S.incomePreview(vm.tokens, vm.preview));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// 2. rarity-odds row === modules.rarityOdds  (every protocol-level combination)
// ---------------------------------------------------------------------------

describe('rarity-odds row equals modules.rarityOdds for every protocol-level combination', () => {
  it('all 256 combinations of the four protocols at levels 0..3', () => {
    for (let f = 0; f <= 3; f += 1)
      for (let o = 0; o <= 3; o += 1)
        for (let r = 0; r <= 3; r += 1)
          for (let e = 0; e <= 3; e += 1) {
            const levels: ProtocolLevels = { fortress: f, onslaught: o, reboot: r, equilibrium: e };
            const vm = rarityOddsVM(levels);
            const odds = rarityOdds(levels);
            expect(vm).toMatchObject({ common: odds.common, rare: odds.rare, legendary: odds.legendary });
          }
  });

  it('reproduces the three observed odds rows exactly (100/0/0, 86.5/12.0/1.5, 81.0/16.0/3.0)', () => {
    expect(rarityOddsVM({ fortress: 0, onslaught: 0, reboot: 0, equilibrium: 0 })).toMatchObject({
      commonText: '100%',
      rareText: '0%',
      legendaryText: '0%',
    });
    // Σlevels 3, one protocol at L2  ->  86.5 / 12.0 / 1.5
    expect(rarityOddsVM({ fortress: 2, onslaught: 1, reboot: 0, equilibrium: 0 })).toMatchObject({
      commonText: '86.5%',
      rareText: '12.0%',
      legendaryText: '1.5%',
    });
    // Reboot L2 + Equilibrium L2 (Σ4)  ->  81.0 / 16.0 / 3.0
    expect(rarityOddsVM({ fortress: 0, onslaught: 0, reboot: 2, equilibrium: 2 })).toMatchObject({
      commonText: '81.0%',
      rareText: '16.0%',
      legendaryText: '3.0%',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. left-rail meter + level badge at every XP value 0..60
// ---------------------------------------------------------------------------

function stubStateWithXp(xp: number): MatchState {
  const player = {
    id: 0,
    protocolXp: { fortress: xp, onslaught: xp, reboot: xp, equilibrium: xp },
    strengthen: { equipped: {}, selectable: [] },
  };
  return { players: [player] } as unknown as MatchState;
}

describe('left-rail meters read xp/nextThreshold with the correct level badge (XP 0..60)', () => {
  it('badge and meter text over the whole 0..60 range (thresholds 10 / 20 / 40)', () => {
    for (let xp = 0; xp <= 60; xp += 1) {
      // independent expected table
      let level: number;
      let denom: number;
      if (xp < 10) {
        level = 0;
        denom = 10;
      } else if (xp < 20) {
        level = 1;
        denom = 20;
      } else if (xp < 40) {
        level = 2;
        denom = 40;
      } else {
        level = 3;
        denom = 40;
      }

      const meter = leftRailMeter(xp);
      expect(meter.level, `xp ${xp} badge`).toBe(level);
      expect(meter.nextThreshold, `xp ${xp} denom`).toBe(denom);
      expect(meter.atMax).toBe(xp >= 40);

      const proto = leftRailVM(stubStateWithXp(xp), 0).protocols[0]!;
      expect(proto.badge).toBe(level);
      expect(proto.meterText).toBe(S.xpMeter(xp, denom));
      expect(proto.meterText).toBe(`${xp}/${denom}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. shop cards — PURCHASE vs UPGRADE, level-1 value, star row to OWNED level,
//    price red exactly when tokens < price
// ---------------------------------------------------------------------------

function card(over: Partial<ShopCard> & Pick<ShopCard, 'moduleId'>): ShopCard {
  return {
    protocol: 'fortress',
    rarity: 'common',
    action: 'purchase',
    ownedStars: 0,
    maxStars: 6,
    price: 5,
    ...over,
  } as ShopCard;
}

describe('shop card view model', () => {
  it('Fortress Health Expansion shows the level-1 value 90.0 (flat)', () => {
    const vm = shopCardVM(card({ moduleId: 'fortress-health-expansion' }), 20);
    expect(vm.valueText).toBe('90.0');
    expect(vm.isPercent).toBe(false);
    expect(vm.label).toBe(S.BTN_PURCHASE);
  });

  it('Onslaught Charge Acceleration shows 20.0 % — the level-1 value regardless of owned stars', () => {
    const vm = shopCardVM(
      card({
        moduleId: 'onslaught-charge-acceleration',
        protocol: 'onslaught',
        action: 'upgrade',
        ownedStars: 3,
      }),
      20,
    );
    expect(vm.valueText).toBe('20.0'); // NOT the 4-star cumulative value
    expect(vm.isPercent).toBe(true);
    expect(vm.label).toBe(S.BTN_UPGRADE);
  });

  it('label is PURCHASE at 0 owned stars, UPGRADE above 0', () => {
    expect(shopCardVM(card({ moduleId: 'fortress-health-expansion', ownedStars: 0 }), 20).label).toBe(
      S.BTN_PURCHASE,
    );
    expect(
      shopCardVM(card({ moduleId: 'fortress-health-expansion', ownedStars: 2, action: 'upgrade' }), 20).label,
    ).toBe(S.BTN_UPGRADE);
  });

  it('the star row is filled to the OWNED level, next star highlighted, total = maxStars', () => {
    const vm = shopCardVM(
      card({ moduleId: 'fortress-health-expansion', ownedStars: 2, action: 'upgrade' }),
      20,
    );
    expect(vm.starsFilled).toBe(2);
    expect(vm.starsTotal).toBe(6);
    expect(vm.stars.filter((s) => s.state === 'filled').length).toBe(2);
    expect(vm.stars.filter((s) => s.state === 'next').length).toBe(1);
    expect(vm.stars[2]!.state).toBe('next');
    expect(vm.nextStarHighlighted).toBe(true);
  });

  it('price renders red exactly when tokens < price', () => {
    const c = card({ moduleId: 'fortress-health-expansion', price: 5 });
    expect(shopCardVM(c, 4).priceIsRed).toBe(true);
    expect(shopCardVM(c, 5).priceIsRed).toBe(false);
    expect(shopCardVM(c, 6).priceIsRed).toBe(false);
    expect(shopCardVM(c, 0).priceIsRed).toBe(true);
  });

  it('an empty slot is marked empty with no label / value / price', () => {
    const vm = shopCardVM(null, 20);
    expect(vm.empty).toBe(true);
    expect(vm.label).toBeNull();
    expect(vm.valueText).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 5. a purchased card's slot empties and stays empty for the phase
// ---------------------------------------------------------------------------

describe('a purchased shop slot empties and stays empty for the phase', () => {
  it('after buyModule(0) on round 1, slot 0 is null at the 1-1 boundary and the VM marks it empty', () => {
    // action list: draft times out (auto lineup), then the Module Draw phase buys slot 0.
    const res = runMatch(
      20250606,
      [{ type: 'advanceTimer' }, { type: 'buyModule', slot: 0 }],
      createStubCombatResolver(),
    );
    const oneOne = res.boundaries.find((b) => b.label === '1-1')!;
    const human = oneOne.state.players.find((p) => p.isHuman)!;
    expect(human.shop).not.toBeNull();
    expect(human.shop!.slots[0]).toBeNull();
    const vm = shopVM(oneOne.state, human.id);
    expect(vm.cards[0]!.empty).toBe(true);
    // and it has not refilled
    expect(vm.cards.filter((c) => c.empty).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. LOCK disables REFRESH and badges all four cards
// ---------------------------------------------------------------------------

function stubStateWithShop(shop: ShopState, tokens: number): MatchState {
  const player = {
    id: 0,
    isHuman: true,
    tokens,
    alive: true,
    shop,
    protocolXp: { fortress: 0, onslaught: 0, reboot: 0, equilibrium: 0 },
    streak: 0,
    streakKind: 'none',
  };
  return { round: 3, players: [player] } as unknown as MatchState;
}

describe('LOCK disables REFRESH and shows the padlock on all four cards', () => {
  const four: (ShopCard | null)[] = [0, 1, 2, 3].map((i) =>
    card({ moduleId: 'fortress-health-expansion', ownedStars: i === 0 ? 0 : 0 }),
  );

  it('locked: refresh disabled, footnote shown, UNLOCK label, every card locked', () => {
    const vm = shopVM(stubStateWithShop({ round: 3, slots: four, locked: true }, 50), 0);
    expect(vm.locked).toBe(true);
    expect(vm.refreshEnabled).toBe(false);
    expect(vm.footnote).toBe(S.LOCKED_MODULES_FOOTER);
    expect(vm.lockLabel).toBe(S.BTN_UNLOCK);
    expect(vm.cards.every((c) => c.locked)).toBe(true);
  });

  it('unlocked with tokens for a refresh: refresh enabled, no footnote, LOCK label', () => {
    const vm = shopVM(stubStateWithShop({ round: 3, slots: four, locked: false }, 50), 0);
    expect(vm.refreshEnabled).toBe(true);
    expect(vm.footnote).toBeNull();
    expect(vm.lockLabel).toBe(S.BTN_LOCK);
    expect(vm.cards.every((c) => !c.locked)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Change-Hero cards read "Choose One of 3/6/3 Random …" matching the role
// ---------------------------------------------------------------------------

describe('Change-Hero role cards read 3 / 6 / 3 by role', () => {
  it('offer sizes and copy', () => {
    const cards = changeHeroCardsVM();
    expect(cards.map((c) => c.role)).toEqual(['vanguard', 'duelist', 'strategist']);
    expect(cards.map((c) => c.offerSize)).toEqual([3, 6, 3]);
    expect(cards.map((c) => c.price)).toEqual([CHANGE_HERO_COST, CHANGE_HERO_COST, CHANGE_HERO_COST]);
    expect(cards[0]!.bodyText).toBe('Choose One of 3 Random Vanguards to Replace a Current Hero');
    expect(cards[1]!.bodyText).toBe('Choose One of 6 Random Duelists to Replace a Current Hero');
    expect(cards[2]!.bodyText).toBe('Choose One of 3 Random Strategists to Replace a Current Hero');
    expect(cards[0]!.titleText).toBe('CHOOSE VANGUARD');
    expect(cards[1]!.titleText).toBe('CHOOSE DUELIST');
    expect(cards[2]!.titleText).toBe('CHOOSE STRATEGIST');
  });
});

// ---------------------------------------------------------------------------
// 8. swap-out shows Reserve above Active and blocks confirm until one of each
// ---------------------------------------------------------------------------

describe('swap-out view model', () => {
  const lineup = HERO_IDS.slice(0, 6);
  const offers = HERO_IDS.slice(6, 9);
  const strengthen = { equipped: { [lineup[0]!]: ['s1', 's2'] }, selectable: [] as string[] };

  it('Reserve row is rendered above Active row', () => {
    const vm = swapOutVM(lineup, strengthen, offers, { incoming: null, outgoing: null });
    expect(vm.rowOrder).toEqual(['reserve', 'active']);
    expect(vm.reserveLabel).toBe(S.RESERVE_HEROES);
    expect(vm.activeLabel).toBe(S.ACTIVE_HEROES);
    expect(vm.reserve.map((p) => p.heroId)).toEqual(offers);
    expect(vm.active.map((p) => p.heroId)).toEqual(lineup);
    expect(vm.active[0]!.strengthenPips).toBe(2);
  });

  it('confirm is blocked until exactly one reserve and one active hero are selected', () => {
    const base = { lineup, strengthen, offers };
    expect(
      swapOutVM(base.lineup, base.strengthen, base.offers, { incoming: null, outgoing: null }).confirmEnabled,
    ).toBe(false);
    expect(
      swapOutVM(base.lineup, base.strengthen, base.offers, { incoming: offers[0]!, outgoing: null }).confirmEnabled,
    ).toBe(false);
    expect(
      swapOutVM(base.lineup, base.strengthen, base.offers, { incoming: null, outgoing: lineup[0]! }).confirmEnabled,
    ).toBe(false);
    expect(
      swapOutVM(base.lineup, base.strengthen, base.offers, { incoming: 'not-an-offer', outgoing: lineup[0]! })
        .confirmEnabled,
    ).toBe(false);
    expect(
      swapOutVM(base.lineup, base.strengthen, base.offers, { incoming: offers[0]!, outgoing: lineup[0]! })
        .confirmEnabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. scoreboard: six lineups, four protocol levels, Strengthen counts, top-3 divider
// ---------------------------------------------------------------------------

describe('scoreboard view model', () => {
  it('renders all six players fully public with the top-3 divider', () => {
    const res = runMatch(31337, [], createStubCombatResolver());
    // a mid-match in-round boundary (round >= 4 so builds have diverged)
    const b = res.boundaries.find((x) => x.round >= 4 && x.phase === 1)!;
    const vm = scoreboardVM(b.state);

    expect(vm.columns).toEqual([S.COL_RANK, S.COL_PLAYER_NAME, S.COL_DEPLOY, S.COL_INITIATE_PROTOCOL]);
    expect(vm.rows.length).toBe(6);
    expect(vm.dividerAfterIndex).toBe(3);

    vm.rows.forEach((row, index) => {
      const player = b.state.players[row.playerId]!;
      expect(row.deploy.length).toBe(6);
      expect(row.protocols.length).toBe(4);
      expect(row.protocols.map((p) => p.protocol).sort()).toEqual([...PROTOCOLS].sort());
      const levels = levelsFromXp(player.protocolXp);
      for (const proto of row.protocols) {
        expect(proto.level).toBe(levels[proto.protocol as Protocol]);
      }
      expect(row.strengthenCount).toBe(totalStrengthen(player.strengthen));
      expect(row.tokens).toBe(player.tokens);
      expect(row.dimmed).toBe(index >= 3);
      expect(row.rank).toBe(index + 1);
    });
  });
});
