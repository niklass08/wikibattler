/**
 * Cloud sync — pulls the player's collection down, merges it with whatever is on
 * this device, and pushes the result back.
 *
 * Shape in Firestore:
 *
 *   collections/{uid}              meta: rev, the small single-choice state
 *   collections/{uid}/chunks/{0-7} the collection itself, one deflated blob each
 *
 * Both are private to the owner (see `firestore.rules`) — unlike everything
 * under `defences/` and `profiles/`, which is world-readable by design.
 *
 * This module is only ever loaded behind a dynamic import, and only for a player
 * who has signed in, so the Firebase SDK stays out of the Open / Collection /
 * Battle chunks and the offline path is untouched.
 *
 * `firebase/firestore/lite` has no snapshot listeners, so this is pull-on-start,
 * push-on-change rather than live replication: two devices open at the same
 * moment will not see each other until one of them refocuses. That is a
 * deliberate trade — the full Firestore SDK costs several times the bundle for a
 * single-player card game.
 */
import { get } from 'svelte/store';
import { writable, type Readable } from 'svelte/store';
import {
  Bytes,
  collection as coll,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore/lite';
import type { Collection, OwnedEntry } from '../types';
import { getArena } from '../firebase';
import { collection as collectionStore, favourites, packsOpened } from '../collection';
import { knowledge } from '../shop';
import { battleTeam } from '../battle/team';
import { profile } from '../arena/profile';
import { safeGet, safeSet } from '../storage';
import { setCloudEnabled, setCloudHealthy } from './flag';
import { mergeCollections, mergeSide, type SideState } from './merge';
import { SHARDS, WIRE_VERSION, packShard, splitShards, unpackShard } from './wire';

export type SyncPhase = 'off' | 'pulling' | 'pushing' | 'idle' | 'error';

export interface SyncState {
  phase: SyncPhase;
  /** When the last successful push or pull finished. */
  at: number | null;
  error: string | null;
}

const state = writable<SyncState>({ phase: 'off', at: null, error: null });
export const syncState: Readable<SyncState> = { subscribe: state.subscribe };

// ── the local side ───────────────────────────────────────────────────────────
/**
 * When this device last changed its handle or battle team. Persisted, because
 * `mergeSide` resolves those two by last-write-wins and stamping `Date.now()`
 * at merge time would make this device unconditionally newer — a device that
 * had not been opened in a month would silently revert a rename made on
 * another one.
 */
const SIDE_AT_KEY = 'wikitcg:cloud-side-at:v1';

const sideChangedAt = (): number => Number(safeGet(SIDE_AT_KEY)) || 0;
const touchSide = (): void => void safeSet(SIDE_AT_KEY, String(Date.now()));

function localSide(): SideState {
  return {
    favourites: [...get(favourites)],
    knowledge: get(knowledge),
    packsOpened: get(packsOpened),
    team: [...get(battleTeam)],
    handle: get(profile).handle,
    updatedAt: sideChangedAt()
  };
}

function applySide(side: SideState): void {
  favourites.hydrate(side.favourites);
  knowledge.hydrate(side.knowledge);
  packsOpened.hydrate(side.packsOpened);
  battleTeam.hydrate(side.team);
  if (side.handle) profile.hydrate(side.handle);
}

function readSide(data: Record<string, unknown> | undefined): SideState {
  const s = (data?.side ?? {}) as Partial<SideState>;
  const nums = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [];
  return {
    favourites: nums(s.favourites),
    knowledge: Number(s.knowledge) || 0,
    packsOpened: Number(s.packsOpened) || 0,
    team: nums(s.team),
    handle: typeof s.handle === 'string' ? s.handle : '',
    updatedAt: Number(s.updatedAt) || 0
  };
}

// ── dirty tracking ───────────────────────────────────────────────────────────
/**
 * Entries at the last successful push, per shard, by reference. Every mutation
 * in `collection.ts` builds a new entry object, so reference equality is an
 * exact "unchanged" test — which means a push only rewrites the shards a pack
 * actually touched instead of the whole collection.
 */
let pushed: Array<Map<number, OwnedEntry>> = [];

const shardMap = (part: Collection): Map<number, OwnedEntry> =>
  new Map(Object.entries(part).map(([k, v]) => [Number(k), v]));

function isDirty(i: number, next: Map<number, OwnedEntry>): boolean {
  const prev = pushed[i];
  if (!prev || prev.size !== next.size) return true;
  for (const [id, entry] of next) if (prev.get(id) !== entry) return true;
  return false;
}

// ── pull ─────────────────────────────────────────────────────────────────────
async function pullRemote(): Promise<{ col: Collection; side: SideState; rev: number }> {
  const { db, uid } = await getArena();
  const metaSnap = await getDoc(doc(db, 'collections', uid));
  const meta = metaSnap.exists() ? (metaSnap.data() as Record<string, unknown>) : undefined;

  const chunks = await getDocs(coll(db, 'collections', uid, 'chunks'));
  let col: Collection = {};
  for (const d of chunks.docs) {
    const blob = d.get('blob');
    if (!(blob instanceof Bytes)) continue;
    Object.assign(col, await unpackShard(blob.toUint8Array()));
  }
  return { col, side: readSide(meta), rev: Number(meta?.rev) || 0 };
}

// ── push ─────────────────────────────────────────────────────────────────────
let rev = 0;

async function pushLocal(force: boolean): Promise<void> {
  const { db, uid } = await getArena();
  const col = get(collectionStore);
  const parts = splitShards(col);
  const maps = parts.map(shardMap);
  const dirty = maps.map((m, i) => force || isDirty(i, m));

  const batch = writeBatch(db);
  for (let i = 0; i < SHARDS; i++) {
    if (!dirty[i]) continue;
    const bytes = await packShard(parts[i]);
    batch.set(doc(db, 'collections', uid, 'chunks', String(i)), {
      v: WIRE_VERSION,
      blob: Bytes.fromUint8Array(bytes),
      cards: Object.keys(parts[i]).length,
      updatedAt: serverTimestamp()
    });
  }
  rev += 1;
  batch.set(doc(db, 'collections', uid), {
    rev,
    side: localSide(),
    cards: Object.keys(col).length,
    updatedAt: serverTimestamp()
  });
  await batch.commit();
  pushed = maps;
}

// ── the loop ─────────────────────────────────────────────────────────────────
const PUSH_DEBOUNCE_MS = 6000;

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubs: Array<() => void> = [];
let pending = false;
let inFlight: Promise<void> | null = null;

function schedule(): void {
  if (!running) return;
  pending = true;
  touchSide();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), PUSH_DEBOUNCE_MS);
}

