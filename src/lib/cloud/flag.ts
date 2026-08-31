/**
 * "Is this player signed in for cloud sync?" — answered without touching
 * Firebase, so the nav and the boot path can ask the question without dragging
 * the SDK into the main chunk. Set by `cloud/sync.ts` when sync starts.
 */
import { writable, type Readable } from 'svelte/store';
import { safeGet, safeRemove, safeSet } from '../storage';

const ENABLED_KEY = 'wikitcg:cloud:v1';

export const cloudEnabled = (): boolean => safeGet(ENABLED_KEY) === '1';

export const setCloudEnabled = (on: boolean): void => {
  if (on) safeSet(ENABLED_KEY, '1');
  else safeRemove(ENABLED_KEY);
};

/**
 * Whether the cloud currently holds this device's collection. Lives here rather
 * than in `sync.ts` so the app shell can read it without importing Firebase and
 * dragging the SDK into the main chunk; `sync.ts` is what writes to it.
 *
 * The storage warning needs this: once sync is working, a full localStorage no
 * longer means data is being lost, only that this device cannot cache it.
 */
const healthy = writable(false);
export const cloudHealthy: Readable<boolean> = { subscribe: healthy.subscribe };
export const setCloudHealthy = (ok: boolean): void => healthy.set(ok);
