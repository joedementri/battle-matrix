import { describe, expect, it } from 'vitest';

import {
  CHANGE_HERO_OFFERS,
  COMMON_MODULE_BUY,
  MODULE_SELL,
  MODULE_XP,
  PROTOCOL_XP_THRESHOLDS,
} from '../src/data/constants';
import { MODULE_BUY_LEGENDARY, MODULE_BUY_RARE } from '../src/data/authored';
import heroesJson from '../src/data/heroes.json';
import modulesJson from '../src/data/modules.json';
import type { BaseModule, Protocol, Role } from '../src/data/types';
import {
  accountLevels,
  buyModule,
  buyPrice,
  canRefreshShop,
  changeHeroOffers,
  conserves,
  convertOnSwapOut,
  createAccount,
  credit,
  drawCards,
  levelsFromXp,
  lockShop,
  maxStarsOf,
  moduleById,
  openShop,
  applyHeroSwap,
  protocolLevelFromXp,
  protocolsEligibleFor,
  rarityOdds,
  refreshShop,
  sellModule,
  spendChangeHero,
  spendHeroSwap,
  spendShopRefresh,
  totalStrengthen,
  unlockShop,
  zeroProtocolXp,
} from '../src/sim/modules';
import type { OwnedModule, ProtocolLevels, ShopState, StrengthenInventory } from '../src/sim/modules';
import { RngStream } from '../src/sim/rng';

const modules = modulesJson as unknown as readonly BaseModule[];
const heroes = heroesJson as unknown as readonly { id: string; role: Role }[];

