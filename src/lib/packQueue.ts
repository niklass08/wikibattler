/**
 * Background prefetch of fully-assembled packs. Opening a pack pops one from the
 * front instantly; the queue refills in the background, so the slow-but-accurate
 * live path (keep fetching for a real uncommon, exact per-card link counts) never
 * blocks the player.
 *
 * Nothing here touches the network at import time — only `start()` does.
 */
import { writable } from 'svelte/store';
import type { Card } from './types';
import { buildPack } from './draw';

export const MAX_PREFETCH = 10;
const KEY = 'wikitcg:packqueue:v1';
/** After a failed refill, wait this long before an automatic retry. */
const ERROR_COOLDOWN_MS = 8000;

export interface QueueStatus {
  ready: number;
  warming: boolean;
  error: string | null;
}

export const status = writable<QueueStatus>({ ready: 0, warming: false, error: null });

let queue: Card[][] = [];
let running = false;
let started = false;
let errorAt = 0;

function isPack(p: unknown): p is Card[] {
  return Array.isArray(p) && p.length === 7 && p.every((c) => c && typeof c === 'object' && 'id' in c);
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* private mode / quota */
  }
  status.update((s) => ({ ...s, ready: queue.length }));
}

function restore(): void {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) queue = parsed.filter(isPack);
  } catch {
    queue = [];
  }
}

async function refill(force = false): Promise<void> {
  if (running || !started) return;
  if (!force && errorAt && Date.now() - errorAt < ERROR_COOLDOWN_MS) return;
  running = true;
  status.update((s) => ({ ...s, warming: queue.length < MAX_PREFETCH, error: null }));
  try {
    while (started && queue.length < MAX_PREFETCH) {
      queue.push(await buildPack());
      errorAt = 0;
      persist();
    }
    status.update((s) => ({ ...s, warming: false, error: null }));
  } catch (err) {
    errorAt = Date.now();
    status.update((s) => ({
      ...s,
      warming: false,
      error: err instanceof Error ? err.message : 'Could not reach Wikipedia.'
    }));
  } finally {
    running = false;
  }
}

/** Call once, after the app mounts. */
export function start(): void {
  if (started) return;
  started = true;
  restore();
  status.update((s) => ({ ...s, ready: queue.length }));
  void refill();
}

/** Pop the next ready pack, or null if none is ready yet. Triggers a refill. */
export function take(): Card[] | null {
  const pack = queue.shift() ?? null;
  persist();
  if (pack) void refill();
  return pack;
}

/** User-triggered retry after an error. */
export function retry(): void {
  errorAt = 0;
  status.update((s) => ({ ...s, error: null }));
  void refill(true);
}
