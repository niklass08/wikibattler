/**
 * localStorage that no-ops in private mode / on quota, plus the one thing the
 * old per-module copies of this helper were missing: a signal when a write is
 * actually being dropped.
 *
 * A collection entry is ~659 bytes of JSON (measured against real articles), so
 * a browser's typical 5 MB per-origin quota is exhausted somewhere around 8,000
 * unique cards — and lower in practice, because the candidate pool and the
 * pageview caches share the same budget. Before this, `setItem` throwing was
 * swallowed with a comment and the player simply lost every pack they opened
 * from then on, silently, with no way to tell. `storageFull` lets the UI say so.
 */
import { writable, type Readable } from 'svelte/store';

const full = writable(false);

/** True once a write has been refused for lack of room. Never resets itself —
 *  the collection in memory is ahead of what is on disk until the tab reloads. */
export const storageFull: Readable<boolean> = { subscribe: full.subscribe };

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns whether the value actually reached disk. */
export function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    // QuotaExceededError (name varies by browser) means we are out of room and
    // the player is losing data; anything else is private mode, where storage
    // was never available and nothing is being lost.
    const name = (err as { name?: string })?.name ?? '';
    if (/quota|QUOTA_EXCEEDED/i.test(name)) full.set(true);
    return false;
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Rough bytes currently held under the `wikitcg:` namespace. Used by the
 *  storage warning to show how close to the edge a collection is. */
export function usedBytes(): number {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('wikitcg:')) continue;
      n += k.length + (localStorage.getItem(k)?.length ?? 0);
    }
    return n;
  } catch {
    return 0;
  }
}
