/**
 * Holographic finish, rolled per pack and independent of rarity.
 *
 * - ~1 pack in 7 contains a single foil card, tier skewed to the subtle end.
 * - ~1 pack in 25 is a "god pack" — every one of its 7 cards is foiled.
 *
 * `rng` is injectable so tests are deterministic.
 */
import type { Card, FoilTier } from './types';
import type { Rng } from './pack';

/** Chance that a given pack contains a foil card at all. */
export const FOIL_PACK_CHANCE = 1 / 7;

/** Chance that a given pack is a god pack — every card foiled. */
export const GOD_PACK_CHANCE = 1 / 25;

/** Relative weights for tiers 1 / 2 / 3 whenever a foil is rolled. */
export const FOIL_TIER_WEIGHTS: [number, number, number] = [0.62, 0.28, 0.1];

function pickTier(r: number): Exclude<FoilTier, 0> {
  const [w1, w2] = FOIL_TIER_WEIGHTS;
  if (r < w1) return 1;
  if (r < w1 + w2) return 2;
  return 3;
}

/** Return a copy of the pack with its foil finishes applied. */
export function applyPackFoil(cards: Card[], rng: Rng = Math.random): Card[] {
  if (cards.length === 0) return cards;

  // god pack — every card gets its own foil finish
  if (rng() < GOD_PACK_CHANCE) {
    return cards.map((c) => ({ ...c, foil: pickTier(rng()) }));
  }

  // otherwise, a single foil roughly one pack in seven
  if (rng() >= FOIL_PACK_CHANCE) return cards;
  const index = Math.floor(rng() * cards.length);
  const tier = pickTier(rng());
  return cards.map((c, i) => (i === index ? { ...c, foil: tier } : c));
}

/** Every card foiled — the god-pack signature. */
export function isGodPack(cards: Pick<Card, 'foil'>[]): boolean {
  return cards.length === 7 && cards.every((c) => (c.foil ?? 0) > 0);
}
