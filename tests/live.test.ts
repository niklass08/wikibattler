import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toCard,
  monthlyFromViews60,
  isPlayable,
  backupImage,
  _setMinGap,
  type WikiPage
} from '../src/lib/wiki';
import { buildPack, _resetSession } from '../src/lib/draw';

_setMinGap(0);

function page(over: Partial<WikiPage> = {}): WikiPage {
  return {
    pageid: 1,
    title: 'Example',
    url: 'https://en.wikipedia.org/wiki/Example',
    bytes: 40_000,
    extract: 'An article about something.',
    image: null,
    categories: [],
    disambiguation: false,
    views60: 1000,
    ...over
  };
}

describe('wiki helpers', () => {
  it('monthlyFromViews60 halves a 60-day sum', () => {
    expect(monthlyFromViews60(60_000)).toBe(30_000);
  });

  it('toCard maps views/bytes/links/categories to rarity/defence/strength/tags', () => {
    const c = toCard({
      page: page({
        pageid: 42,
        title: 'Cat',
        bytes: 170_000,
        categories: ['Domesticated animals', 'Cats', 'Cosmopolitan species']
      }),
      monthlyViews: 500_000,
      links: 900
    });
    expect(c.id).toBe(42);
    expect(c.title).toBe('Cat');
    expect(c.rarity).toBe('mythic');
    expect(c.foil).toBe(0);
    expect(c.tags).toContain('nature');
    expect(c.raw).toEqual({ links: 900, bytes: 170_000, monthlyViews: 500_000 });
    expect(c.strength).toBeGreaterThan(0);
    expect(c.defence).toBeGreaterThan(0);
  });

  it('isPlayable rejects stubs, disambiguation, empty extracts and junk titles', () => {
    expect(isPlayable(page())).toBe(true);
    expect(isPlayable(page({ bytes: 500 }))).toBe(false);
    expect(isPlayable(page({ disambiguation: true }))).toBe(false);
    expect(isPlayable(page({ extract: '' }))).toBe(false);
    expect(isPlayable(page({ title: 'Special:Random' }))).toBe(false);
  });
});

// --- canned Wikimedia responses --------------------------------------------

const hash = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return 900_000 + (Math.abs(h) % 90_000);
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function randomPagesBody(n: number) {
  const pages = Array.from({ length: n }, (_, i) => ({
    pageid: 1000 + i,
    title: `Random Article ${i}`,
    fullurl: `https://en.wikipedia.org/wiki/Random_Article_${i}`,
    length: 4000,
    extract: 'A modestly notable topic worth a card.',
    pageviews: { '2026-06-01': 5, '2026-06-02': 5 } // sum 10 -> monthly 5 -> common
  }));
  return { query: { pages } };
}

function topBody() {
  const band = (prefix: string, views: number, count: number, rank0: number) =>
    Array.from({ length: count }, (_, i) => ({
      article: `${prefix}_${i}`,
      views,
      rank: rank0 + i
    }));
  return {
    items: [
      {
        articles: [
          ...band('Mythic', 5_000_000, 10, 1),
          ...band('Rare', 250_000, 15, 20),
          ...band('Uncommon', 80_000, 20, 40)
        ]
      }
    ]
  };
}

function enrichBody(titles: string[]) {
  // no `thumbnail` — these articles have no lead image, so buildPack falls back
  const pages = titles.map((t) => ({
    pageid: hash(t),
    title: t.replace(/_/g, ' '),
    fullurl: `https://en.wikipedia.org/wiki/${t}`,
    length: 60_000,
    extract: `A detailed article about ${t}.`,
    pageviews: { a: 20_000, b: 20_000 }
  }));
  return { query: { pages } };
}

function mediaListBody(slug: string) {
  // popular seed titles have a gallery photo (plus chrome to filter); randoms don't
  const named = /Mythic|Rare|Uncommon/.test(slug);
  return {
    items: named
      ? [
          { type: 'image', showInGallery: true, title: 'File:Coat_of_arms.svg', srcset: [{ src: '//x/coa.png' }] },
          { type: 'image', showInGallery: true, title: `File:${slug}.jpg`, srcset: [{ src: `//upload.wikimedia.org/thumb/${slug}.jpg` }] }
        ]
      : []
  };
}

