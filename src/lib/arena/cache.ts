/**
 * A tiny TTL cache for Arena list pages, to keep Firestore reads well under the
 * free-tier daily quota. A page is refetched only on an explicit Refresh or once
 * its entry ages past `TTL_MS`. Also the 60-day staleness rule for hiding
 * abandoned defences / ratings from a per-device anonymous identity.
 */
import { safeGet, safeSet } from './local';

export const TTL_MS = 5 * 60 * 1000;
export const STALE_MS = 60 * 24 * 60 * 60 * 1000;

interface Entry<T> {
  ts: number;
  value: T;
}

export function readCache<T>(key: string, now = Date.now()): T | null {
  const raw = safeGet(key);
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Entry<T>;
    if (typeof e.ts !== 'number' || now - e.ts > TTL_MS) return null;
    return e.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T, now = Date.now()): void {
  safeSet(key, JSON.stringify({ ts: now, value } satisfies Entry<T>));
}

/** True when a doc's `updatedAt` (epoch ms) is old enough to hide from the lists. */
export function isStale(updatedAtMs: number, now = Date.now()): boolean {
  return !Number.isFinite(updatedAtMs) || now - updatedAtMs > STALE_MS;
}
