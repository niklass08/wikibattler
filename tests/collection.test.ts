import { describe, it, expect } from 'vitest';
import { computeProgress, collection } from '../src/lib/collection';
import type { Card, Collection, Rarity } from '../src/lib/types';
import { get } from 'svelte/store';

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
    foil: 0,
    tags: [],
    raw: { links: 0, bytes: 0, monthlyViews: 0 }
  };
}

function entry(id: number, rarity: Rarity, count: number) {
  return { count, firstOpenedAt: 'x', card: card(id, rarity) };
}

describe('computeProgress', () => {
  it('counts unique owned per rarity and total cards including dupes', () => {
    const col: Collection = {
      1: entry(1, 'common', 3),
      2: entry(2, 'common', 1),
      3: entry(3, 'uncommon', 2),
      4: entry(4, 'mythic', 1)
    };
    const p = computeProgress(col);
    expect(p.ownedUnique).toBe(4);
    expect(p.totalCards).toBe(7);
    expect(p.perRarity.find((r) => r.rarity === 'common')).toEqual({ rarity: 'common', owned: 2 });
    expect(p.perRarity.find((r) => r.rarity === 'uncommon')).toEqual({ rarity: 'uncommon', owned: 1 });
    expect(p.perRarity.find((r) => r.rarity === 'rare')).toEqual({ rarity: 'rare', owned: 0 });
    expect(p.perRarity.find((r) => r.rarity === 'mythic')).toEqual({ rarity: 'mythic', owned: 1 });
  });

  it('is empty for an empty collection', () => {
    const p = computeProgress({});
    expect(p.ownedUnique).toBe(0);
    expect(p.totalCards).toBe(0);
    expect(p.perRarity.every((r) => r.owned === 0)).toBe(true);
  });
});

describe('collection.addCards foil handling', () => {
  it('keeps the best foil tier ever pulled for a card', () => {
    collection.reset();
    const base = card(10, 'rare');
    collection.addCards([{ ...base, foil: 2 }]);
    collection.addCards([{ ...base, foil: 0 }]); // a plain re-pull
    expect(get(collection)[10].card.foil).toBe(2);
    collection.addCards([{ ...base, foil: 3 }]); // an upgrade
    expect(get(collection)[10].card.foil).toBe(3);
    expect(get(collection)[10].count).toBe(3);
    collection.reset();
  });

  it('setImage backfills art only for a card that has none', () => {
    collection.reset();
    collection.addCards([{ ...card(20, 'common'), image: null }]);
    collection.addCards([{ ...card(21, 'common'), image: 'https://a/keep.jpg' }]);
    collection.setImage(20, 'https://a/new.jpg');
    collection.setImage(21, 'https://a/override.jpg');
    expect(get(collection)[20].card.image).toBe('https://a/new.jpg');
    expect(get(collection)[21].card.image).toBe('https://a/keep.jpg');
    collection.reset();
  });
});
