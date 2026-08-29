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
 * All the rates live in odds.ts; `rng` is injectable so tests are deterministic.
 */
import type { Card, FoilTier } from './types';
import type { Rng } from './pack';
import {
  FOIL_PACK_CHANCE,
  FOIL_TIER_WEIGHTS,
  GOD_PACK_CHANCE,
  NEGATE_CHANCE
} from './odds';

export { FOIL_PACK_CHANCE, FOIL_TIER_WEIGHTS, GOD_PACK_CHANCE, NEGATE_CHANCE };

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
