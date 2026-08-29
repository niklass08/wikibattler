/**
 * Special finishes, rolled per pack and independent of rarity.
 *
 * Foil (holographic):
 * - ~1 pack in 7 contains a single foil card, tier skewed to the subtle end.
 * - ~1 pack in 25 is a "god pack" — every one of its 7 cards is foiled.
 *
 * Negated (colours inverted): a separate axis that completes the foil system.
 * Rolled independently per card at a tenth of the foil chance, so a card can
 * come out foil, negated, both, or neither.
 *
 * `rng` is injectable so tests are deterministic.
 */
import type { Card, FoilTier } from './types';
import type { Rng } from './pack';

/** Chance that a given pack contains a foil card at all. */
export const FOIL_PACK_CHANCE = 1 / 7;

/** Chance that a given pack is a god pack — every card foiled. */
export const GOD_PACK_CHANCE = 1 / 25;

/** Per-card chance of the negated finish — a tenth of the foil pack chance. */
export const NEGATE_CHANCE = FOIL_PACK_CHANCE / 10;

/** Relative weights for tiers 1 / 2 / 3 whenever a foil is rolled. */
export const FOIL_TIER_WEIGHTS: [number, number, number] = [0.62, 0.28, 0.1];

function pickTier(r: number): Exclude<FoilTier, 0> {
  const [w1, w2] = FOIL_TIER_WEIGHTS;
  if (r < w1) return 1;
  if (r < w1 + w2) return 2;
  return 3;
}

/** Roll the per-card negated finish, independent of everything else. */
function negate(card: Card, rng: Rng): Card {
  return rng() < NEGATE_CHANCE ? { ...card, negated: true } : card;
}

/** Return a copy of the pack with its foil and negated finishes applied. */
export function applyPackFoil(cards: Card[], rng: Rng = Math.random): Card[] {
  if (cards.length === 0) return cards;

  // god pack — every card gets its own foil finish
  if (rng() < GOD_PACK_CHANCE) {
    return cards.map((c) => negate({ ...c, foil: pickTier(rng()) }, rng));
  }

  // otherwise, a single foil roughly one pack in seven
  if (rng() < FOIL_PACK_CHANCE) {
    const index = Math.floor(rng() * cards.length);
    const tier = pickTier(rng());
    return cards.map((c, i) => negate(i === index ? { ...c, foil: tier } : c, rng));
  }

  // no foil this pack — the negated roll still runs for every card
  return cards.map((c) => negate(c, rng));
}

/** Every card foiled — the god-pack signature. */
export function isGodPack(cards: Pick<Card, 'foil'>[]): boolean {
  return cards.length === 7 && cards.every((c) => (c.foil ?? 0) > 0);
}