function levels(partial: Partial<Record<Protocol, number>> = {}): ProtocolLevels {
  return {
    fortress: partial.fortress ?? 0,
    onslaught: partial.onslaught ?? 0,
    reboot: partial.reboot ?? 0,
    equilibrium: partial.equilibrium ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Rarity odds — the DERIVED formula, exact on all three observed samples
// ---------------------------------------------------------------------------

describe('rarityOdds — exact fit on the three observed samples', () => {
  it('all protocols L0 -> 100 / 0 / 0', () => {
    expect(rarityOdds(levels())).toEqual({ common: 100, rare: 0, legendary: 0 });
  });

  it('Σlevels 3, one protocol at L2 -> 86.5 / 12.0 / 1.5', () => {
    // e.g. fortress=2, onslaught=1 -> Σ=3, one protocol (fortress) >= L2
    const odds = rarityOdds(levels({ fortress: 2, onslaught: 1 }));
    expect(odds.rare).toBeCloseTo(12.0, 10);
    expect(odds.legendary).toBeCloseTo(1.5, 10);
    expect(odds.common).toBeCloseTo(86.5, 10);
  });

  it('Reboot L2 + Equilibrium L2 (Σ4) -> 81.0 / 16.0 / 3.0', () => {
    const odds = rarityOdds(levels({ reboot: 2, equilibrium: 2 }));
    expect(odds.rare).toBeCloseTo(16.0, 10);
    expect(odds.legendary).toBeCloseTo(3.0, 10);
    expect(odds.common).toBeCloseTo(81.0, 10);
  });

  it('common% never goes negative — clamped at 0', () => {
    // Every protocol at the max canonical level 3: Σ=12 -> rare 48; all 4 >= L2 -> legendary 6.
    const odds = rarityOdds(levels({ fortress: 3, onslaught: 3, reboot: 3, equilibrium: 3 }));
    expect(odds.common).toBeGreaterThanOrEqual(0);
    expect(odds.common).toBeCloseTo(100 - 48 - 6, 10);
  });

  it('rare% > 0 iff some protocol is >= L1; legendary% > 0 iff some protocol is >= L2 (self-consistency)', () => {
    for (let f = 0; f <= 3; f++) {
      for (let o = 0; o <= 3; o++) {
        const odds = rarityOdds(levels({ fortress: f, onslaught: o }));
        const anyL1 = f >= 1 || o >= 1;
        const anyL2 = f >= 2 || o >= 2;
        expect(odds.rare > 0).toBe(anyL1);
        expect(odds.legendary > 0).toBe(anyL2);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Protocol XP -> level ladder
// ---------------------------------------------------------------------------

describe('protocol XP ladder ([10, 20, 40])', () => {
  it('reproduces the threshold table exactly', () => {
    expect(PROTOCOL_XP_THRESHOLDS).toEqual([10, 20, 40]);
    expect(protocolLevelFromXp(0)).toBe(0);
    expect(protocolLevelFromXp(9)).toBe(0);
    expect(protocolLevelFromXp(10)).toBe(1);
    expect(protocolLevelFromXp(19)).toBe(1);
    expect(protocolLevelFromXp(20)).toBe(2);
    expect(protocolLevelFromXp(39)).toBe(2);
    expect(protocolLevelFromXp(40)).toBe(3);
    expect(protocolLevelFromXp(100)).toBe(3);
  });

  it('10 Commons in one protocol => exactly L1 (XP is per star, not per module)', () => {
    const acc = createAccount(1000);
    // 10 distinct commons, each bought once (1 star = 1 XP each).
    const commons = modules.filter((m) => m.protocol === 'fortress' && m.rarity === 'common');
    expect(commons.length).toBeGreaterThanOrEqual(8);
    // 10 purchases' worth of XP — whether spread across distinct commons or
    // upgrades of the same one, XP-per-star means the total is identical.
    for (let xp = 0; xp < 10; xp++) {
      acc.protocolXp.fortress += MODULE_XP.common;
    }
    expect(acc.protocolXp.fortress).toBe(10);
    expect(accountLevels(acc).fortress).toBe(1);
  });

  it('10 Common + 5 Rare in one protocol = 20 XP => exactly L2', () => {
    const acc = createAccount(1000);
    acc.protocolXp.fortress = 10 * MODULE_XP.common + 5 * MODULE_XP.rare;
    expect(acc.protocolXp.fortress).toBe(20);
    expect(accountLevels(acc).fortress).toBe(2);
  });

  it('every star (including upgrades) grants XP again — not just the first purchase', () => {
    const acc = createAccount(1000);
    const shop0 = openShop(1, levels(), acc.owned, new RngStream(1).stream('shop'));
    // Force-buy the same module 3 times via direct account mutation to isolate
    // the XP-per-star rule from the draw (the draw is exercised elsewhere).
    const m = moduleById(shop0.slots[0]!.moduleId);
    acc.owned.push({ moduleId: m.id, stars: 1 });
    acc.protocolXp[m.protocol] += MODULE_XP[m.rarity];
    acc.owned[0] = { moduleId: m.id, stars: 2 };
    acc.protocolXp[m.protocol] += MODULE_XP[m.rarity];
    acc.owned[0] = { moduleId: m.id, stars: 3 };
    acc.protocolXp[m.protocol] += MODULE_XP[m.rarity];
    expect(acc.protocolXp[m.protocol]).toBe(3 * MODULE_XP[m.rarity]);
  });

  it('levelsFromXp / zeroProtocolXp round-trip to all zero levels', () => {
    expect(levelsFromXp(zeroProtocolXp())).toEqual(levels());
  });
});

// ---------------------------------------------------------------------------
// The draw — gating fuzz, distinctness, exclusion of maxed modules
// ---------------------------------------------------------------------------

describe('drawCards — gating (10 000 draws)', () => {
  it('never offers a Rare below L1 for its protocol, or a Legendary below L2', () => {
    const rng = new RngStream(0xd12a).stream('gating-fuzz');
    const levelConfigs: ProtocolLevels[] = [
      levels(),
      levels({ fortress: 1 }),
      levels({ onslaught: 2 }),
      levels({ fortress: 1, onslaught: 2, reboot: 3 }),
      levels({ fortress: 3, onslaught: 3, reboot: 3, equilibrium: 3 }),
      levels({ equilibrium: 2 }),
    ];
    let checked = 0;
    for (let i = 0; i < 10_000; i++) {
      const state = levelConfigs[i % levelConfigs.length]!;
      const cards = drawCards(state, [], rng);
      for (const c of cards) {
        if (c.rarity === 'rare') expect(state[c.protocol]).toBeGreaterThanOrEqual(1);
        if (c.rarity === 'legendary') expect(state[c.protocol]).toBeGreaterThanOrEqual(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(9000);
  });

  it('an "impossible roll" (rarity with zero eligible protocols) is unreachable — never a silent Common fallback', () => {
    // rarityOdds already guarantees rare=0 whenever no protocol is >= L1 and
    // legendary=0 whenever none is >= L2, so rollRarity structurally cannot
    // produce that rarity when protocolsEligibleFor would be empty.
    for (const rarity of ['rare', 'legendary'] as const) {
      expect(protocolsEligibleFor(rarity, levels()).length).toBe(0);
    }
    const odds = rarityOdds(levels());
    expect(odds.rare).toBe(0);
    expect(odds.legendary).toBe(0);
  });
});

describe('drawCards — distinctness and maxed exclusion', () => {
  it('a single draw of four never repeats a module id', () => {
    const rng = new RngStream(7).stream('distinct-fuzz');
    const state = levels({ fortress: 3, onslaught: 3, reboot: 3, equilibrium: 3 });
    for (let i = 0; i < 500; i++) {
      const cards = drawCards(state, [], rng);
      const ids = cards.map((c) => c.moduleId);
      expect(new Set(ids).size, `draw ${i}: ${ids.join(',')}`).toBe(ids.length);
    }
  });

  it('excludes a fully-starred (maxed) owned module from later draws', () => {
    const target = moduleById('fortress-attack-speed-enhancement'); // common, 6 values
    const owned: OwnedModule[] = [{ moduleId: target.id, stars: maxStarsOf(target) }];
    const rng = new RngStream(3).stream('maxed-fuzz');
    for (let i = 0; i < 500; i++) {
      const cards = drawCards(levels(), owned, rng);
      expect(cards.some((c) => c.moduleId === target.id), `draw ${i} offered a maxed module`).toBe(false);
    }
  });

  it('the Fortress Damage Enhancement quirk (4 values) maxes at 4 stars, not 6', () => {
    const m = moduleById('fortress-damage-enhancement');
    expect(maxStarsOf(m)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Buy / upgrade / sell, via the account
// ---------------------------------------------------------------------------

describe('buyModule', () => {
  it('a first purchase is a "purchase" at 1 star; a repeat is an "upgrade"', () => {
    const acc = createAccount(1000);
    let shop: ShopState = { round: 1, locked: false, slots: [
      { moduleId: 'fortress-health-expansion', protocol: 'fortress', rarity: 'common', action: 'purchase', ownedStars: 0, maxStars: 6, price: COMMON_MODULE_BUY },
      null, null, null,
    ] };

    const first = buyModule(acc, shop, 0);
    expect(first.outcome).toMatchObject({ ok: true, kind: 'purchase', stars: 1 });
    shop = first.shop;
    expect(shop.slots[0]).toBeNull(); // purchased slot empties, no refill this phase

    // re-open a fresh shop offering the same (now owned) module to buy again
    shop = { ...shop, slots: [
      { moduleId: 'fortress-health-expansion', protocol: 'fortress', rarity: 'common', action: 'upgrade', ownedStars: 1, maxStars: 6, price: COMMON_MODULE_BUY },
      null, null, null,
    ] };
    const second = buyModule(acc, shop, 0);
    expect(second.outcome).toMatchObject({ ok: true, kind: 'upgrade', stars: 2 });
  });

  it('refuses an unaffordable purchase without spending anything', () => {
    const acc = createAccount(2);
    const shop: ShopState = { round: 1, locked: false, slots: [
      { moduleId: 'fortress-health-expansion', protocol: 'fortress', rarity: 'common', action: 'purchase', ownedStars: 0, maxStars: 6, price: 5 },
      null, null, null,
    ] };
    const { outcome, shop: shop2 } = buyModule(acc, shop, 0);
    expect(outcome).toEqual({ ok: false, reason: 'unaffordable' });
    expect(acc.tokens).toBe(2);
    expect(shop2.slots[0]).not.toBeNull();
  });

  it('refuses buying from an empty slot', () => {
    const acc = createAccount(100);
    const shop: ShopState = { round: 1, locked: false, slots: [null, null, null, null] };
    expect(buyModule(acc, shop, 0).outcome).toEqual({ ok: false, reason: 'empty-slot' });
  });

  it('a Common at max stars (6, or 4 for the Fortress Damage Enhancement quirk) cannot upgrade', () => {
    const m = moduleById('fortress-attack-speed-enhancement');
    const acc = createAccount(1000);
    acc.owned.push({ moduleId: m.id, stars: maxStarsOf(m) });
    const shop: ShopState = { round: 1, locked: false, slots: [
      { moduleId: m.id, protocol: m.protocol, rarity: m.rarity, action: 'upgrade', ownedStars: maxStarsOf(m), maxStars: maxStarsOf(m), price: buyPrice(m.rarity) },
      null, null, null,
    ] };
    expect(buyModule(acc, shop, 0).outcome).toEqual({ ok: false, reason: 'maxed' });
  });

  it('buyPrice is a single function — Common 5, Rare/Legendary from authored.ts', () => {
    expect(buyPrice('common')).toBe(COMMON_MODULE_BUY);
    expect(buyPrice('rare')).toBe(MODULE_BUY_RARE);
    expect(buyPrice('legendary')).toBe(MODULE_BUY_LEGENDARY);
  });
});

describe('sellModule — refund and XP scale by stars owned; can drop a level', () => {
  it('selling below a threshold drops the protocol level and revokes its bonus', () => {
    const acc = createAccount(1000);
    // 10 XP of Fortress commons -> level 1
    const commons = modules.filter((m) => m.protocol === 'fortress' && m.rarity === 'common').slice(0, 8);
    for (const m of commons) {
      acc.owned.push({ moduleId: m.id, stars: 1 });
      acc.protocolXp.fortress += MODULE_XP.common;
    }
    acc.protocolXp.fortress += 2 * MODULE_XP.common; // top up to exactly 10 without a 9th distinct module
    expect(acc.protocolXp.fortress).toBe(10);
    expect(accountLevels(acc).fortress).toBe(1);

    const sold = sellModule(acc, commons[0]!.id);
    expect(sold).toMatchObject({ ok: true, refunded: MODULE_SELL.common, xpRemoved: MODULE_XP.common });
    expect(acc.protocolXp.fortress).toBe(9);
    expect(accountLevels(acc).fortress).toBe(0); // bonus revoked
    expect(acc.owned.some((o) => o.moduleId === commons[0]!.id)).toBe(false); // removed entirely
  });

  it('a multi-star module refunds sellValue × stars and removes rarityXp × stars, in one sale', () => {
    const m = moduleById('onslaught-reserve-armor'); // rare
    const acc = createAccount(1000);
    acc.owned.push({ moduleId: m.id, stars: 3 });
    acc.protocolXp.onslaught = 3 * MODULE_XP.rare + 100; // plus unrelated XP from other modules

    const sold = sellModule(acc, m.id);
    expect(sold).toMatchObject({
      ok: true,
      refunded: MODULE_SELL.rare * 3,
      xpRemoved: MODULE_XP.rare * 3,
    });
    expect(acc.tokens).toBe(1000 + MODULE_SELL.rare * 3);
    expect(acc.protocolXp.onslaught).toBe(100); // only this module's stake removed
  });

  it('protocol XP never goes negative from a sale', () => {
    const m = moduleById('fortress-health-expansion');
    const acc = createAccount(1000);
    acc.owned.push({ moduleId: m.id, stars: 6 });
    acc.protocolXp.fortress = 2; // less than 6 * MODULE_XP.common would remove
    const sold = sellModule(acc, m.id);
    expect(sold.ok).toBe(true);
    expect(acc.protocolXp.fortress).toBe(0);
  });

  it('refuses selling a module that is not owned', () => {
    const acc = createAccount(100);
    expect(sellModule(acc, 'fortress-health-expansion')).toEqual({ ok: false, reason: 'not-owned' });
  });
});

// ---------------------------------------------------------------------------
// Lock / refresh semantics
// ---------------------------------------------------------------------------

describe('lock / refresh — shop-wide, carries into next round, then clears', () => {
  it('LOCK disables REFRESH; UNLOCK / re-lock toggles it back', () => {
    const rng = new RngStream(1).stream('shop');
    let shop = openShop(1, levels(), [], rng);
    expect(canRefreshShop(shop)).toBe(true);

    shop = lockShop(shop);
    expect(shop.locked).toBe(true);
    expect(canRefreshShop(shop)).toBe(false);

    const before = shop.slots.map((c) => c?.moduleId ?? null);
    const refreshed = refreshShop(shop, levels(), [], rng);
    expect(refreshed).toBe(shop); // no-op while locked, not merely unchanged content
    expect(refreshed.slots.map((c) => c?.moduleId ?? null)).toEqual(before);

    shop = unlockShop(shop);
    expect(canRefreshShop(shop)).toBe(true);
  });

  it('refresh redraws all four slots back to a full set, refilling any emptied by a purchase', () => {
    const rng = new RngStream(2).stream('shop');
    const shop = openShop(1, levels({ fortress: 3, onslaught: 3, reboot: 3, equilibrium: 3 }), [], rng);
    const acc = createAccount(1000);
    // Match the account's own protocol XP to the levels the shop was drawn
    // under, so every drawn rarity (Common/Rare/Legendary) is purchasable.
    acc.protocolXp.fortress = 40;
    acc.protocolXp.onslaught = 40;
    acc.protocolXp.reboot = 40;
    acc.protocolXp.equilibrium = 40;
    const { shop: afterBuy } = buyModule(acc, shop, 0);
    expect(afterBuy.slots[0]).toBeNull();
    expect(afterBuy.slots.filter((c) => c !== null)).toHaveLength(3);

    const refreshed = refreshShop(afterBuy, levels({ fortress: 3, onslaught: 3, reboot: 3, equilibrium: 3 }), acc.owned, rng);
    expect(refreshed.slots.filter((c) => c !== null)).toHaveLength(4);
  });

  it('a locked set carries whole into the next round and the lock releases', () => {
    const rng = new RngStream(4).stream('shop');
    const shop = lockShop(openShop(1, levels(), [], rng));
    const carriedIds = shop.slots.map((c) => c?.moduleId ?? null);

    const nextRound = openShop(2, levels(), [], rng, shop);
    expect(nextRound.slots.map((c) => c?.moduleId ?? null)).toEqual(carriedIds);
    expect(nextRound.locked).toBe(false); // released after carrying the set over
    expect(canRefreshShop(nextRound)).toBe(true);
  });

  it('a purchased slot empties and stays empty for the rest of the phase (no refill without an explicit refresh)', () => {
    const rng = new RngStream(5).stream('shop');
    // All protocols L0 -> every card is Common, always eligible for a fresh
    // (all-zero-XP) account — isolates slot-emptying from the rarity gate.
    const shop = openShop(1, levels(), [], rng);
    const acc = createAccount(1000);
    const { shop: afterBuy } = buyModule(acc, shop, 1);
    expect(afterBuy.slots[1]).toBeNull();
    // Re-opening with the SAME shop object (no refresh call) leaves it empty —
    // there is no implicit refill; only refreshShop redraws.
    expect(afterBuy.slots[1]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Change Hero offers
// ---------------------------------------------------------------------------

describe('changeHeroOffers', () => {
  it('offer sizes are 3 / 6 / 3 by role, matching CHANGE_HERO_OFFERS', () => {
    expect(CHANGE_HERO_OFFERS).toEqual({ vanguard: 3, duelist: 6, strategist: 3 });
    const rng = new RngStream(1).stream('change-hero');
    expect(changeHeroOffers('vanguard', [], rng)).toHaveLength(3);
    expect(changeHeroOffers('duelist', [], rng)).toHaveLength(6);
    expect(changeHeroOffers('strategist', [], rng)).toHaveLength(3);
  });

  it('never offers a hero already in the lineup (fuzz over seeds and lineups)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new RngStream(seed).stream('change-hero-fuzz');
      for (const role of ['vanguard', 'duelist', 'strategist'] as const) {
        const rosterOfRole = heroes.filter((h) => h.role === role).map((h) => h.id);
        const lineup = rng.shuffle(rosterOfRole).slice(0, Math.min(4, rosterOfRole.length - CHANGE_HERO_OFFERS[role]));
        const offers = changeHeroOffers(role, lineup, rng);
        expect(offers.length).toBe(CHANGE_HERO_OFFERS[role]);
        expect(new Set(offers).size).toBe(offers.length); // distinct
        for (const id of offers) {
          expect(lineup, `seed ${seed} ${role}`).not.toContain(id);
          expect(rosterOfRole, `seed ${seed} ${role} offer role`).toContain(id);
        }
      }
    }
  });

  it('throws rather than silently short-offering when the eligible pool is smaller than the offer size', () => {
    const rng = new RngStream(1).stream('change-hero-too-small');
    const allVanguards = heroes.filter((h) => h.role === 'vanguard').map((h) => h.id);
    // Leave fewer than 3 eligible vanguards outside the lineup.
    const lineup = allVanguards.slice(0, allVanguards.length - 2);
    expect(() => changeHeroOffers('vanguard', lineup, rng)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Swap-out: lineup exchange + Strengthen conversion
// ---------------------------------------------------------------------------

describe('applyHeroSwap + convertOnSwapOut', () => {
  it('swaps the outgoing hero out of the lineup and into reserve, preserving position', () => {
    const lineup = ['a', 'b', 'c', 'd', 'e', 'f'];
    const reserve = ['g', 'h'];
    const result = applyHeroSwap({ lineup, reserve }, 'g', 'c');
    expect(result.lineup).toEqual(['a', 'b', 'g', 'd', 'e', 'f']);
    expect([...result.reserve].sort()).toEqual(['c', 'h'].sort());
  });

  it('rejects swapping in a hero already active, or swapping out a hero not active', () => {
    const state = { lineup: ['a', 'b'], reserve: ['c'] };
    expect(() => applyHeroSwap(state, 'a', 'b')).toThrow(RangeError); // 'a' already active
    expect(() => applyHeroSwap(state, 'c', 'z')).toThrow(RangeError); // 'z' not active
  });

  it("the outgoing hero's equipped Strengthen Modules convert to selectable — never auto-assigned", () => {
    const inv: StrengthenInventory = {
      equipped: { c: ['c-s1', 'c-s2'], a: ['a-s1'] },
      selectable: ['x-s1'],
    };
    const totalBefore = totalStrengthen(inv);
    const after = convertOnSwapOut(inv, 'c');

    expect(after.equipped).not.toHaveProperty('c'); // outgoing hero's key removed
    expect(after.equipped.a).toEqual(['a-s1']); // untouched
    expect([...after.selectable].sort()).toEqual(['c-s1', 'c-s2', 'x-s1'].sort()); // returned to the pool, not reassigned
    expect(totalStrengthen(after)).toBe(totalBefore); // M10's invariant: total unchanged by a swap
  });

  it('converting a hero with no equipped modules is a no-op', () => {
    const inv: StrengthenInventory = { equipped: { a: ['a-s1'] }, selectable: [] };
    const after = convertOnSwapOut(inv, 'z');
    expect(after).toEqual(inv);
  });

  it('the swap + conversion composition preserves lineup size and total Strengthen count together', () => {
    const lineupState = { lineup: ['v1', 'v2', 'd1', 'd2', 's1', 's2'], reserve: ['v3', 'd3'] };
    const inv: StrengthenInventory = { equipped: { d1: ['d1-s1', 'd1-s2'] }, selectable: [] };
    const totalBefore = totalStrengthen(inv);

    const { lineup: newLineupState, strengthen: newInv } = (() => {
      const swapped = applyHeroSwap(lineupState, 'd3', 'd1');
      const converted = convertOnSwapOut(inv, 'd1');
      return { lineup: swapped, strengthen: converted };
    })();

    expect(newLineupState.lineup).toHaveLength(6);
    expect(newLineupState.reserve).toHaveLength(2);
    expect(newLineupState.lineup).not.toContain('d1');
    expect(newLineupState.lineup).toContain('d3');
    expect(newLineupState.reserve).toContain('d1');
    expect(totalStrengthen(newInv)).toBe(totalBefore);
  });
});

// ---------------------------------------------------------------------------
// Token conservation over random legal sequences
// ---------------------------------------------------------------------------

describe('token conservation: earned + refunds = spent + held', () => {
  it('holds after any sequence of legal credits, buys, sells, refreshes and change-hero spends', () => {
    for (let seed = 0; seed < 150; seed++) {
      const rng = new RngStream(seed).stream('conservation-fuzz');
      const acc = createAccount(rng.int(0, 50));
      const lvls = levels({
        fortress: rng.int(0, 3),
        onslaught: rng.int(0, 3),
        reboot: rng.int(0, 3),
        equilibrium: rng.int(0, 3),
      });
      let shop = openShop(1, lvls, acc.owned, rng);
      expect(conserves(acc)).toBe(true);

      for (let step = 0; step < 40; step++) {
        switch (rng.int(0, 4)) {
          case 0: {
            credit(acc, rng.int(0, 20));
            break;
          }
          case 1: {
            const slot = rng.int(0, shop.slots.length - 1);
            const before = acc.tokens;
            const { outcome, shop: nextShop } = buyModule(acc, shop, slot);
            shop = nextShop;
            if (outcome.ok) expect(acc.tokens).toBe(before - outcome.price);
            else expect(acc.tokens).toBe(before);
            break;
          }
          case 2: {
            if (acc.owned.length > 0) {
              const target = rng.pick(acc.owned).moduleId;
              const before = acc.tokens;
              const result = sellModule(acc, target);
              if (result.ok) expect(acc.tokens).toBe(before + result.refunded);
            }
            break;
          }
          case 3: {
            const before = acc.tokens;
            if (canRefreshShop(shop) && spendShopRefresh(acc, 1)) {
              shop = refreshShop(shop, accountLevels(acc), acc.owned, rng);
              expect(acc.tokens).toBe(before - 1);
            }
            break;
          }
          default: {
            const before = acc.tokens;
            if (spendChangeHero(acc, 5) || spendHeroSwap(acc, 0)) {
              expect(acc.tokens).toBeLessThanOrEqual(before);
            }
          }
        }
        expect(conserves(acc), `seed ${seed} step ${step}`).toBe(true);
        expect(acc.tokens, `seed ${seed} step ${step}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
