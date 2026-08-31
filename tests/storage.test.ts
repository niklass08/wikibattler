import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * A localStorage with a byte budget, so the quota path can actually be
 * exercised. `node` has no localStorage at all, so this has to be installed on
 * globalThis before `lib/storage` is imported.
 */
class FakeStorage {
  private map = new Map<string, string>();
  constructor(public budget: number) {}
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  private used(skip: string) {
    let n = 0;
    for (const [k, v] of this.map) if (k !== skip) n += k.length + v.length;
    return n;
  }
  setItem(k: string, v: string) {
    if (this.used(k) + k.length + v.length > this.budget) {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, v);
  }
}

let store: FakeStorage;
beforeEach(() => {
  // the module holds the failing-key set in module scope, so each test needs a
  // fresh copy or the flag leaks across them
  vi.resetModules();
  store = new FakeStorage(200);
  (globalThis as { localStorage?: unknown }).localStorage = store;
});

const load = () => import('../src/lib/storage');

describe('safeSet', () => {
  it('reports a refused write instead of swallowing it', async () => {
    const { safeSet } = await load();
    expect(safeSet('wikitcg:small', 'x')).toBe(true);
    expect(safeSet('wikitcg:big', 'y'.repeat(500))).toBe(false);
  });

  it('raises storageFull when a write is refused for lack of room', async () => {
    const { safeSet, storageFull } = await load();
    expect(get(storageFull)).toBe(false);
    safeSet('wikitcg:collection:v2', 'y'.repeat(500));
    expect(get(storageFull)).toBe(true);
  });

  it('clears the warning once that key fits again', async () => {
    // the bug this pins: the flag used to latch, so freeing up room (or signing
    // in) left the player staring at a warning that was no longer true
    const { safeSet, storageFull } = await load();
    safeSet('wikitcg:collection:v2', 'y'.repeat(500));
    expect(get(storageFull)).toBe(true);
    safeSet('wikitcg:collection:v2', 'y'.repeat(10));
    expect(get(storageFull)).toBe(false);
  });

  it('does not let an unrelated small write clear a failing big one', async () => {
    // a knowledge counter landing says nothing about whether the collection fits
    const { safeSet, storageFull } = await load();
    safeSet('wikitcg:collection:v2', 'y'.repeat(500));
    safeSet('wikitcg:knowledge:v1', '42');
    expect(get(storageFull)).toBe(true);
  });

  it('stays quiet when storage is unavailable rather than full', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
      key: () => null,
      length: 0
    };
    const { safeSet, safeGet, storageFull } = await load();
    expect(safeSet('wikitcg:x', 'v')).toBe(false);
    expect(safeGet('wikitcg:x')).toBeNull();
    expect(get(storageFull)).toBe(false);
  });
});

describe('reclaiming room', () => {
  it('evicts a regenerable cache rather than refusing a collection write', async () => {
    const { safeSet, storageFull } = await load();
    safeSet('wikitcg:candidates:v2', 'c'.repeat(150));
    // no room left for this, but the pool above is expendable
    expect(safeSet('wikitcg:collection:v2', 'y'.repeat(150))).toBe(true);
    expect(store.getItem('wikitcg:candidates:v2')).toBeNull();
    expect(get(storageFull)).toBe(false);
  });

  it('works through the tiers cheapest-first, keeping the pool if it can', async () => {
    const { safeSet } = await load();
    safeSet('wikitcg:ladder-cache:v1:top', 'l'.repeat(60));
    safeSet('wikitcg:candidates:v2', 'c'.repeat(60));
    expect(safeSet('wikitcg:collection:v2', 'y'.repeat(60))).toBe(true);
    // the 5-minute ladder cache goes first; the draw pool survives
    expect(store.getItem('wikitcg:ladder-cache:v1:top')).toBeNull();
    expect(store.getItem('wikitcg:candidates:v2')).not.toBeNull();
  });

  it('gives up and warns when even an empty cache leaves no room', async () => {
    const { safeSet, storageFull } = await load();
    expect(safeSet('wikitcg:collection:v2', 'y'.repeat(500))).toBe(false);
    expect(get(storageFull)).toBe(true);
  });

  it('never evicts one cache to make room for another', async () => {
    // otherwise the pool and the pageview lists take turns deleting each other
    const { safeSet } = await load();
    safeSet('wikitcg:candidates:v2', 'c'.repeat(150));
    expect(safeSet('wikitcg:top:2026-01', 't'.repeat(150))).toBe(false);
    expect(store.getItem('wikitcg:candidates:v2')).not.toBeNull();
  });

  it('does not warn when a cache is the thing that would not fit', async () => {
    const { safeSet, storageFull } = await load();
    safeSet('wikitcg:collection:v2', 'y'.repeat(150));
    expect(safeSet('wikitcg:candidates:v2', 'c'.repeat(150))).toBe(false);
    expect(get(storageFull)).toBe(false);
  });

  it('does not evict the key it is currently writing', async () => {
    const { safeSet } = await load();
    safeSet('wikitcg:candidates:v2', 'c'.repeat(150));
    // rewriting the pool itself must not delete it and then claim success
    safeSet('wikitcg:candidates:v2', 'c'.repeat(30));
    expect(store.getItem('wikitcg:candidates:v2')).toBe('c'.repeat(30));
  });
});
