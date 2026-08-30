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
const { knowledge } = await import('../src/lib/shop');

beforeEach(() => knowledge.reset());

describe('knowledge', () => {
  it('starts at 0 and adds', () => {
    expect(get(knowledge)).toBe(0);
    knowledge.add(30);
    expect(get(knowledge)).toBe(30);
    knowledge.add(-5); // no-op
    knowledge.add(0);
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

  it('reloads the balance from storage', async () => {
    localStorage.setItem('wikitcg:knowledge:v1', '123');
    vi.resetModules();
    const fresh = await import('../src/lib/shop');
    expect(get(fresh.knowledge)).toBe(123);
  });
});
