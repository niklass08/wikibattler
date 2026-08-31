/**
 * How a collection is written to Firestore.
 *
 * Measured against 700 real random enwiki articles fetched through the app's own
 * enrich params: an OwnedEntry is ~659 bytes of JSON, ~177 bytes after
 * deflate-raw. A Firestore document caps at 1 MiB, so a single blob would stop
 * at roughly 5,900 unique cards — reachable by a long-running collection.
 *
 * Two things buy the headroom:
 *
 *   1. SHARDING. Entries are split across `SHARDS` documents by `id % SHARDS`,
 *      so the ceiling is ~47k unique cards. Sharding also fixes write
 *      amplification: opening a pack rewrites only the shards it touched, not
 *      the whole collection.
 *   2. LOSSLESS TRIMMING. `url` is dropped (it is a pure function of `title` —
 *      the same reconstruction `wiki.parsePages` already falls back to) and the
 *      Wikimedia upload prefix shared by every image URL is folded to one byte.
 *      Fields at their default (foil 0, not negated, no signature, no tags) are
 *      omitted and restored on read.
 *
 * `extract` is deliberately KEPT. It is the single biggest field (223 B/card,
 * about a third of the payload) and dropping it would roughly double the
 * ceiling — but it is the flavour text on the card detail view and cannot be
 * recomputed locally, so a restore onto a new device would come back visibly
 * degraded until every card was re-fetched. Sharding already provides more
 * headroom than trimming would, so the space is not needed.
 */
import type { Card, Collection, FoilTier, OwnedEntry, Rarity } from '../types';
import { RARITIES } from '../types';
import { deflate, inflate } from '../codec';

export const WIRE_VERSION = 1;

/** Number of documents a collection is split across. Changing this orphans
 *  existing shards, so it is part of the wire format, not a tunable. */
export const SHARDS = 8;

export const shardOf = (id: number): number => ((id % SHARDS) + SHARDS) % SHARDS;

const IMG_PREFIX = 'https://upload.wikimedia.org/wikipedia/';
const PROJECT = 'en.wikipedia';

const titleToUrl = (title: string): string =>
  `https://${PROJECT}.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;

/** One entry as it goes over the wire. Short keys; defaults omitted. */
interface WireEntry {
  n: number; // count
  t: string; // firstOpenedAt
  i: number; // id
  T: string; // title
  x: string; // extract
  m?: string; // image, upload prefix folded to "~"
  r: number; // rarity index
  s: number; // strength
  d: number; // defence
  f?: number; // foil tier, omitted when 0
  g?: 1; // negated, omitted when false
  q?: string; // signature, omitted when null
  a?: string[]; // tags, omitted when empty
  L: number; // raw.links
  B: number; // raw.bytes
  V: number; // raw.monthlyViews
}

function toWire(e: OwnedEntry): WireEntry {
  const c = e.card;
  const w: WireEntry = {
    n: e.count,
    t: e.firstOpenedAt,
    i: c.id,
    T: c.title,
    x: c.extract ?? '',
    r: Math.max(0, RARITIES.indexOf(c.rarity)),
    s: c.strength,
    d: c.defence,
    L: c.raw?.links ?? 0,
    B: c.raw?.bytes ?? 0,
    V: c.raw?.monthlyViews ?? 0
  };
  if (c.image) w.m = c.image.startsWith(IMG_PREFIX) ? `~${c.image.slice(IMG_PREFIX.length)}` : c.image;
  if (c.foil) w.f = c.foil;
  if (c.negated) w.g = 1;
  if (c.signature) w.q = c.signature;
  if (c.tags?.length) w.a = c.tags;
  return w;
}

/** Never throws — anything malformed is dropped, same contract as the
 *  localStorage loader in `collection.ts`. */
function fromWire(w: WireEntry): OwnedEntry | null {
  const id = Number(w?.i);
  if (!Number.isFinite(id)) return null;
  const title = typeof w.T === 'string' && w.T ? w.T : 'Unknown card';
  const image = typeof w.m === 'string' ? (w.m.startsWith('~') ? IMG_PREFIX + w.m.slice(1) : w.m) : null;
  const rarity: Rarity = RARITIES[Number(w.r)] ?? 'common';
  const card: Card = {
    id,
    title,
    url: titleToUrl(title),
    extract: typeof w.x === 'string' ? w.x : '',
    image,
    rarity,
    strength: Number(w.s) || 1,
    defence: Number(w.d) || 1,
    foil: ((Number(w.f) || 0) as FoilTier),
    negated: w.g === 1,
    signature: typeof w.q === 'string' ? w.q : null,
    tags: Array.isArray(w.a) ? w.a.filter((t): t is string => typeof t === 'string') : [],
    raw: { links: Number(w.L) || 0, bytes: Number(w.B) || 0, monthlyViews: Number(w.V) || 0 }
  };
  const count = Math.max(1, Math.floor(Number(w.n) || 1));
  const t = typeof w.t === 'string' && w.t ? w.t : new Date(0).toISOString();
  return { count, firstOpenedAt: t, card };
}

/** Split a collection into `SHARDS` buckets by card id. */
export function splitShards(col: Collection): Collection[] {
  const out: Collection[] = Array.from({ length: SHARDS }, () => ({}));
  for (const [key, entry] of Object.entries(col)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    out[shardOf(id)][id] = entry;
  }
  return out;
}

export async function packShard(part: Collection): Promise<Uint8Array> {
  const payload = { v: WIRE_VERSION, e: Object.values(part).map(toWire) };
  return deflate(new TextEncoder().encode(JSON.stringify(payload)));
}

export async function unpackShard(bytes: Uint8Array): Promise<Collection> {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await inflate(bytes)));
  } catch {
    return {};
  }
  const list = (raw as { e?: unknown })?.e;
  if (!Array.isArray(list)) return {};
  const out: Collection = {};
  for (const w of list) {
    const entry = fromWire(w as WireEntry);
    if (entry) out[entry.card.id] = entry;
  }
  return out;
}
