import { describe, it, expect } from 'vitest';
import { computeProgress } from '../src/lib/collection';
import type { Card, Collection, Rarity } from '../src/lib/types';

function card(id: number, rarity: Rarity): Card {
  return {
    id,
    title: `#${id}`,
    url: '',
    extract: '',
    image: null,
    rarity,
    strength: 1,
    defence: 1,
    raw: { links: 0, bytes: 0, monthlyViews: 0 }
  };
}

describe('computeProgress', () => {
  const cardById = new Map<number, Card>([
    [1, card(1, 'common')],
    [2, card(2, 'common')],
    [3, card(3, 'uncommon')],
    [4, card(4, 'rare')],
    [5, card(5, 'mythic')]
  ]);
  const totals: Record<Rarity, number> = { common: 2, uncommon: 1, rare: 1, mythic: 1 };

  it('counts unique owned per rarity, ignoring dupes and unknown ids', () => {
    const col: Collection = {
      1: { count: 3, firstOpenedAt: 'x' },
      3: { count: 1, firstOpenedAt: 'x' },
      999: { count: 1, firstOpenedAt: 'x' } // not in pool
    };
    const p = computeProgress(col, cardById, totals);
    expect(p.ownedUnique).toBe(2);
    expect(p.total).toBe(5);
    expect(p.perRarity.find((r) => r.rarity === 'common')).toMatchObject({ owned: 1, total: 2 });
    expect(p.perRarity.find((r) => r.rarity === 'uncommon')).toMatchObject({ owned: 1, total: 1 });
    expect(p.perRarity.find((r) => r.rarity === 'mythic')).toMatchObject({ owned: 0, total: 1 });
  });

  it('is empty for an empty collection', () => {
    const p = computeProgress({}, cardById, totals);
    expect(p.ownedUnique).toBe(0);
    expect(p.perRarity.every((r) => r.owned === 0)).toBe(true);
  });
});