function linksBody() {
  return {
    parse: {
      links: Array.from({ length: 150 }, (_, i) => ({ ns: 0, title: `Linked ${i}`, exists: true }))
    }
  };
}

/** Batched `prop=links` query — 150 links per page, no truncation. */
function linkCountsBody(titles: string[]) {
  return {
    query: {
      pages: titles.map((t) => ({
        pageid: hash(t),
        title: t.replace(/_/g, ' '),
        links: Array.from({ length: 150 }, (_, i) => ({ ns: 0, title: `L${i}` }))
      }))
    }
  };
}

/** `generator=search` — 20 on-theme pages, banded by *offset* like the live API. */
function searchBody(offset: number, query: string) {
  // Mirrors the live API: a relevance-sorted search is ordered by prominence, so
  // the OFFSET selects a popularity band. Probed against en.wikipedia with
  // `hastemplate:"Infobox film"`: offset 0 → rare/mythic, ~100–400 → uncommon,
  // 1200+ → common. These are 60-day view sums; monthlyFromViews60 halves them.
  const band = (i: number) => {
    if (offset < 60) return i < 6 ? 1_200_000 : 500_000; // front → mythic / rare
    if (offset < 700) return 40_000; // middle → uncommon (20k/month)
    return 3_000; // deep → common (1.5k/month)
  };
  // different queries must yield different articles, as they do live
  const ns = 500_000 + (Math.abs(hash(query)) % 50) * 100_000;
  const pages = Array.from({ length: 20 }, (_, i) => ({
    pageid: ns + offset + i,
    title: `${query.slice(0, 24)} ${offset + i}`,
    fullurl: `https://en.wikipedia.org/wiki/T_${ns + offset + i}`,
    length: 55_000,
    extract: 'An article about a film directed by someone.',
    categories: [
      { title: 'Category:2001 films' },
      { title: 'Category:Films directed by Someone' }
    ],
    pageviews: { a: band(i) / 2, b: band(i) / 2 }
  }));
  return { query: { pages } };
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/metrics/pageviews/top/')) return jsonResponse(topBody());
  if (url.includes('/page/media-list/')) {
    return jsonResponse(mediaListBody(decodeURIComponent(url.split('/page/media-list/')[1])));
  }
  if (url.includes('generator=random')) return jsonResponse(randomPagesBody(20));
  if (url.includes('generator=search')) {
    const q = new URL(url).searchParams;
    return jsonResponse(searchBody(Number(q.get('gsroffset') ?? 0), q.get('gsrsearch') ?? ''));
  }
  if (url.includes('action=parse')) return jsonResponse(linksBody());
  const titles = new URL(url).searchParams.get('titles') ?? '';
  if (url.includes('action=query') && url.includes('prop=links')) {
    return jsonResponse(linkCountsBody(titles.split('|')));
  }
  if (titles) return jsonResponse(enrichBody(titles.split('|')));
  throw new Error(`unexpected request: ${url}`);
});

