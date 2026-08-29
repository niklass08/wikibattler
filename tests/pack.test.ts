import { describe, it, expect } from 'vitest';
import {
  generatePack,
  rollUpgrades,
  upgradeChance,
  splitByRarity,
  seededRng,
  PACK_SIZE,
  PACK_BASE,
  type RarityPools
} from '../src/lib/pack';
import { RARITIES, type Card, type Rarity } from '../src/lib/types';

function makeCard(id: number, rarity: Rarity): Card {
  return {
    id,
    title: `Card ${id}`,
    url: '',
    extract: '',
    image: null,
    rarity,
    strength: 10,
    defence: 10,
    foil: 0,
    negated: false,
    tags: [],
    raw: { links: 0, bytes: 0, monthlyViews: 0 }
  };
}

function fullPools(): RarityPools {
  const cards: Card[] = [];
  let id = 1;
  const add = (r: Rarity, n: number) => {
    for (let i = 0; i < n; i++) cards.push(makeCard(id++, r));
  };
  add('common', 400);
  add('uncommon', 160);
  add('rare', 80);
  add('mythic', 40);
  return splitByRarity(cards);
}

const rank = (r: Rarity) => RARITIES.indexOf(r);

describe('rollUpgrades', () => {
  it('never demotes and stops at mythic', () => {
    for (let seed = 0; seed < 200; seed++) {
      const out = rollUpgrades('uncommon', 6, seededRng(seed));
      expect(rank(out)).toBeGreaterThanOrEqual(rank('uncommon'));
    }
  });

  it('deeper slots upgrade more often', () => {
    const rate = (depth: number) => {
      let up = 0;
      for (let s = 0; s < 4000; s++) if (rollUpgrades('common', depth, seededRng(s)) !== 'common') up++;
      return up / 4000;
    };
    expect(rate(6)).toBeGreaterThan(rate(0) + 0.05);
  });

  it('upgradeChance increases with depth', () => {
    expect(upgradeChance(6)).toBeGreaterThan(upgradeChance(0));
  });
});

describe('generatePack', () => {
  it('returns exactly PACK_SIZE distinct cards', () => {
    const pools = fullPools();
    for (let i = 0; i < 50; i++) {
      const pack = generatePack(pools, seededRng(i));
      expect(pack).toHaveLength(PACK_SIZE);
      expect(new Set(pack.map((c) => c.id)).size).toBe(PACK_SIZE);
    }
  });

  it('always has a rare-or-better as the last card', () => {
    const pools = fullPools();
    for (let i = 0; i < 300; i++) {
      const pack = generatePack(pools, seededRng(i * 7 + 1));
      expect(rank(pack[PACK_SIZE - 1].rarity)).toBeGreaterThanOrEqual(rank('rare'));
    }
  });

  it('never has a slot below its base rarity', () => {
    const pools = fullPools();
    for (let i = 0; i < 300; i++) {
      const pack = generatePack(pools, seededRng(i + 500));
      pack.forEach((c, slot) => expect(rank(c.rarity)).toBeGreaterThanOrEqual(rank(PACK_BASE[slot])));
    }
  });

  it('is modally 4 common / 2 uncommon / 1 rare', () => {
    const pools = fullPools();
    let base = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const c = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
      for (const card of generatePack(pools, seededRng(i))) c[card.rarity]++;
      if (c.common === 4 && c.uncommon === 2 && c.rare === 1) base++;
    }
    // the exact base pack should be the single most likely outcome, comfortably
    expect(base / N).toBeGreaterThan(0.33);
  });

  it('produces some mythics, and upgrades beyond the chase, over many packs', () => {
    const pools = fullPools();
    let mythicPacks = 0;
    let extraRarePacks = 0;
    for (let i = 0; i < 2000; i++) {
      const pack = generatePack(pools, seededRng(i + 1000));
      if (pack.some((c) => c.rarity === 'mythic')) mythicPacks++;
      const rares = pack.filter((c) => c.rarity === 'rare' || c.rarity === 'mythic').length;
      if (rares > 1) extraRarePacks++;
    }
    expect(mythicPacks).toBeGreaterThan(50);
    expect(mythicPacks).toBeLessThan(1000);
    expect(extraRarePacks).toBeGreaterThan(20);
  });

  it('is deterministic for a fixed seed', () => {
    const pools = fullPools();
    const a = generatePack(pools, seededRng(99)).map((c) => c.id);
    const b = generatePack(pools, seededRng(99)).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('degrades gracefully when a bucket is empty', () => {
    const cards = Array.from({ length: 10 }, (_, i) => makeCard(i + 1, 'common'));
    const pack = generatePack(splitByRarity(cards), seededRng(1));
    expect(pack).toHaveLength(PACK_SIZE);
    expect(new Set(pack.map((c) => c.id)).size).toBe(PACK_SIZE);
  });
});
