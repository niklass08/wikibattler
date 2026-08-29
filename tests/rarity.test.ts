import { describe, it, expect } from 'vitest';
import {
  rarityFromViews,
  strengthFromLinks,
  defenceFromBytes,
  STAT_MAX
} from '../src/lib/rarity';

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
  it('stay within 1..STAT_MAX and increase monotonically', () => {
    for (const n of [0, 1, 10, 100, 1000, 100000, 1_000_000]) {
      const s = strengthFromLinks(n);
      const d = defenceFromBytes(n);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(STAT_MAX);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(STAT_MAX);
    }
    expect(strengthFromLinks(2000)).toBeGreaterThan(strengthFromLinks(20));
    expect(defenceFromBytes(200000)).toBeGreaterThan(defenceFromBytes(2000));
  });

  it('spreads across the scale — stubs low, huge articles near the ceiling', () => {
    expect(strengthFromLinks(8)).toBeLessThan(120);
    expect(strengthFromLinks(400)).toBeGreaterThan(350);
    expect(strengthFromLinks(400)).toBeLessThan(650);
    expect(strengthFromLinks(20_000)).toBe(STAT_MAX);

    expect(defenceFromBytes(1500)).toBeLessThan(120);
    expect(defenceFromBytes(30_000)).toBeGreaterThan(300);
    expect(defenceFromBytes(30_000)).toBeLessThan(600);
    expect(defenceFromBytes(2_000_000)).toBe(STAT_MAX);
  });
});
