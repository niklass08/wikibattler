/**
 * Holographic finish, rolled per pack and independent of rarity. A foil card is
 * a somewhat rare event — roughly one pack in seven contains one — and its tier
 * skews toward the subtle end.
 */
import type { Card, FoilTier } from './types';
import type { Rng } from './pack';

/** Chance that a given pack contains a foil card at all. */
export const FOIL_PACK_CHANCE = 1 / 7;

/** Relative weights for tiers 1 / 2 / 3 once a foil is happening. */
export const FOIL_TIER_WEIGHTS: [number, number, number] = [0.62, 0.28, 0.1];

function pickTier(r: number): Exclude<FoilTier, 0> {
  const [w1, w2] = FOIL_TIER_WEIGHTS;
  if (r < w1) return 1;
  if (r < w1 + w2) return 2;
  return 3;
}

/**
 * Return a copy of the pack with at most one card upgraded to a foil finish.
 * `rng` is injectable so tests are deterministic.
 */
export function applyPackFoil(cards: Card[], rng: Rng = Math.random): Card[] {
  if (cards.length === 0 || rng() >= FOIL_PACK_CHANCE) return cards;
  const index = Math.floor(rng() * cards.length);
  const tier = pickTier(rng());
  return cards.map((c, i) => (i === index ? { ...c, foil: tier } : c));
}
