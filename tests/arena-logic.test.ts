import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readCache, writeCache, isStale, TTL_MS, STALE_MS } from '../src/lib/arena/cache';
import { validateHandle, displayName, shortId } from '../src/lib/arena/profile';

// minimal localStorage for the node test env
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

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStore());
});

describe('cache TTL', () => {
  it('returns a value written within the TTL', () => {
    const t0 = 1_000_000;
    writeCache('k', { a: 1 }, t0);
    expect(readCache<{ a: number }>('k', t0 + TTL_MS - 1)).toEqual({ a: 1 });
  });

  it('drops a value past the TTL', () => {
    const t0 = 1_000_000;
    writeCache('k', [1, 2, 3], t0);
    expect(readCache('k', t0 + TTL_MS + 1)).toBeNull();
  });

  it('returns null for a missing or corrupt entry', () => {
    expect(readCache('nope')).toBeNull();
    localStorage.setItem('bad', '{not json');
    expect(readCache('bad')).toBeNull();
  });
});

describe('staleness', () => {
  it('flags a defence older than the window', () => {
    const now = 10 * STALE_MS;
    expect(isStale(now - STALE_MS - 1, now)).toBe(true);
    expect(isStale(now - 1000, now)).toBe(false);
    expect(isStale(NaN, now)).toBe(true);
  });
});

describe('handle helpers', () => {
  it('accepts a sane handle, rejects the rest', () => {
    expect(validateHandle('Ada')).toBeNull();
    expect(validateHandle('  Ada Lovelace  ')).toBeNull();
    expect(validateHandle('ab')).toMatch(/3 characters/);
    expect(validateHandle('x'.repeat(21))).toMatch(/20 characters/);
    expect(validateHandle('no*stars')).toMatch(/Letters/);
  });

  it('renders a stable disambiguated name', () => {
    expect(shortId('abcd1234ef')).toBe('abcd');
    expect(displayName('Ada', 'abcd1234')).toBe('Ada#abcd');
    expect(displayName('Ada')).toBe('Ada');
  });
});
