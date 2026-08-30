/**
 * Background prefetch of fully-assembled packs. Opening one pops it from the
 * front instantly; the queue refills in the background, so the slow-but-accurate
 * live path never blocks the player.
 *
 * The queue always holds packs of the *currently active* type (`activePack`),
 * and never more themed packs than the player owns. Switching type stashes the
 * old queue in memory and rebuilds for the new one.
 *
 * Nothing here touches the network at import time — only `start()` does.
 */
import { get, writable } from 'svelte/store';
import type { Card } from './types';
import { buildPack, warmBuckets, bucketsWarm, warmTheme, themeWarm } from './draw';
import { applyMythicSignatures } from './signature';
import { setFetchMode } from './wiki';
import { activePack, ownedPacks, type ActivePack } from './shop';

export const MAX_PREFETCH = 3;
const KEY = 'wikitcg:packqueue:v1';
/** After a failed refill, wait this long before an automatic retry. */
const ERROR_COOLDOWN_MS = 8000;

export interface QueueStatus {
  ready: number;
  warming: boolean;
  error: string | null;
  /** non-null while the queue is rebuilding after a pack-type switch */
  switching: ActivePack | null;
}

export const status = writable<QueueStatus>({
  ready: 0,
  warming: false,
  error: null,
  switching: null
});

let queue: Card[][] = [];
let running = false;
/** a refill was requested while one was already running — run again when it ends */
let wantRefill = false;
let started = false;
let errorAt = 0;
/** A player is waiting on an empty queue — build fast, be impatient with the API. */
let urgent = false;

/** Which pack type the queue currently holds. */
let activeTag: ActivePack = 'random';
/** Bumped on every type switch; an in-flight build whose gen is stale is discarded. */
let switchGen = 0;
/** In-memory only: the other types' already-built packs, kept for a fast switch-back. */
const stash = new Map<ActivePack, Card[][]>();

function isPack(p: unknown): p is Card[] {
  return Array.isArray(p) && p.length === 7 && p.every((c) => c && typeof c === 'object' && 'id' in c);
}

/** How many packs the queue should hold right now. */
function target(): number {
  if (activeTag === 'random') return MAX_PREFETCH;
  return Math.min(ownedPacks.count(activeTag), MAX_PREFETCH);
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tag: activeTag, packs: queue }));
  } catch {
    /* private mode / quota */
  }
  status.update((s) => ({ ...s, ready: queue.length }));
}

function restore(): void {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // { tag, packs } — keep only if it matches the type we're about to serve
    if (parsed && parsed.tag === activeTag && Array.isArray(parsed.packs)) {
      queue = parsed.packs.filter(isPack);
    } else {
      queue = [];
    }
  } catch {
    queue = [];
  }
}

async function refill(force = false): Promise<void> {
  if (!started) return;
  if (running) {
    // a switch / buy / take came in mid-build — pick it up when this run ends
    wantRefill = true;
    return;
  }
  if (!force && errorAt && Date.now() - errorAt < ERROR_COOLDOWN_MS) return;
  running = true;
  wantRefill = false;
  const gen = switchGen;
  const theme = activeTag === 'random' ? undefined : activeTag;
  setFetchMode(urgent ? 'fg' : 'bg');
  status.update((s) => ({ ...s, warming: queue.length < target(), error: null }));
  try {
    while (started && gen === switchGen && queue.length < target()) {
      const quick = urgent && queue.length === 0;
      const pack = await buildPack({ quick, theme });
      if (gen !== switchGen) break; // a switch happened mid-build — discard it
      queue.push(pack);
      errorAt = 0;
      persist();
      if (urgent) {
        urgent = false;
        setFetchMode('bg');
      }
      status.update((s) => (s.switching ? { ...s, switching: null } : s));
    }
    if (gen === switchGen) {
      status.update((s) => ({ ...s, warming: false, error: null, switching: null }));
      // queue full — pre-stock this type's candidate pool so the next builds
      // need no sourcing at all
      if (started) {
        if (activeTag === 'random') {
          if (!bucketsWarm()) void warmBuckets().catch(() => {});
        } else if (!themeWarm(activeTag)) {
          void warmTheme(activeTag).catch(() => {});
        }
      }
    }
  } catch (err) {
    if (gen === switchGen) {
      errorAt = Date.now();
      status.update((s) => ({
        ...s,
        warming: false,
        switching: null,
        error: err instanceof Error ? err.message : 'Could not reach Wikipedia.'
      }));
    }
  } finally {
    setFetchMode('bg');
    running = false;
    // the type changed under us, or someone asked again while we were busy
    const stale = gen !== switchGen;
    if (started && (wantRefill || stale)) {
      wantRefill = false;
      void refill(stale); // force past the error cooldown when the type changed
    }
  }
}

function onActivePackChange(tag: ActivePack): void {
  if (!started || tag === activeTag) return;
  stash.set(activeTag, queue);
  switchGen++;
  activeTag = tag;
  queue = (stash.get(tag) ?? []).filter(isPack);
  errorAt = 0;
  urgent = true;
  persist();
  status.update((s) => ({ ...s, ready: queue.length, error: null, switching: tag }));
  void refill();
}

function onOwnedPacksChange(): void {
  if (!started || activeTag === 'random') return;
  const t = target();
  if (queue.length > t) {
    // the player opened one — trim the surplus, don't discard the lot
    queue.length = t;
    persist();
  } else if (queue.length < t) {
    void refill();
  }
}

/** Call once, after the app mounts. */
export function start(): void {
  if (started) return;
  started = true;
  activeTag = get(activePack);
  restore();
  activePack.subscribe(onActivePackChange); // fires once synchronously — no-op (equal)
  ownedPacks.subscribe(onOwnedPacksChange);
  status.update((s) => ({ ...s, ready: queue.length }));
  void refill();
}

/** Pop the next ready pack, or null if none is ready yet. Triggers a refill. */
export function take(): Card[] | null {
  const pack = queue.shift() ?? null;
  persist();
  // an empty queue means someone is about to wait — build the next one fast
  if (!pack || queue.length === 0) urgent = true;
  // Deferred: the caller consumes an owned themed pack synchronously right after
  // this returns, and refill() reads that count. Refilling first would build a
  // themed pack the player no longer owns, only to discard it on the switch.
  queueMicrotask(() => void refill());
  // packs queued before a mechanic shipped need a top-up (mythic signatures);
  // applyMythicSignatures is a no-op for a card that already has one
  return pack ? applyMythicSignatures(pack) : null;
}

/** User-triggered retry after an error. */
export function retry(): void {
  errorAt = 0;
  urgent = true;
  status.update((s) => ({ ...s, error: null }));
  void refill(true);
}
