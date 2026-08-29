import { describe, it, expect, beforeEach } from 'vitest';
import { favourites } from '../src/lib/collection';
import { get } from 'svelte/store';

describe('favourites', () => {
  beforeEach(() => favourites.reset());

  it('stars and un-stars a card with the same toggle', () => {
    favourites.toggle(5);
    expect(get(favourites).has(5)).toBe(true);
    favourites.toggle(5);
    expect(get(favourites).has(5)).toBe(false);
  });

  it('tracks several cards independently', () => {
    favourites.toggle(1);
    favourites.toggle(2);
    favourites.toggle(1); // un-star just #1
    expect([...get(favourites)].sort()).toEqual([2]);
  });

  it('reset clears every favourite', () => {
    favourites.toggle(7);
    favourites.toggle(9);
    favourites.reset();
    expect(get(favourites).size).toBe(0);
  });
});
