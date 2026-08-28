import { describe, it, expect } from 'vitest';
import { applyPackFoil, isGodPack, GOD_PACK_CHANCE } from '../src/lib/foil';
import { seededRng } from '../src/lib/pack';
import type { Card } from '../src/lib/types';

const mkPack = (): Card[] =>
  Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    title: `Card ${i}`,
    url: '',
    extract: '',
    image: null,
    rarity: 'common',
    strength: 1,
    defence: 1,
    foil: 0,
    tags: [],
    raw: { links: 0, bytes: 0, monthlyViews: 0 }
  }));

describe('applyPackFoil', () => {
  it('foils zero, one, or (god pack) all seven cards, each tier 1-3', () => {
    for (let seed = 0; seed < 400; seed++) {
      const out = applyPackFoil(mkPack(), seededRng(seed));
      const foils = out.filter((c) => c.foil > 0);
      expect([0, 1, 7]).toContain(foils.length);
      for (const c of foils) expect([1, 2, 3]).toContain(c.foil);
    }
  });

  it('is deterministic for a fixed seed and does not mutate the input', () => {
    const input = mkPack();
    const a = applyPackFoil(input, seededRng(42)).map((c) => c.foil);
    const b = applyPackFoil(mkPack(), seededRng(42)).map((c) => c.foil);
    expect(a).toEqual(b);
    expect(input.every((c) => c.foil === 0)).toBe(true);
  });

  it('produces exactly one foil roughly once every ~7 packs, skewed to tier 1', () => {
    const tiers = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    let singleFoil = 0;
    const N = 7000;
    for (let seed = 0; seed < N; seed++) {
      const foils = applyPackFoil(mkPack(), seededRng(seed)).filter((c) => c.foil > 0);
      if (foils.length === 1) {
        singleFoil++;
        tiers[foils[0].foil]++;
      }
    }
    const rate = singleFoil / N;
    // ~1/7 of the ~24/25 of packs that aren't god packs
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.17);
    expect(tiers[1]).toBeGreaterThan(tiers[2]);
    expect(tiers[2]).toBeGreaterThan(tiers[3]);
  });

  it('is a god pack (all 7 foiled) roughly 1 in 25', () => {
    let god = 0;
    const N = 25000;
    for (let seed = 0; seed < N; seed++) {
      if (isGodPack(applyPackFoil(mkPack(), seededRng(seed)))) god++;
    }
    const rate = god / N;
    expect(rate).toBeGreaterThan(GOD_PACK_CHANCE * 0.75);
    expect(rate).toBeLessThan(GOD_PACK_CHANCE * 1.25);
  });
});
