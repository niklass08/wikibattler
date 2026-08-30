import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

// A model of draw.ts's candidate pool: one counter. Each stock step adds 10
// cards; assembling a pack takes 7.
const PACK = 7;
const FULL = 24;
let pool: number;
let steps: number;

vi.mock('../src/lib/draw', () => ({
  poolReady: () => pool >= PACK,
  poolCount: () => pool,
  poolFull: () => pool >= FULL,
  stockStep: vi.fn(async () => {
    steps++;
    pool += 10;
    return 1;
  }),
  assemblePack: vi.fn(() => {
    if (pool < PACK) return null;
    pool -= PACK;
    return Array.from({ length: PACK }, () => ({ id: Math.random(), rarity: 'common' }));
  })
}));
vi.mock('../src/lib/wiki', () => ({ setFetchMode: vi.fn() }));

let queue: typeof import('../src/lib/packQueue');

/** let the stocker run through `ms` of its scheduled ticks */
const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  pool = 0;
  steps = 0;
  queue = await import('../src/lib/packQueue');
});
afterEach(() => {
  queue._stop();
  vi.useRealTimers();
});

describe('background stocker', () => {
  it('stocks the pool from start, with no pack pre-built', async () => {
    expect(get(queue.status).ready).toBe(false);
    queue.start();
    await run(100);
    expect(get(queue.status).ready).toBe(true);
    expect(steps).toBeGreaterThan(0);
  });

  it('keeps stocking past a single pack, then idles', async () => {
    queue.start();
    await run(20_000);
    expect(pool).toBeGreaterThanOrEqual(FULL);
    const afterFull = steps;
    await run(120_000); // fully stocked — should be quiet now
    expect(steps).toBe(afterFull);
  });

  it('take() assembles instantly from a stocked pool', async () => {
    queue.start();
    await run(100);
    const before = pool;
    const pack = queue.take();
    expect(pack).toHaveLength(PACK);
    expect(pool).toBe(before - PACK); // drawn from stock, not built
  });

  it('take() returns null on a cold pool, and the stocker fills it', async () => {
    expect(queue.take()).toBeNull(); // not started: nothing stocked
    queue.start();
    await run(200);
    expect(queue.take()).toHaveLength(PACK);
  });

  it('tops the pool back up after packs drain it', async () => {
    queue.start();
    await run(60_000);
    for (let i = 0; i < 3; i++) queue.take();
    await run(60_000);
    expect(pool).toBeGreaterThanOrEqual(FULL);
  });

  it('reports readiness and stock level', async () => {
    queue.start();
    await run(60_000);
    const s = get(queue.status);
    expect(s.ready).toBe(true);
    expect(s.stocked).toBe(pool);
    expect(s.error).toBeNull();
  });
});
