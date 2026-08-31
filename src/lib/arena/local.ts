/**
 * Kept as a re-export so the arena modules' import paths stay put; the
 * implementation (and the quota signal) now lives in `lib/storage.ts`.
 */
export { safeGet, safeSet, safeRemove } from '../storage';
