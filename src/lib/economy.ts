/**
 * Every knob for the disenchant / thematic-pack economy in one place. Nothing
 * here has behaviour beyond `disenchantValue`; the stores that spend and earn
 * live in `shop.ts`, the pack sourcing in `draw.ts`.
 *
 * Tuned generous on purpose — a first thematic pack should cost roughly one
 * disenchanted uncommon, and a "disenchant duplicates" sweep should buy a dozen.
 * Adjust any line here and the whole balance shifts.
 */
import type { Card, Rarity } from './types';

/** Knowledge earned for disenchanting a single card of each rarity. */
export const DISENCHANT_VALUE: Record<Rarity, number> = {
  common: 3,
  uncommon: 10,
  rare: 30,
  mythic: 90
};

/** Bonus knowledge for a foil finish, added on top. Index = foil tier (0–3). */
export const DISENCHANT_FOIL_BONUS = [0, 4, 10, 25] as const;

/** Bonus knowledge when the card is negated, added on top. */
export const DISENCHANT_NEGATED_BONUS = 20;

/** Knowledge cost of one thematic pack. Every theme is priced the same. */
export const THEMATIC_PACK_PRICE = 10;

/** What one copy of `card` is worth if disenchanted. */
export function disenchantValue(card: Pick<Card, 'rarity' | 'foil' | 'negated'>): number {
  return (
    DISENCHANT_VALUE[card.rarity] +
    (DISENCHANT_FOIL_BONUS[card.foil ?? 0] ?? 0) +
    (card.negated ? DISENCHANT_NEGATED_BONUS : 0)
  );
}
