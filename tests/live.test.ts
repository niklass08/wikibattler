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

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/metrics/pageviews/top/')) return jsonResponse(topBody());
  if (url.includes('/page/media-list/')) {
    return jsonResponse(mediaListBody(decodeURIComponent(url.split('/page/media-list/')[1])));
  }
  if (url.includes('generator=random')) return jsonResponse(randomPagesBody(12));
  if (url.includes('action=parse')) return jsonResponse(linksBody());
  const titles = new URL(url).searchParams.get('titles') ?? '';
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

    // each card carries an exact link count fetched per-card
    for (const c of pack) expect(c.raw.links).toBe(150);
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
});
