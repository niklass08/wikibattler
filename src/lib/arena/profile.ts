/**
 * The player's Arena identity — a chosen handle plus the Firebase anonymous uid
 * (per device). The handle is not globally unique; it's shown with a 4-char uid
 * suffix (`Ada#3f7c`) so two players with the same handle stay distinct.
 */
import { writable } from 'svelte/store';
import { safeGet, safeSet } from './local';

const KEY = 'wikitcg:profile:v1';

export interface Profile {
  handle: string;
  uid?: string;
}

const HANDLE_RE = /^[A-Za-z0-9 _-]{3,20}$/;

/** null when the handle is acceptable, otherwise a short reason to show. */
export function validateHandle(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 3) return 'At least 3 characters.';
  if (s.length > 20) return 'At most 20 characters.';
  if (!HANDLE_RE.test(s)) return 'Letters, numbers, spaces, - and _ only.';
  return null;
}

export const shortId = (uid: string): string => uid.slice(0, 4);

export const displayName = (handle: string, uid?: string): string =>
  uid ? `${handle}#${shortId(uid)}` : handle;

function load(): Profile {
  const raw = safeGet(KEY);
  if (!raw) return { handle: '' };
  try {
    const p = JSON.parse(raw) as Profile;
    return { handle: typeof p.handle === 'string' ? p.handle : '', uid: p.uid };
  } catch {
    return { handle: '' };
  }
}

function create() {
  const { subscribe, update } = writable<Profile>(load());
  const persist = (p: Profile) => {
    safeSet(KEY, JSON.stringify(p));
    return p;
  };
  return {
    subscribe,
    setHandle(handle: string) {
      update((p) => persist({ ...p, handle: handle.trim() }));
    },
    setUid(uid: string) {
      update((p) => (p.uid === uid ? p : persist({ ...p, uid })));
    },
    /** Adopt a handle that came back from the cloud. */
    hydrate(handle: string) {
      update((p) => (p.handle === handle ? p : persist({ ...p, handle })));
    }
  };
}

export const profile = create();