describe('buildPack (live assembly)', () => {
  beforeEach(() => {
    _resetSession();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('assembles a 7-card pack from API data, last card rare-or-better', async () => {
    const pack = await buildPack();
    const order = ['common', 'uncommon', 'rare', 'mythic'];
    const base = ['common', 'common', 'common', 'common', 'uncommon', 'uncommon', 'rare'];

    expect(pack).toHaveLength(7);
    expect(new Set(pack.map((c) => c.id)).size).toBe(7);

    // slot 7 is a guaranteed rare-or-better; no slot ever drops below its base
    expect(order.indexOf(pack[6].rarity)).toBeGreaterThanOrEqual(order.indexOf('rare'));
    pack.forEach((c, i) =>
      expect(order.indexOf(c.rarity)).toBeGreaterThanOrEqual(order.indexOf(base[i]))
    );

    // rare/mythic get an exact link count (parse call → 150); common/uncommon
    // estimate from byte length (no extra request)
    for (const c of pack) {
      if (c.rarity === 'rare' || c.rarity === 'mythic') expect(c.raw.links).toBe(150);
      else expect(c.raw.links).toBeGreaterThan(0);
    }
    expect(fetchMock).toHaveBeenCalled();
  }, 30_000);

  it('backupImage skips chrome, prefers a photo, and https-normalises', async () => {
    const url = await backupImage('Rare 3');
    expect(url).toBe('https://upload.wikimedia.org/thumb/Rare_3.jpg');
    expect(await backupImage('Some Random Stub')).toBeNull();
  });

  it('never reuses an article across consecutive packs', async () => {
    const a = await buildPack();
    const b = await buildPack();
    const overlap = a.filter((c) => b.some((d) => d.id === c.id));
    expect(overlap).toHaveLength(0);
  }, 30_000);

  it('builds a themed pack of on-theme cards, last card rare-or-better', async () => {
    const pack = await buildPack({ theme: 'cinema' });
    const order = ['common', 'uncommon', 'rare', 'mythic'];
    expect(pack).toHaveLength(7);
    expect(new Set(pack.map((c) => c.id)).size).toBe(7);
    for (const c of pack) expect(c.tags).toContain('cinema');
    expect(order.indexOf(pack[6].rarity)).toBeGreaterThanOrEqual(order.indexOf('rare'));
  }, 30_000);

  it('a themed pack shares no article with a random pack (shared usedIds)', async () => {
    const rnd = await buildPack();
    const themed = await buildPack({ theme: 'cinema' });
    expect(rnd.filter((c) => themed.some((d) => d.id === c.id))).toHaveLength(0);
  }, 30_000);
});

// The pool is the whole point of the sourcing rework: one batched pass stocks
// several packs, so consecutive builds must not touch the network.
describe('buildPack (candidate pooling)', () => {
  beforeEach(() => {
    _resetSession();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a themed pack sources once, then later packs of that theme are free', async () => {
    await buildPack({ theme: 'cinema' });
    // three banded search offsets, not the old 12-request sweep
    const firstSearches = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('generator=search')
    );
    expect(firstSearches.length).toBeLessThanOrEqual(3);

    fetchMock.mockClear();
    const second = await buildPack({ theme: 'cinema' });
    const third = await buildPack({ theme: 'cinema' });
    expect(second).toHaveLength(7);
    expect(third).toHaveLength(7);
    // drawn straight from the pool — only per-card link lookups may fire
    const searches = fetchMock.mock.calls.filter((c) => String(c[0]).includes('generator=search'));
    expect(searches).toHaveLength(0);
  }, 30_000);

  it('each theme keeps its own pool — switching back and forth re-sources nothing', async () => {
    await buildPack({ theme: 'cinema' });
    await buildPack({ theme: 'music' });
    fetchMock.mockClear();

    // back to cinema, then music again: both pools are still stocked
    await buildPack({ theme: 'cinema' });
    await buildPack({ theme: 'music' });
    const searches = fetchMock.mock.calls.filter((c) => String(c[0]).includes('generator=search'));
    expect(searches).toHaveLength(0);
  }, 30_000);

  it('consecutive random packs reuse the pool instead of re-sourcing', async () => {
    await buildPack();
    fetchMock.mockClear();
    const b = await buildPack();
    expect(b).toHaveLength(7);
    // no candidate sourcing — random/enrich/parse-links only for the rare stat
    const sourcing = fetchMock.mock.calls.filter((c) => {
      const u = String(c[0]);
      return u.includes('generator=random') || u.includes('/metrics/pageviews/top/');
    });
    expect(sourcing).toHaveLength(0);
  }, 30_000);
});

// A cold "quick" build (player waiting on an empty queue) must still produce a
// normal-shaped pack — an earlier version spent its whole budget on the rare
// bands and returned a pack with no commons at all.
describe('buildPack (cold quick build)', () => {
  beforeEach(() => {
    _resetSession();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('fills every rarity band on a tight budget', async () => {
    const pack = await buildPack({ quick: true });
    expect(pack).toHaveLength(7);
    expect(pack.filter((c) => c.rarity === 'common').length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
