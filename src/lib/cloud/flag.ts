/**
 * "Is this player signed in for cloud sync?" — answered without touching
 * Firebase, so the nav and the boot path can ask the question without dragging
 * the SDK into the main chunk. Set by `cloud/sync.ts` when sync starts.
 */
import { safeGet, safeRemove, safeSet } from '../storage';

const ENABLED_KEY = 'wikitcg:cloud:v1';

export const cloudEnabled = (): boolean => safeGet(ENABLED_KEY) === '1';

export const setCloudEnabled = (on: boolean): void => {
  if (on) safeSet(ENABLED_KEY, '1');
  else safeRemove(ENABLED_KEY);
};
