import { describe, it, expect } from 'vitest';
import {
  DISENCHANT_VALUE,
  DISENCHANT_FOIL_BONUS,
  DISENCHANT_NEGATED_BONUS,
  THEMATIC_PACK_PRICE,
  disenchantValue
} from '../src/lib/economy';
import type { Card } from '../src/lib/types';

const card = (over: Partial<Card> = {}): Card => ({
  id: 1,
  title: 'X',
  url: '',
  extract: '',
  image: null,
  rarity: 'common',
  strength: 100,
  defence: 100,
  foil: 0,
  negated: false,
  signature: null,
  tags: [],
  raw: { links: 0, bytes: 0, monthlyViews: 0 },
  ...over
});

describe('disenchantValue', () => {
  it('is the base value for a plain card of each rarity', () => {
    expect(disenchantValue(card({ rarity: 'common' }))).toBe(DISENCHANT_VALUE.common);
    expect(disenchantValue(card({ rarity: 'uncommon' }))).toBe(DISENCHANT_VALUE.uncommon);
    expect(disenchantValue(card({ rarity: 'rare' }))).toBe(DISENCHANT_VALUE.rare);
    expect(disenchantValue(card({ rarity: 'mythic' }))).toBe(DISENCHANT_VALUE.mythic);
  });

  it('rises with rarity', () => {
    const v = (r: Card['rarity']) => disenchantValue(card({ rarity: r }));
    expect(v('common')).toBeLessThan(v('uncommon'));
    expect(v('uncommon')).toBeLessThan(v('rare'));
    expect(v('rare')).toBeLessThan(v('mythic'));
  });

  it('adds the foil-tier bonus on top', () => {
    for (const tier of [1, 2, 3] as const) {
      expect(disenchantValue(card({ rarity: 'rare', foil: tier }))).toBe(
        DISENCHANT_VALUE.rare + DISENCHANT_FOIL_BONUS[tier]
      );
    }
  });

  it('adds the negated bonus on top, and stacks with foil', () => {
    expect(disenchantValue(card({ rarity: 'common', negated: true }))).toBe(
      DISENCHANT_VALUE.common + DISENCHANT_NEGATED_BONUS
    );
    expect(disenchantValue(card({ rarity: 'mythic', foil: 3, negated: true }))).toBe(
      DISENCHANT_VALUE.mythic + DISENCHANT_FOIL_BONUS[3] + DISENCHANT_NEGATED_BONUS
    );
  });
});

describe('fairness', () => {
  it('one disenchanted uncommon buys at least one thematic pack', () => {
    expect(DISENCHANT_VALUE.uncommon).toBeGreaterThanOrEqual(THEMATIC_PACK_PRICE);
  });
  it('one disenchanted rare buys two or three', () => {
    const packs = DISENCHANT_VALUE.rare / THEMATIC_PACK_PRICE;
    expect(packs).toBeGreaterThanOrEqual(2);
  });
});
