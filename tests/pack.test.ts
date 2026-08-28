import { describe, it, expect } from 'vitest';
import {
  generatePack,
  splitByRarity,
  seededRng,
  PACK_SIZE,
  type RarityPools
} from '../src/lib/pack';
import type { Card, Rarity } from '../src/lib/types';

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
    raw: { links: 0, bytes: 0, monthlyViews: 0 }
  };
}

function fullPools(): RarityPools {
  const cards: Card[] = [];
  let id = 1;
  const add = (r: Rarity, n: number) => {
    for (let i = 0; i < n; i++) cards.push(makeCard(id++, r));
  };
  add('common', 200);
  add('uncommon', 80);
  add('rare', 30);
  add('mythic', 8);
  return splitByRarity(cards);
}

describe('generatePack', () => {
  it('returns exactly PACK_SIZE distinct cards', () => {
    const pools = fullPools();
    for (let i = 0; i < 50; i++) {
      const pack = generatePack(pools, seededRng(i));
      expect(pack).toHaveLength(PACK_SIZE);
      expect(new Set(pack.map((c) => c.id)).size).toBe(PACK_SIZE);
    }
  });

  it('guarantees 4 common, 2 uncommon, 1 rare-or-better', () => {
    const pools = fullPools();
    for (let i = 0; i < 200; i++) {
      const pack = generatePack(pools, seededRng(i * 7 + 1));
      const counts = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
      for (const c of pack) counts[c.rarity]++;
      expect(counts.common).toBe(4);
      expect(counts.uncommon).toBe(2);
      expect(counts.rare + counts.mythic).toBe(1);
    }
  });

  it('produces at least some mythic chases over many packs', () => {
    const pools = fullPools();
    let mythics = 0;
    for (let i = 0; i < 400; i++) {
      const pack = generatePack(pools, seededRng(i + 1000));
      if (pack.some((c) => c.rarity === 'mythic')) mythics++;
    }
    // ~1/8 expected; just assert the upgrade path is reachable and not universal
    expect(mythics).toBeGreaterThan(10);
    expect(mythics).toBeLessThan(200);
  });

  it('is deterministic for a fixed seed', () => {
    const pools = fullPools();
    const a = generatePack(pools, seededRng(99)).map((c) => c.id);
    const b = generatePack(pools, seededRng(99)).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('degrades gracefully when a bucket is empty', () => {
    const cards = [
      ...Array.from({ length: 10 }, (_, i) => makeCard(i + 1, 'common'))
    ];
    const pools = splitByRarity(cards);
    const pack = generatePack(pools, seededRng(1));
    expect(pack).toHaveLength(PACK_SIZE);
    expect(new Set(pack.map((c) => c.id)).size).toBe(PACK_SIZE);
  });
});
