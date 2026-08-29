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
 * Stat scale. Strength still comes from the article's internal link count and
 * defence from its wikitext byte length — both heavy-tailed, so both are mapped
 * on a log scale. The output runs 1–1000: an article at or below the `.min`
 * anchor bottoms out, one at or above `.max` maxes, and `STAT_CURVE` (>1) bows
 * the curve so the low end is pushed down and typical articles spread across
 * the middle rather than bunching near the bottom.
 *
 * Rough landing points with the current anchors:
 *   links   10 → ~50    100 → ~290    1 000 → ~650    3 000 → ~860
 *   bytes  2 kB → ~45   20 kB → ~330   80 kB → ~585    250 kB → ~835
 *
 * These run per-card at draw time — there is no pool to normalise against.
 */
export const STAT_MAX = 1000;

/** >1 pushes the low end down so mid-range articles fan out across the scale. */
export const STAT_CURVE = 1.6;

/** Link count anchors: <= min scores 1, >= max scores STAT_MAX. */
export const STRENGTH_LINKS = { min: 3, max: 6000 } as const;

/** Wikitext byte anchors: <= min scores 1, >= max scores STAT_MAX. */
export const DEFENCE_BYTES = { min: 800, max: 500_000 } as const;

function scaleLog(value: number, min: number, max: number): number {
  const t =
    (Math.log10(Math.max(value, 1)) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  const shaped = Math.pow(clamp(t, 0, 1), STAT_CURVE);
  return clamp(Math.round(shaped * STAT_MAX), 1, STAT_MAX);
}

export function strengthFromLinks(links: number): number {
  return scaleLog(links, STRENGTH_LINKS.min, STRENGTH_LINKS.max);
}

export function defenceFromBytes(bytes: number): number {
  return scaleLog(bytes, DEFENCE_BYTES.min, DEFENCE_BYTES.max);
}
