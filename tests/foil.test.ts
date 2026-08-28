import { describe, it, expect } from 'vitest';
import { applyPackFoil, FOIL_PACK_CHANCE } from '../src/lib/foil';
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
  it('foils at most one card, with a tier of 1-3', () => {
    for (let seed = 0; seed < 300; seed++) {
      const out = applyPackFoil(mkPack(), seededRng(seed));
      const foils = out.filter((c) => c.foil > 0);
      expect(foils.length).toBeLessThanOrEqual(1);
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

  it('produces a foil roughly once every ~7 packs, skewed to tier 1', () => {
    const tiers = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
    let packsWithFoil = 0;
    const N = 7000;
    for (let seed = 0; seed < N; seed++) {
      const foil = applyPackFoil(mkPack(), seededRng(seed)).find((c) => c.foil > 0);
      if (foil) {
        packsWithFoil++;
        tiers[foil.foil]++;
      }
    }
    const rate = packsWithFoil / N;
    expect(rate).toBeGreaterThan(FOIL_PACK_CHANCE * 0.7);
    expect(rate).toBeLessThan(FOIL_PACK_CHANCE * 1.3);
    expect(tiers[1]).toBeGreaterThan(tiers[2]);
    expect(tiers[2]).toBeGreaterThan(tiers[3]);
  });
});
