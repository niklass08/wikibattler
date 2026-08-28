import type { Rarity } from './types';

/**
 * Tunable constants. After the first real crawl, inspect scripts/.cache/pools.summary.json
 * and nudge these until the rarity split feels right (rough target 55 / 30 / 12 / 3 %).
 */
export const RARITY_THRESHOLDS = {
  /** monthly views: >= this and < rare  => uncommon */
  uncommon: 10_000,
  /** monthly views: >= this and < mythic => rare */
  rare: 150_000,
  /** monthly views: >= this             => mythic */
  mythic: 400_000
} as const;

export function rarityFromViews(
  monthlyViews: number,
  thresholds: { uncommon: number; rare: number; mythic: number } = RARITY_THRESHOLDS
): Rarity {
  if (monthlyViews >= thresholds.mythic) return 'mythic';
  if (monthlyViews >= thresholds.rare) return 'rare';
  if (monthlyViews >= thresholds.uncommon) return 'uncommon';
  return 'common';
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Fallback stat formulas for live draws with no pool context (see "wild" mode).
 * The canonical path is percentile-rank normalisation done at build time.
 * Inputs are heavy-tailed, so we work on a log scale.
 */
export function strengthFromLinks(links: number): number {
  return clamp(Math.round(12 * Math.log10(links + 1)), 1, 99);
}

export function defenceFromBytes(bytes: number): number {
  return clamp(Math.round(11 * (Math.log10(Math.max(bytes, 1)) - 2.5)), 1, 99);
}

/**
 * Map a list of raw values to 1–99 by percentile rank. Ties share the lower rank.
 * Used by the build script so stats spread across the whole range regardless of
 * the underlying distribution.
 */
export function percentileNormalise(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [50];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    // count of values strictly less than v
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    const pct = lo / (n - 1);
    return clamp(Math.round(1 + pct * 98), 1, 99);
  });
}
