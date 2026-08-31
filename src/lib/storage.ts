/**
 * localStorage that no-ops when a write cannot land, plus the one thing the old
 * per-module copies of this helper were missing: a signal when a write is
 * actually being dropped.
 *
 * A collection entry is ~659 bytes of JSON (measured against real articles), so
 * a browser's typical 5 MB per-origin quota is exhausted somewhere around 8,000
 * unique cards — and lower in practice, because the candidate pool and the
 * pageview caches share the same budget. Before this, `setItem` throwing was
 * swallowed with a comment and the player simply lost every pack they opened
 * from then on, silently, with no way to tell.
 */
import { derived, writable, type Readable } from 'svelte/store';

/**
 * Which keys are currently failing to write, not merely which ones ever have.
 *
 * Tracked per key rather than as one latched flag: the collection blob is by
 * far the biggest value, so it is the one that fails first, and a small write
 * landing afterwards (a knowledge counter, say) says nothing about whether the
 * collection now fits. Keying it means disenchanting duplicates clears the
 * warning by itself, on the next successful write of the key that was failing.
 */
const failing = writable<Set<string>>(new Set());

/** True while some value cannot be persisted. */
export const storageFull: Readable<boolean> = derived(failing, (s) => s.size > 0);

function mark(key: string, isFailing: boolean): void {
  failing.update((s) => {
    if (s.has(key) === isFailing) return s; // no change, no notification
    const next = new Set(s);
    if (isFailing) next.add(key);
    else next.delete(key);
    return next;
  });
}

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Regenerable caches, in the order it is cheapest to throw them away. When a
 * real write runs out of room these are evicted a tier at a time to make space
 * — losing a cache costs a network round trip, losing cards is forever, so the
 * trade is never close.
 *
 *   ladder-cache  5-minute TTL, one query to rebuild
 *   top:YYYY-MM   ~1000 titles per month, 30-day TTL, one API call each
 *   candidates    the draw pool, ~300 KB at full stock, restocked in background
 *
 * Deliberately not gated on being signed in: a signed-out player has MORE to
 * lose from a refused write, not less.
 */
const DISPOSABLE = ['wikitcg:ladder-cache:', 'wikitcg:top:', 'wikitcg:candidates:'] as const;

/** A cache whose write failing is not data loss, and so is not worth warning
 *  about — it simply gets refetched. */
const isDisposable = (key: string): boolean => DISPOSABLE.some((p) => key.startsWith(p));

const isQuotaError = (err: unknown): boolean =>
  /quota/i.test((err as { name?: string })?.name ?? '');

/** Drop every key under `prefix`, except `keep`. Returns bytes reclaimed. */
function evict(prefix: string, keep: string): number {
  let freed = 0;
  try {
    // snapshot first: removing while indexing by position skips entries
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== keep && k.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) {
      freed += k.length + (localStorage.getItem(k)?.length ?? 0);
      localStorage.removeItem(k);
    }
  } catch {
    /* storage went away mid-sweep; nothing more to reclaim */
  }
  return freed;
}

/**
 * Write `value`, evicting regenerable caches and retrying if there is no room.
 * Returns whether the value actually reached disk.
 */
export function safeSet(key: string, value: string): boolean {
  // a cache that will not fit is simply not cached; never evict other caches to
  // make room for one, or two caches can take turns evicting each other
  const tiers = isDisposable(key) ? [] : DISPOSABLE;

  let tier = 0;
  for (;;) {
    try {
      localStorage.setItem(key, value);
      mark(key, false);
      return true;
    } catch (err) {
      // A quota error means we are out of room. Anything else (storage disabled
      // entirely, some hardened private modes) is a browser where persistence
      // was never on offer, so there is nothing to warn about.
      if (!isQuotaError(err)) return false;
      // step through tiers until one actually frees something: an empty tier is
      // no reason to give up while a later one still holds a cache
      let freed = 0;
      while (freed === 0 && tier < tiers.length) freed = evict(tiers[tier++], key);
      if (freed === 0) {
        if (!isDisposable(key)) mark(key, true);
        return false;
      }
    }
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
    mark(key, false);
  } catch {
    /* ignore */
  }
}

/** Rough bytes currently held under the `wikitcg:` namespace. */
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
