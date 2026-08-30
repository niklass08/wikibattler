import { describe, it, expect } from 'vitest';
import { computeProgress, collection, favourites } from '../src/lib/collection';
import { disenchantValue } from '../src/lib/economy';
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
    negated: false,
    signature: null,
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

  it('keeps the negated finish once a card has ever been pulled negated', () => {
    collection.reset();
    const base = card(11, 'rare');
    collection.addCards([{ ...base, negated: true }]);
    collection.addCards([{ ...base, negated: false }]); // a plain re-pull
    expect(get(collection)[11].card.negated).toBe(true);
    collection.reset();
  });

  it('rolls a signature for a mythic added without one, and never re-rolls it', () => {
    collection.reset();
    const m = { ...card(12, 'mythic'), tags: ['war'] };
    collection.addCards([{ ...m, signature: null }]); // e.g. from a stale queued pack
    const rolled = get(collection)[12].card.signature;
    expect(rolled).not.toBeNull();
    collection.addCards([{ ...m, signature: null }]); // a re-pull
    expect(get(collection)[12].card.signature).toBe(rolled);
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

describe('collection.disenchant', () => {
  it('decrements a duplicate and returns its knowledge value', () => {
    collection.reset();
    favourites.reset();
    collection.addCards([card(30, 'rare'), card(30, 'rare'), card(30, 'rare')]);
    const got = collection.disenchant(30);
    expect(got).toBe(disenchantValue(card(30, 'rare')));
    expect(get(collection)[30].count).toBe(2);
    collection.reset();
  });

  it('removes the last copy entirely', () => {
    collection.reset();
    favourites.reset();
    collection.addCards([card(31, 'uncommon')]);
    const got = collection.disenchant(31);
    expect(got).toBe(disenchantValue(card(31, 'uncommon')));
    expect(get(collection)[31]).toBeUndefined();
    collection.reset();
  });

  it('clamps n to the copies held', () => {
    collection.reset();
    favourites.reset();
    collection.addCards([card(32, 'common'), card(32, 'common'), card(32, 'common')]);
    const got = collection.disenchant(32, 9);
    expect(got).toBe(disenchantValue(card(32, 'common')) * 3);
    expect(get(collection)[32]).toBeUndefined();
    collection.reset();
  });

  it('refuses a favourited card', () => {
    collection.reset();
    favourites.reset();
    collection.addCards([card(33, 'mythic'), card(33, 'mythic')]);
    favourites.toggle(33);
    expect(collection.disenchant(33)).toBe(0);
    expect(get(collection)[33].count).toBe(2);
    favourites.reset();
    collection.reset();
  });

  it('disenchantDuplicates takes every non-favourite pile down to one', () => {
    collection.reset();
    favourites.reset();
    collection.addCards([card(40, 'common'), card(40, 'common'), card(40, 'common')]); // 3
    collection.addCards([card(41, 'rare'), card(41, 'rare')]); // 2
    collection.addCards([card(42, 'uncommon'), card(42, 'uncommon')]); // 2, favourited
    favourites.toggle(42);
    const total = collection.disenchantDuplicates();
    expect(total).toBe(
      disenchantValue(card(40, 'common')) * 2 + disenchantValue(card(41, 'rare')) * 1
    );
    expect(get(collection)[40].count).toBe(1);
    expect(get(collection)[41].count).toBe(1);
    expect(get(collection)[42].count).toBe(2); // favourite untouched
    favourites.reset();
    collection.reset();
  });
});