/** Push now if anything is waiting. Serialised, so overlapping calls queue. */
export async function flush(): Promise<void> {
  if (!running || !pending) return;
  if (inFlight) return inFlight;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = false;
  state.update((s) => ({ ...s, phase: 'pushing', error: null }));
  inFlight = pushLocal(false)
    .then(() => {
      state.set({ phase: 'idle', at: Date.now(), error: null });
      setCloudHealthy(true);
    })
    .catch(() => {
      pending = true; // keep it queued for the next attempt
      setCloudHealthy(false);
      state.update((s) => ({ ...s, phase: 'error', error: 'Could not save to the cloud.' }));
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Merge this device into the cloud account and start syncing.
 *
 * The merge runs on every start, not only the first: it is idempotent (see
 * `cloud/merge.ts`), and running it each time is what lets a device that was
 * offline for a while rejoin without losing what it did meanwhile.
 */
export async function startSync(): Promise<void> {
  if (running) return;
  state.set({ phase: 'pulling', at: null, error: null });
  try {
    const remote = await pullRemote();
    rev = remote.rev;

    const merged = mergeCollections(get(collectionStore), remote.col);
    collectionStore.hydrate(merged);
    const side = mergeSide(localSide(), remote.side);
    applySide(side);
    // the merged side IS this device's state now, so date it accordingly rather
    // than leaving a stale stamp that would lose to the cloud on the next merge
    safeSet(SIDE_AT_KEY, String(Math.max(side.updatedAt, sideChangedAt())));

    running = true;
    setCloudEnabled(true);
    // seed the dirty baseline from what the cloud already had, so a device that
    // added nothing does not rewrite all eight shards on connect
    pushed = splitShards(remote.col).map(shardMap);

    // any store change queues a debounced push
    for (const store of [collectionStore, favourites, knowledge, packsOpened, battleTeam, profile]) {
      let first = true;
      unsubs.push(
        store.subscribe(() => {
          if (first) {
            first = false; // subscribe fires immediately; that is not a change
            return;
          }
          schedule();
        })
      );
    }

    // a push in flight when the tab goes away would otherwise be lost
    if (typeof document !== 'undefined') {
      const onHide = () => {
        if (document.visibilityState === 'hidden') void flush();
      };
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', () => void flush());
      unsubs.push(() => document.removeEventListener('visibilitychange', onHide));
    }

    pending = true;
    await flush();
  } catch {
    setCloudHealthy(false);
    state.set({ phase: 'error', at: null, error: 'Could not reach the cloud.' });
    throw new Error('sync-failed');
  }
}

/** Stop syncing. Local data is left exactly as it is. */
export function stopSync(): void {
  running = false;
  pending = false;
  if (timer) clearTimeout(timer);
  timer = null;
  for (const u of unsubs) u();
  unsubs = [];
  pushed = [];
  setCloudEnabled(false);
  setCloudHealthy(false);
  state.set({ phase: 'off', at: null, error: null });
}
