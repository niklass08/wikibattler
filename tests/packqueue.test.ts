import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// localStorage shim for the node env (shop.ts + packQueue.ts persist)
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

// a controllable buildPack: records which theme each call was for, and can be
// made slow so a switch can land mid-build
let buildLog: Array<string> = [];
let buildBlock: Promise<void> | null = null;
vi.mock('../src/lib/draw', () => ({
  buildPack: vi.fn(async (opts: { theme?: string } = {}) => {
    buildLog.push(opts.theme ?? 'random');
    if (buildBlock) await buildBlock;
    return Array.from({ length: 7 }, () => ({ id: Math.random(), rarity: 'common' }));
  }),
  warmBuckets: vi.fn(async () => {}),
  bucketsWarm: vi.fn(() => true)
}));
vi.mock('../src/lib/wiki', () => ({ setFetchMode: vi.fn() }));

const flush = () => new Promise((r) => setTimeout(r, 0));

let shop: typeof import('../src/lib/shop');
let queue: typeof import('../src/lib/packQueue');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', new MemStore());
  buildLog = [];
  buildBlock = null;
  shop = await import('../src/lib/shop');
  queue = await import('../src/lib/packQueue');
});

describe('packQueue — one pack type', () => {
  it('fills the random queue on start', async () => {
    queue.start();
    await flush();
    expect(get(queue.status).ready).toBe(queue.MAX_PREFETCH);
    expect(buildLog.every((t) => t === 'random')).toBe(true);
  });

  it('caps a themed queue at the number owned', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('cinema', 2);
    queue.start();
    await flush();
    shop.activePack.set('cinema');
    await flush();
    expect(get(queue.status).ready).toBe(2);
    expect(buildLog.filter((t) => t === 'cinema').length).toBe(2);
  });
});

describe('packQueue — switching while a build is in flight', () => {
  it('still fills the new type after a mid-build switch', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('cinema', 2);
    shop.buyPacks('vehicles', 3);

    // block builds so the switch lands mid-build
    let unblock!: () => void;
    buildBlock = new Promise<void>((r) => (unblock = r));

    queue.start(); // starts building 'random'
    await flush();
    expect(get(queue.status).ready).toBe(0); // blocked

    shop.activePack.set('cinema'); // switch #1, mid-build
    await flush();
    shop.activePack.set('vehicles'); // switch #2, still mid-build
    await flush();

    unblock(); // let every in-flight + queued build resolve
    buildBlock = null;
    // give the re-entrancy re-dispatch a few ticks
    for (let i = 0; i < 8; i++) await flush();

    expect(get(queue.status).ready).toBe(3); // vehicles: owns 3
    // the last 3 builds must be for vehicles
    expect(buildLog.slice(-3)).toEqual(['vehicles', 'vehicles', 'vehicles']);
  });

  it('picks up a buy that lands while building', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('cinema', 1);

    let unblock!: () => void;
    buildBlock = new Promise<void>((r) => (unblock = r));

    queue.start();
    await flush();
    shop.activePack.set('cinema');
    await flush(); // building cinema pack 1 (blocked)

    shop.buyPacks('cinema', 2); // now owns 3 — lands mid-build
    await flush();

    unblock();
    buildBlock = null;
    for (let i = 0; i < 8; i++) await flush();

    expect(get(queue.status).ready).toBe(3);
  });
});

describe('packQueue — switch-back uses the in-memory stash', () => {
  it('restores the other type’s built packs instantly', async () => {
    shop.knowledge.add(999);
    shop.buyPacks('cinema', 2);
    shop.buyPacks('music', 2);

    queue.start();
    await flush();
    shop.activePack.set('cinema');
    await flush();
    expect(get(queue.status).ready).toBe(2);
    const cinemaBuilds = buildLog.filter((t) => t === 'cinema').length;

    shop.activePack.set('music');
    await flush();
    shop.activePack.set('cinema'); // back
    await flush();

    // cinema queue restored from stash — no new cinema builds
    expect(get(queue.status).ready).toBe(2);
    expect(buildLog.filter((t) => t === 'cinema').length).toBe(cinemaBuilds);
  });
});
