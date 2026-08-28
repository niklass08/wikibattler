import { describe, it, expect } from 'vitest';
import { rarityFromViews, strengthFromLinks, defenceFromBytes } from '../src/lib/rarity';

describe('rarityFromViews', () => {
  it('buckets by the default thresholds', () => {
    expect(rarityFromViews(0)).toBe('common');
    expect(rarityFromViews(9_999)).toBe('common');
    expect(rarityFromViews(10_000)).toBe('uncommon');
    expect(rarityFromViews(149_999)).toBe('uncommon');
    expect(rarityFromViews(150_000)).toBe('rare');
    expect(rarityFromViews(399_999)).toBe('rare');
    expect(rarityFromViews(400_000)).toBe('mythic');
    expect(rarityFromViews(5_000_000)).toBe('mythic');
  });

  it('honours custom thresholds', () => {
    const t = { uncommon: 10, rare: 20, mythic: 30 };
    expect(rarityFromViews(9, t)).toBe('common');
    expect(rarityFromViews(25, t)).toBe('rare');
    expect(rarityFromViews(30, t)).toBe('mythic');
  });
});

describe('stat formulas', () => {
  it('stay within 1..99 and increase monotonically', () => {
    for (const n of [0, 1, 10, 100, 1000, 100000]) {
      const s = strengthFromLinks(n);
      const d = defenceFromBytes(n);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(99);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(99);
    }
    expect(strengthFromLinks(2000)).toBeGreaterThan(strengthFromLinks(20));
    expect(defenceFromBytes(200000)).toBeGreaterThan(defenceFromBytes(2000));
  });
});
