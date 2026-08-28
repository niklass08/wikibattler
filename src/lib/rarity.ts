import type { Rarity } from './types';

/**
 * Tunable constants. Monthly-view thresholds; nudge until the rarity mix of live
 * packs feels right (rough target 55 / 30 / 12 / 3 %). Rare/mythic candidates come
 * from the pageviews "top" lists, so raising `mythic` makes mythics genuinely scarce.
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
 * Stat formulas. Inputs (link count, byte length) are heavy-tailed, so we map
 * them to 1–99 on a log scale. These run per-card at draw time — there is no
 * pool to normalise against.
 */
export function strengthFromLinks(links: number): number {
  return clamp(Math.round(12 * Math.log10(links + 1)), 1, 99);
}

export function defenceFromBytes(bytes: number): number {
  return clamp(Math.round(11 * (Math.log10(Math.max(bytes, 1)) - 2.5)), 1, 99);
}
