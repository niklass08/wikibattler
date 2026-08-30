/**
 * The background stocker. It runs for the whole life of the app — whatever view
 * the player is on — keeping a **pool of cards** topped up.
 *
 * Packs are not pre-built. `take()` assembles one out of the pool the moment the
 * player asks, synchronously: if there are already seven cards in stock, the
 * pack opens instantly. The stocker's whole job is making sure that is true
 * before they click.
 *
 * Nothing here touches the network at import time — only `start()` does.
 */
import { writable } from 'svelte/store';
import type { Card } from './types';
import { assemblePack, poolReady, poolCount, poolFull, stockStep } from './draw';
import { setFetchMode } from './wiki';

/** Cadence: how long to wait before the next unit of background work. */
const TICK_URGENT = 150; // the player is waiting on a pool that can't build yet
const TICK_ACTIVE = 1_500; // stocking ahead
const TICK_IDLE = 20_000; // everything stocked — just poll for changes
/** After a failed step, back off this long before trying again. */
const ERROR_COOLDOWN_MS = 8_000;

export interface QueueStatus {
  /** a pack can be assembled right now */
  ready: boolean;
  /** candidates pooled */
  stocked: number;
  /** the stocker is fetching */
  warming: boolean;
  error: string | null;
}

export const status = writable<QueueStatus>({
  ready: false,
  stocked: 0,
  warming: false,
  error: null
});

let started = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let errorAt = 0;
/** the player has asked for a pack the pool can't cover yet */
let waiting = false;

function publish(): void {
  status.update((s) => ({ ...s, ready: poolReady(), stocked: poolCount() }));
}

function schedule(ms: number): void {
  clearTimeout(timer);
  if (!started) return;
  timer = setTimeout(() => void tick(), ms);
}

async function tick(): Promise<void> {
  if (!started || running) return;
  if (errorAt && Date.now() - errorAt < ERROR_COOLDOWN_MS) {
    schedule(ERROR_COOLDOWN_MS);
    return;
  }

  publish();
  if (poolFull()) {
    status.update((s) => ({ ...s, warming: false }));
    schedule(TICK_IDLE);
    return;
  }

  const urgent = !poolReady() || waiting;
  running = true;
  // a player staring at a spinner gets the impatient retry profile
  setFetchMode(urgent ? 'fg' : 'bg');
  status.update((s) => ({ ...s, warming: true, error: null }));
  try {
    const spent = await stockStep();
    errorAt = 0;
    publish();
    schedule(spent === 0 ? TICK_IDLE : urgent ? TICK_URGENT : TICK_ACTIVE);
  } catch (err) {
    errorAt = Date.now();
    status.update((s) => ({
      ...s,
      warming: false,
      error: err instanceof Error ? err.message : 'Could not reach Wikipedia.'
    }));
    schedule(ERROR_COOLDOWN_MS);
  } finally {
    setFetchMode('bg');
    running = false;
  }
}

/** Nudge the stocker to reconsider right away. */
function kick(): void {
  if (!started) return;
  publish();
  if (!running) schedule(0);
}

/** Call once, after the app mounts. Runs for the life of the session. */
export function start(): void {
  if (started) return;
  started = true;
  publish();
  schedule(0);
}

/**
 * Assemble a pack from the pool, or null if it can't cover one yet.
 * Synchronous — a stocked pool opens with no request at all.
 */
export function take(): Card[] | null {
  const pack = assemblePack();
  waiting = pack === null;
  kick();
  return pack;
}

/** User-triggered retry after an error. */
export function retry(): void {
  errorAt = 0;
  waiting = true;
  status.update((s) => ({ ...s, error: null }));
  kick();
}

/** Test hook — stop the background loop. */
export function _stop(): void {
  started = false;
  waiting = false;
  errorAt = 0;
  clearTimeout(timer);
}
