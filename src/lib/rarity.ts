import type { Rarity } from './types';
import { RARITY_THRESHOLDS } from './odds';

export { RARITY_THRESHOLDS };

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
