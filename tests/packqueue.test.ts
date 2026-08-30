import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

// A model of draw.ts's candidate pools: one counter per pack type. Each stock
// step adds 10 cards to that type's pool; assembling a pack takes 7.
const PACK = 7;
const FULL = 24;
let pools: Map<string, number>;
let stockLog: string[];
const key = (t: string | null | undefined) => t ?? 'random';

vi.mock('../src/lib/draw', () => ({
  poolReady: (t?: string | null) => (pools.get(key(t)) ?? 0) >= PACK,
  poolCount: (t?: string | null) => pools.get(key(t)) ?? 0,
  poolFull: (t?: string | null) => (pools.get(key(t)) ?? 0) >= FULL,
  stockStep: vi.fn(async (t?: string | null) => {
    stockLog.push(key(t));
    pools.set(key(t), (pools.get(key(t)) ?? 0) + 10);
    return 1;
  }),
  assemblePack: vi.fn((t?: string | null) => {
    const k = key(t);
    const n = pools.get(k) ?? 0;
    if (n < PACK) return null;
    pools.set(k, n - PACK);
    return Array.from({ length: PACK }, (_, i) => ({ id: Math.random(), rarity: 'common', i }));
  })
}));
vi.mock('../src/lib/wiki', () => ({ setFetchMode: vi.fn() }));

let shop: typeof import('../src/lib/shop');
let queue: typeof import('../src/lib/packQueue');

/** let the stocker run for `ms` of its scheduled ticks */
const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', new MemStore());
  pools = new Map();
  stockLog = [];
  shop = await import('../src/lib/shop');
  queue = await import('../src/lib/packQueue');
});
afterEach(() => {
  queue._stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('background stocker', () => {
  it('stocks the random pool from start, with no pack pre-built', async () => {
    queue.start();
    await run(100);
    expect(get(queue.status).ready).toBe(true);
    expect(stockLog.every((t) => t === 'random')).toBe(true);
  });

  it('keeps stocking past a single pack, then idles', async () => {
    queue.start();
    await run(20_000);
    expect(pools.get('random')!).toBeGreaterThanOrEqual(FULL);
    const afterFull = stockLog.length;
    await run(60_000); // fully stocked — should be quiet now
    expect(stockLog.length).toBe(afterFull);
  });

  it('take() assembles instantly from a stocked pool', async () => {
    queue.start();
    await run(100);
    const before = pools.get('random')!;
    const pack = queue.take();
    expect(pack).toHaveLength(PACK);
    expect(pools.get('random')).toBe(before - PACK); // drawn from stock, not built
  });

  it('take() returns null on a cold pool and the stocker fills it', async () => {
    // not started: nothing has been stocked
    expect(queue.take()).toBeNull();
    queue.start();
    await run(200);
    expect(queue.take()).toHaveLength(PACK);
  });
});

describe('stocker priorities', () => {
  it('switches its target to the pack type the player selects', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('religion', 3);
    queue.start();
    await run(5_000); // random gets stocked first

    stockLog.length = 0;
    shop.activePack.set('religion');
    await run(2_000);
    expect(stockLog[0]).toBe('religion'); // re-targeted immediately
  });

  it('a selected theme with a stocked pool opens instantly, no fetch', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('religion', 3);
    queue.start();
    shop.activePack.set('religion');
    await run(5_000);

    stockLog.length = 0;
    const pack = queue.take();
    expect(pack).toHaveLength(PACK);
    expect(stockLog).toHaveLength(0); // assembled straight out of stock
  });

  it('stocks the themes the player owns even while random is selected', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('religion', 2);
    shop.buyPacks('cinema', 2);
    queue.start();
    await run(60_000);

    expect(pools.get('religion') ?? 0).toBeGreaterThanOrEqual(PACK);
    expect(pools.get('cinema') ?? 0).toBeGreaterThanOrEqual(PACK);
  });

  it('switching between held themes opens instantly, with no wait', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('religion', 2);
    shop.buyPacks('cinema', 2);
    queue.start();
    await run(60_000); // everything stocked

    // no `run` between selecting and opening: both must come straight from stock
    stockLog.length = 0;
    shop.activePack.set('religion');
    expect(queue.take()).toHaveLength(PACK);
    shop.activePack.set('cinema');
    expect(queue.take()).toHaveLength(PACK);
    expect(stockLog).toHaveLength(0);
    expect(get(queue.status).switching).toBeNull();
  });

  it('reports the active type readiness and stock level', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('religion', 1);
    queue.start();
    await run(60_000);
    shop.activePack.set('religion');
    await run(1_000);

    const s = get(queue.status);
    expect(s.ready).toBe(true);
    expect(s.stocked).toBe(pools.get('religion'));
  });
});
