import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
vi.stubGlobal('localStorage', new MemStore());

// import after the stub so module-load reads a clean store
const { knowledge, ownedPacks, activePack, buyPacks, ownedThemes } = await import('../src/lib/shop');
const { THEMATIC_PACK_PRICE } = await import('../src/lib/economy');

beforeEach(() => {
  knowledge.reset();
  ownedPacks.reset();
  activePack.reset();
});

describe('knowledge', () => {
  it('starts at 0 and adds', () => {
    expect(get(knowledge)).toBe(0);
    knowledge.add(30);
    expect(get(knowledge)).toBe(30);
    knowledge.add(-5); // no-op
    expect(get(knowledge)).toBe(30);
  });

  it('spends atomically', () => {
    knowledge.add(25);
    expect(knowledge.spend(30)).toBe(false);
    expect(get(knowledge)).toBe(25);
    expect(knowledge.spend(20)).toBe(true);
    expect(get(knowledge)).toBe(5);
  });

  it('persists to localStorage', () => {
    knowledge.add(42);
    expect(localStorage.getItem('wikitcg:knowledge:v1')).toBe('42');
  });
});

describe('ownedPacks + buyPacks', () => {
  it('buys when affordable, no auto-switch', () => {
    knowledge.add(30);
    expect(buyPacks('cinema', 1)).toBe(true);
    expect(get(knowledge)).toBe(30 - THEMATIC_PACK_PRICE);
    expect(ownedPacks.count('cinema')).toBe(1);
    expect(get(activePack)).toBe('random'); // unchanged
  });

  it('refuses when broke and leaves state untouched', () => {
    knowledge.add(THEMATIC_PACK_PRICE * 5 - 1);
    expect(buyPacks('cinema', 5)).toBe(false);
    expect(ownedPacks.count('cinema')).toBe(0);
    expect(get(knowledge)).toBe(THEMATIC_PACK_PRICE * 5 - 1);
  });

  it('stacks and consumes down to zero', () => {
    knowledge.add(THEMATIC_PACK_PRICE * 3);
    buyPacks('music', 1);
    buyPacks('music', 2);
    expect(ownedPacks.count('music')).toBe(3);
    ownedPacks.consume('music');
    expect(ownedPacks.count('music')).toBe(2);
    ownedPacks.consume('music');
    ownedPacks.consume('music');
    expect(ownedPacks.count('music')).toBe(0);
    expect('music' in get(ownedPacks)).toBe(false); // key dropped
  });

  it('ownedThemes lists held themes in canonical order', () => {
    knowledge.add(999);
    buyPacks('vehicles', 1);
    buyPacks('cinema', 1);
    expect(ownedThemes(get(ownedPacks))).toEqual(['cinema', 'vehicles']);
  });
});

describe('activePack', () => {
  it('defaults to random and round-trips a set', () => {
    expect(get(activePack)).toBe('random');
    activePack.set('cinema');
    expect(get(activePack)).toBe('cinema');
    expect(localStorage.getItem('wikitcg:active-pack:v1')).toBe('cinema');
  });

  it('a persisted theme with no packs loads back as random', async () => {
    localStorage.setItem('wikitcg:active-pack:v1', 'disease');
    localStorage.setItem('wikitcg:owned-packs:v1', '{}');
    vi.resetModules();
    const fresh = await import('../src/lib/shop');
    expect(get(fresh.activePack)).toBe('random');
  });
});
