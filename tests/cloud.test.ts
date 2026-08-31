import { describe, it, expect } from 'vitest';
import { mergeCollections, mergeEntry, mergeSide, type SideState } from '../src/lib/cloud/merge';
import { SHARDS, packShard, shardOf, splitShards, unpackShard } from '../src/lib/cloud/wire';
import type { Card, Collection, FoilTier, OwnedEntry, Rarity } from '../src/lib/types';

function card(id: number, over: Partial<Card> = {}): Card {
  return {
    id,
    title: `Article ${id}`,
    url: `https://en.wikipedia.org/wiki/Article_${id}`,
    extract: 'A short intro sentence. And a second one.',
    image: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/600px-${id}.jpg`,
    rarity: 'common' as Rarity,
    strength: 400,
    defence: 500,
    foil: 0,
    negated: false,
    signature: null,
    tags: ['cinema'],
    raw: { links: 120, bytes: 40000, monthlyViews: 9000 },
    ...over
  };
}

const entry = (id: number, count: number, at: string, over: Partial<Card> = {}): OwnedEntry => ({
  count,
  firstOpenedAt: at,
  card: card(id, over)
});

const asCollection = (...es: OwnedEntry[]): Collection =>
  Object.fromEntries(es.map((e) => [e.card.id, e]));

describe('merge — counts', () => {
  it('takes the max rather than summing, so re-syncing is a no-op', () => {
    const a = asCollection(entry(1, 3, '2026-01-01T00:00:00.000Z'));
    const b = asCollection(entry(1, 3, '2026-01-01T00:00:00.000Z'));
    expect(mergeCollections(a, b)[1].count).toBe(3);
    // and merging the result again still does not grow it
    expect(mergeCollections(mergeCollections(a, b), b)[1].count).toBe(3);
  });

  it('keeps the higher count when the two sides disagree', () => {
    const a = asCollection(entry(1, 2, '2026-01-01T00:00:00.000Z'));
    const b = asCollection(entry(1, 5, '2026-01-01T00:00:00.000Z'));
    expect(mergeCollections(a, b)[1].count).toBe(5);
    expect(mergeCollections(b, a)[1].count).toBe(5);
  });
});

describe('merge — card properties', () => {
  it('keeps the earliest acquisition date', () => {
    const merged = mergeEntry(
      entry(1, 1, '2026-03-01T00:00:00.000Z'),
      entry(1, 1, '2026-01-01T00:00:00.000Z')
    );
    expect(merged.firstOpenedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps the best finish from either side', () => {
    const merged = mergeEntry(
      entry(1, 1, 'x', { foil: 3 as FoilTier, negated: true }),
      entry(1, 1, 'x', { foil: 0, negated: false })
    );
    expect(merged.card.foil).toBe(3);
    expect(merged.card.negated).toBe(true);
  });

  it('never re-rolls a signature a card already had', () => {
    const merged = mergeEntry(
      entry(1, 1, 'x', { rarity: 'mythic', signature: 'cinema' }),
      entry(1, 1, 'x', { rarity: 'mythic', signature: 'war' })
    );
    expect(merged.card.signature).toBe('cinema');
  });

  it('does not lose art the other side is missing', () => {
    const merged = mergeEntry(
      entry(1, 1, 'x', { image: 'https://example.test/a.jpg' }),
      entry(1, 1, 'x', { image: null })
    );
    expect(merged.card.image).toBe('https://example.test/a.jpg');
  });

  it('is commutative on the fields a player accumulates', () => {
    const a = entry(1, 4, '2026-01-01T00:00:00.000Z', { foil: 2 as FoilTier });
    const b = entry(1, 2, '2026-05-01T00:00:00.000Z', { negated: true });
    const ab = mergeEntry(a, b);
    const ba = mergeEntry(b, a);
    expect(ab.count).toBe(ba.count);
    expect(ab.firstOpenedAt).toBe(ba.firstOpenedAt);
    expect(ab.card.foil).toBe(ba.card.foil);
    expect(ab.card.negated).toBe(ba.card.negated);
  });
});

describe('merge — union', () => {
  it('keeps cards unique to either side', () => {
    const merged = mergeCollections(
      asCollection(entry(1, 1, 'x'), entry(2, 1, 'x')),
      asCollection(entry(2, 1, 'x'), entry(3, 1, 'x'))
    );
    expect(Object.keys(merged).sort()).toEqual(['1', '2', '3']);
  });
});

describe('mergeSide', () => {
  const side = (over: Partial<SideState> = {}): SideState => ({
    favourites: [],
    knowledge: 0,
    packsOpened: 0,
    team: [],
    handle: '',
    updatedAt: 0,
    ...over
  });

  it('unions favourites and maxes the counters', () => {
    const m = mergeSide(
      side({ favourites: [1, 2], knowledge: 40, packsOpened: 7 }),
      side({ favourites: [2, 3], knowledge: 10, packsOpened: 12 })
    );
    expect(m.favourites).toEqual([1, 2, 3]);
    expect(m.knowledge).toBe(40);
    expect(m.packsOpened).toBe(12);
  });

  it('does not let an unset team clobber a chosen one', () => {
    const m = mergeSide(
      side({ team: [4, 5, 6], updatedAt: 1 }),
      side({ team: [], updatedAt: 99 })
    );
    expect(m.team).toEqual([4, 5, 6]);
  });

  it('takes the newer handle', () => {
    const m = mergeSide(side({ handle: 'Old', updatedAt: 1 }), side({ handle: 'New', updatedAt: 2 }));
    expect(m.handle).toBe('New');
  });
});

describe('wire — sharding', () => {
  it('buckets every id into range, including negatives', () => {
    for (const id of [0, 1, 7, 8, 12345, 999999, -3]) {
      expect(shardOf(id)).toBeGreaterThanOrEqual(0);
      expect(shardOf(id)).toBeLessThan(SHARDS);
    }
  });

  it('partitions a collection with nothing lost or duplicated', () => {
    const col = asCollection(...Array.from({ length: 200 }, (_, i) => entry(i * 3 + 1, 1, 'x')));
    const parts = splitShards(col);
    expect(parts).toHaveLength(SHARDS);
    const seen = parts.flatMap((p) => Object.keys(p));
    expect(seen).toHaveLength(200);
    expect(new Set(seen).size).toBe(200);
  });
});

describe('wire — round trip', () => {
  it('restores every field that is stored', async () => {
    const e = entry(42, 3, '2026-02-03T04:05:06.000Z', {
      rarity: 'mythic',
      signature: 'cinema',
      foil: 2 as FoilTier,
      negated: true,
      tags: ['cinema', 'music']
    });
    const back = await unpackShard(await packShard(asCollection(e)));
    expect(back[42].count).toBe(3);
    expect(back[42].firstOpenedAt).toBe('2026-02-03T04:05:06.000Z');
    expect(back[42].card).toMatchObject({
      id: 42,
      title: e.card.title,
      extract: e.card.extract,
      image: e.card.image,
      rarity: 'mythic',
      strength: e.card.strength,
      defence: e.card.defence,
      foil: 2,
      negated: true,
      signature: 'cinema',
      tags: ['cinema', 'music'],
      raw: e.card.raw
    });
  });

  it('rebuilds the url from the title rather than storing it', async () => {
    const e = entry(7, 1, 'x');
    e.card.title = 'Ada Lovelace';
    const back = await unpackShard(await packShard(asCollection(e)));
    expect(back[7].card.url).toBe('https://en.wikipedia.org/wiki/Ada_Lovelace');
  });

  it('round-trips a card with no image and no tags', async () => {
    const e = entry(9, 1, 'x', { image: null, tags: [] });
    const back = await unpackShard(await packShard(asCollection(e)));
    expect(back[9].card.image).toBeNull();
    expect(back[9].card.tags).toEqual([]);
    expect(back[9].card.foil).toBe(0);
    expect(back[9].card.negated).toBe(false);
  });

  it('returns an empty collection for a corrupt blob instead of throwing', async () => {
    expect(await unpackShard(new Uint8Array([1, 2, 3, 4, 5]))).toEqual({});
    expect(await unpackShard(new Uint8Array(0))).toEqual({});
  });
});

describe('wire — capacity', () => {
  it('keeps a very large collection inside the 1 MiB per-document cap', async () => {
    // 24,000 unique cards, three times what a browser's localStorage budget
    // allows, spread over the shards the way real ids would be
    const col: Collection = {};
    for (let i = 0; i < 24000; i++) {
      col[i * 7 + 3] = entry(i * 7 + 3, 2, '2026-01-01T00:00:00.000Z');
    }
    const parts = splitShards(col);
    const sizes = await Promise.all(parts.map((p) => packShard(p).then((b) => b.length)));
    for (const size of sizes) expect(size).toBeLessThan(1024 * 1024);
  });
});
