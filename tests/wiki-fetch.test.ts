import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkCount, linksOf, _setMinGap, _resetBreaker, setFetchMode } from '../src/lib/wiki';

_setMinGap(0);

const json = (body: unknown, init: Partial<Response> = {}): Response =>
  ({ ok: true, status: 200, json: async () => body, headers: { get: () => null }, ...init }) as unknown as Response;

beforeEach(() => {
  _resetBreaker();
  setFetchMode('bg');
});
afterEach(() => vi.unstubAllGlobals());

describe('linkCount', () => {
  it('counts ns-0 links that exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          parse: {
            links: [
              { ns: 0, title: 'A', exists: true },
              { ns: 0, title: 'B', exists: true },
              { ns: 0, title: 'Redlink', exists: false }, // dropped
              { ns: 14, title: 'Category:X', exists: true } // dropped
            ]
          }
        })
      )
    );
    expect(await linkCount('Whatever')).toBe(2);
  });
});

describe('rate-limit circuit breaker', () => {
  it('fails fast once Wikimedia has 429-ed a run of calls', async () => {
    const f = vi.fn(async () => json({}, { ok: false, status: 429 }));
    vi.stubGlobal('fetch', f);
    setFetchMode('fg'); // 2 tries per call, short backoff

    // enough 429s to trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(linksOf('X')).rejects.toThrow();
    }
    const callsBefore = f.mock.calls.length;

    // the breaker is now open — this rejects without hitting the network again
    await expect(linksOf('X')).rejects.toThrow(/rate-limiting|cooling down/i);
    expect(f.mock.calls.length).toBe(callsBefore);
  });
});
