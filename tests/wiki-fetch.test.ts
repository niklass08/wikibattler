import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkCount, linksOf, searchEnriched, _setMinGap, _resetBreaker, setFetchMode } from '../src/lib/wiki';

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

describe('searchEnriched', () => {
  const capture = () => {
    const f = vi.fn(async (_url: RequestInfo | URL) => json({ query: { pages: [] } }));
    vi.stubGlobal('fetch', f);
    return f;
  };

  it('builds a random generator=search query', async () => {
    const f = capture();
    await searchEnriched('film OR movie', 20);
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain('generator=search');
    expect(url).toContain('gsrnamespace=0');
    expect(url).toContain('gsrsort=random');
    expect(url).toContain('gsrlimit=20');
    expect(url).toContain('gsrsearch=film+OR+movie');
    expect(url).not.toContain('gsroffset');
  });

  it('supports a paginated relevance sort', async () => {
    const f = capture();
    await searchEnriched('cancer', 10, 'relevance', 20);
    const url = String(f.mock.calls[0][0]);
    expect(url).toContain('gsrsort=relevance');
    expect(url).toContain('gsrlimit=10');
    expect(url).toContain('gsroffset=20');
  });

  it('short-circuits an empty query', async () => {
    const f = capture();
    expect(await searchEnriched('   ')).toEqual([]);
    expect(f).not.toHaveBeenCalled();
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
