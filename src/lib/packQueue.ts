/**
 * The background stocker. It runs for the whole life of the app — whatever view
 * the player is on — keeping a **pool of cards** topped up for the random pack
 * and for every theme the player holds packs for.
 *
 * Packs are not pre-built. `take()` assembles one out of the pool the moment the
 * player asks, synchronously: if there are already seven religion cards in
 * stock, the religion pack opens instantly. The stocker's whole job is making
 * sure that is true before they click.
 *
 * Priority each tick: the pack type the player is about to open (aggressively,
 * if its pool can't cover a pack yet), then the themes they own, then random.
 *
 * Nothing here touches the network at import time — only `start()` does.
 */
import { get, writable } from 'svelte/store';
import type { Card } from './types';
import { assemblePack, poolReady, poolCount, poolFull, stockStep } from './draw';
import type { Tag } from './tags';
import { setFetchMode } from './wiki';
import { activePack, ownedPacks, ownedThemes, type ActivePack } from './shop';

/** Cadence: how long to wait before the next unit of background work. */
const TICK_URGENT = 150; // the player is waiting on a pool that can't build yet
const TICK_ACTIVE = 1_500; // stocking ahead for the type they're on
const TICK_IDLE = 20_000; // everything stocked — just poll for changes
/** After a failed step, back off this long before trying again. */
const ERROR_COOLDOWN_MS = 8_000;

export interface QueueStatus {
  /** a pack of the active type can be assembled right now */
  ready: boolean;
  /** candidates pooled for the active type */
  stocked: number;
  /** the stocker is fetching */
  warming: boolean;
  error: string | null;
  /** set while the pool for a newly-selected type is still filling */
  switching: ActivePack | null;
}

export const status = writable<QueueStatus>({
  ready: false,
  stocked: 0,
  warming: false,
  error: null,
  switching: null
});

let started = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let errorAt = 0;
/** the player has asked for a pack the pool can't cover yet */
let waiting = false;

const themeOf = (p: ActivePack): Tag | null => (p === 'random' ? null : p);

function publish(): void {
  const active = themeOf(get(activePack));
  const ready = poolReady(active);
  status.update((s) => ({
    ...s,
    ready,
    stocked: poolCount(active),
    switching: ready ? null : s.switching
  }));
}

/**
 * What to stock next. The type the player is about to open comes first; a type
 * that can't build a pack yet outranks one that is merely topping up.
 */
function nextTarget(): { theme: Tag | null; urgent: boolean } | null {
  const active = themeOf(get(activePack));
  if (!poolReady(active)) return { theme: active, urgent: true };

  // then the active type again, stocking ahead
  if (!poolFull(active)) return { theme: active, urgent: false };

  // then any theme they hold packs for but couldn't open instantly
  for (const t of ownedThemes(get(ownedPacks))) {
    if (!poolReady(t)) return { theme: t, urgent: false };
  }
  // then random, so switching back to it is instant too
  if (!poolFull(null)) return { theme: null, urgent: false };
  for (const t of ownedThemes(get(ownedPacks))) {
    if (!poolFull(t)) return { theme: t, urgent: false };
  }
  return null;
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

  const target = nextTarget();
  publish();
  if (!target) {
    status.update((s) => ({ ...s, warming: false }));
    schedule(TICK_IDLE);
    return;
  }

  running = true;
  // a player staring at a spinner gets the impatient retry profile
  setFetchMode(target.urgent || waiting ? 'fg' : 'bg');
  status.update((s) => ({ ...s, warming: true, error: null }));
  try {
    const spent = await stockStep(target.theme);
    errorAt = 0;
    publish();
    // nothing left to do for this target — come back around promptly to pick
    // the next one, or idle if everything is stocked
    schedule(spent === 0 ? TICK_ACTIVE : target.urgent ? TICK_URGENT : TICK_ACTIVE);
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

/** Nudge the stocker to reconsider its target right away. */
function kick(): void {
  if (!started) return;
  publish();
  if (!running) schedule(0);
}

/** Call once, after the app mounts. Runs for the life of the session. */
export function start(): void {
  if (started) return;
  started = true;
  // re-target whenever the player switches pack type or buys packs
  activePack.subscribe(() => {
    const active = themeOf(get(activePack));
    if (!poolReady(active)) {
      status.update((s) => ({ ...s, switching: get(activePack) }));
    }
    kick();
  });
  ownedPacks.subscribe(kick);
  publish();
  schedule(0);
}

/**
 * Assemble a pack of the active type from the pool, or null if it can't cover
 * one yet. Synchronous — a stocked pool opens with no request at all.
 */
export function take(): Card[] | null {
  const pack = assemblePack(themeOf(get(activePack)));
  waiting = pack === null;
  // the caller consumes an owned themed pack synchronously right after this
  // returns, so let that land before the stocker re-targets
  queueMicrotask(kick);
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
