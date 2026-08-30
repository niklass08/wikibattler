import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  linkCounts,
  linksOf,
  searchEnriched,
  _setMinGap,
  _resetBreaker,
  setFetchMode
} from '../src/lib/wiki';

_setMinGap(0);

const json = (body: unknown, init: Partial<Response> = {}): Response =>
  ({ ok: true, status: 200, json: async () => body, headers: { get: () => null }, ...init }) as unknown as Response;

beforeEach(() => {
  _resetBreaker();
  setFetchMode('bg');
});
afterEach(() => vi.unstubAllGlobals());

describe('linkCounts (batched)', () => {
  it('returns exact counts when the batch is not truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          query: {
            pages: [
              { pageid: 1, title: 'Alpha', links: new Array(12).fill({ ns: 0, title: 'x' }) },
              { pageid: 2, title: 'Beta', links: new Array(40).fill({ ns: 0, title: 'x' }) },
              { pageid: 3, title: 'Gamma', links: [] }
            ]
          }
        })
      )
    );
    const m = await linkCounts(['Alpha', 'Beta', 'Gamma']);
    expect(m.get('Alpha')).toBe(12);
    expect(m.get('Beta')).toBe(40);
    expect(m.get('Gamma')).toBe(0);
  });

  it('drops the truncated page and everything after it for the caller to fetch exactly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          continue: { plcontinue: '2|0|Some_Link' },
          query: {
            pages: [
              { pageid: 1, title: 'Alpha', links: new Array(30).fill({ ns: 0, title: 'x' }) },
              { pageid: 2, title: 'Beta', links: new Array(470).fill({ ns: 0, title: 'x' }) },
              { pageid: 3, title: 'Gamma', links: [] }
            ]
          }
        })
      )
    );
    const m = await linkCounts(['Alpha', 'Beta', 'Gamma']);
    expect(m.get('Alpha')).toBe(30); // complete
    expect(m.has('Beta')).toBe(false); // truncated
    expect(m.has('Gamma')).toBe(false); // after the truncation point
  });

  it('returns an empty map (caller fetches all) when the call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, { ok: false, status: 400 })));
    const m = await linkCounts(['Alpha']);
    expect(m.size).toBe(0);
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

    // enough calls to trip the breaker (4 consecutive 429s)
    for (let i = 0; i < 3; i++) {
      await expect(linksOf('X')).rejects.toThrow();
    }
    const callsBefore = f.mock.calls.length;

    // the breaker is now open — this rejects without hitting the network again
    await expect(linksOf('X')).rejects.toThrow(/rate-limiting|cooling down/i);
    expect(f.mock.calls.length).toBe(callsBefore);
  });
});
