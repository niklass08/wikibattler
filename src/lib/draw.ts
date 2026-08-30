/**
 * Live pack assembly. Keeps a pool of scored candidates per rarity and hands it
 * to the pure `generatePack()` from pack.ts (a 4C/2U/1R modal pack where every
 * slot can roll upgrades).
 *
 * The pool is the point: sourcing is batched (one request yields ~20 candidates)
 * so a single sourcing pass feeds several packs. Most builds do **no** network
 * at all — they just draw from the pool. Sourcing only kicks in when a bucket
 * falls below `MIN`, and then fills it to `FILL`.
 *
 * Sources per rarity:
 *   rare/mythic — the pageviews "top" lists (one cached request lists 1000
 *                 titles with real view counts, already in the rare+ bands)
 *   uncommon    — outgoing links of a popular article: one `parse` harvests
 *                 hundreds of mid-popularity titles into a pool, then they are
 *                 enriched 20 at a time
 *   common      — generator=random (the overwhelming majority of articles)
 */
import type { Card, Rarity } from './types';
import { RARITIES } from './types';
import { generatePack, type RarityPools } from './pack';
import { applyPackFoil } from './foil';
import { applyMythicSignatures } from './signature';
import { rarityFromViews } from './rarity';
import * as wiki from './wiki';

const PACK_SIZE = 7;

interface Candidate {
  page: wiki.WikiPage;
  monthlyViews: number;
  /** exact ns-0 link count, resolved in the background; estimated until then */
  links?: number;
}

type Buckets = Record<Rarity, Candidate[]>;
const emptyBuckets = (): Buckets => ({ common: [], uncommon: [], rare: [], mythic: [] });
const countAll = (b: Buckets): number => RARITIES.reduce((n, r) => n + b[r].length, 0);

/** Source a rarity only once it falls below this. */
const MIN: Record<Rarity, number> = { common: 4, uncommon: 3, rare: 2, mythic: 1 };
/** ...then stock it to here, so one pass feeds several packs. */
const FILL: Record<Rarity, number> = { common: 20, uncommon: 14, rare: 10, mythic: 4 };

/** Requests a single sourcing pass may spend. `quick` = a player is waiting. */
const BUDGET = 8;
const QUICK_BUDGET = 3;

const CANDIDATES_KEY = 'wikitcg:candidates:v2';

/**
 * Estimated ns-0 link count, used when a card doesn't earn an exact `parse`
 * call. Deliberately mixes byte length with category count: defence is derived
 * from bytes, so a bytes-only estimate would make every card's strength a
 * function of its defence.
 */
const estLinks = (page: wiki.WikiPage): number =>
  Math.max(1, Math.round((page.bytes / 190) * 0.55 + (page.categories?.length ?? 0) * 12 * 0.45));

const shuffle = <T>(a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const randomOf = <T>(a: T[]): T | undefined => a[Math.floor(Math.random() * a.length)];
const looseEq = (a: string, b: string) =>
  a.replace(/ /g, '_').toLowerCase() === b.replace(/ /g, '_').toLowerCase();

// --- session state ----------------------------------------------------------

const buckets: Buckets = emptyBuckets();
/** pageids already dealt into a pack — never reuse. */
const usedIds = new Set<number>();
/** pageids sitting in any bucket — avoid stocking duplicates. */
const pendingIds = new Set<number>();

/** Popular titles harvested from "top" months, not yet enriched. */
const topByRarity: Record<Rarity, wiki.TopArticle[]> = {
  common: [],
  uncommon: [],
  rare: [],
  mythic: []
};
const topSeen = new Set<string>();
const fetchedMonths = new Set<string>();
/** Mid-popularity titles harvested from popular articles' links, not yet enriched. */
let linkPool: string[] = [];

// --- persistence ------------------------------------------------------------

let restored = false;

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode / quota */
  }
}

function adopt(into: Buckets, from: Buckets | undefined): void {
  for (const r of RARITIES) {
    for (const c of from?.[r] ?? []) {
      if (c?.page?.pageid && !usedIds.has(c.page.pageid) && !pendingIds.has(c.page.pageid)) {
        into[r].push(c);
        pendingIds.add(c.page.pageid);
      }
    }
  }
}

function restoreCandidates(): void {
  if (restored) return;
  restored = true;
  try {
    const raw = safeGet(CANDIDATES_KEY);
    if (raw) {
      const s = JSON.parse(raw) as {
        buckets?: Buckets;
        topByRarity?: Record<Rarity, wiki.TopArticle[]>;
        topSeen?: string[];
        fetchedMonths?: string[];
        linkPool?: string[];
      };
      adopt(buckets, s.buckets);
      for (const r of RARITIES) for (const t of s.topByRarity?.[r] ?? []) topByRarity[r].push(t);
      for (const t of s.topSeen ?? []) topSeen.add(t);
      for (const m of s.fetchedMonths ?? []) fetchedMonths.add(m);
      if (Array.isArray(s.linkPool)) linkPool = s.linkPool.slice(0, 400);
    }
  } catch {
    /* ignore a corrupt blob */
  }
}

function persistCandidates(): void {
  safeSet(
    CANDIDATES_KEY,
    JSON.stringify({
      buckets,
      topByRarity,
      topSeen: [...topSeen],
      fetchedMonths: [...fetchedMonths],
      linkPool: linkPool.slice(0, 400)
    })
  );
}

// Serialise everything that mutates the pools — a background warm must not run
// concurrently with a build.
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

// --- shared helpers ---------------------------------------------------------

function stashInto(target: Buckets, page: wiki.WikiPage, monthlyViews: number): boolean {
  if (usedIds.has(page.pageid) || pendingIds.has(page.pageid)) return false;
  if (!wiki.isPlayable(page)) return false;
  pendingIds.add(page.pageid);
  target[rarityFromViews(monthlyViews)].push({ page, monthlyViews });
  return true;
}

function dropConsumed(source: Buckets): void {
  for (const r of RARITIES) {
    source[r] = source[r].filter((c) => {
      const consumed = usedIds.has(c.page.pageid);
      if (consumed) pendingIds.delete(c.page.pageid);
      return !consumed;
    });
  }
}

function recentMonths(count: number, windowMonths: number): { y: number; m: number }[] {
  const base = new Date();
  base.setUTCDate(1); // exclude the incomplete current month
  const out: { y: number; m: number }[] = [];
  const picked = new Set<number>();
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const back = 1 + Math.floor(Math.random() * windowMonths);
    if (picked.has(back)) continue;
    picked.add(back);
    const d = new Date(base);
    d.setUTCMonth(d.getUTCMonth() - back);
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  }
  return out;
}

/** Pull in more "top" months until `rarity` has titles to enrich (or we give up). */
async function ensureTopSupply(rarity: Rarity, min = 8): Promise<void> {
  let guard = 0;
  while (topByRarity[rarity].length < min && guard++ < 3) {
    const next = recentMonths(1, 36).find((m) => !fetchedMonths.has(`${m.y}-${m.m}`));
    if (!next) break;
    fetchedMonths.add(`${next.y}-${next.m}`);
    let list: wiki.TopArticle[];
    try {
      list = await wiki.topMonth(next.y, next.m); // 30-day localStorage cached
    } catch {
      continue;
    }
    for (const a of list) {
      if (topSeen.has(a.title)) continue;
      topSeen.add(a.title);
      topByRarity[rarityFromViews(a.views)].push(a);
    }
    for (const r of RARITIES) shuffle(topByRarity[r]);
  }
}

// --- random sourcing --------------------------------------------------------

/** Enrich a batch of top-list titles into `buckets`, keeping their real views. */
async function enrichTop(picks: wiki.TopArticle[]): Promise<void> {
  const pages = await wiki.enrichTitles(picks.map((p) => p.title)).catch(() => []);
  for (const page of pages) {
    const known = picks.find((p) => looseEq(p.title, page.title));
    stashInto(buckets, page, known ? known.views : wiki.monthlyFromViews60(page.views60 ?? 0));
  }
}

/**
 * One sourcing step for a single rarity band. Returns the requests it spent —
 * 0 means the source is exhausted and retrying won't help.
 */
async function sourceOne(rarity: Rarity): Promise<number> {
  if (rarity === 'rare' || rarity === 'mythic') {
    await ensureTopSupply(rarity);
    const picks = topByRarity[rarity].splice(0, 20);
    if (picks.length === 0) return 0;
    await enrichTop(picks);
    return 1;
  }

  if (rarity === 'common') {
    // random mainspace articles are common almost by definition
    const pages = await wiki.randomEnriched(20).catch(() => []);
    if (pages.length === 0) return 1;
    for (const page of pages) stashInto(buckets, page, wiki.monthlyFromViews60(page.views60 ?? 0));
    return 1;
  }

  // uncommon — first the tail of the top lists (they carry real view counts),
  // then, since the mid-popularity middle is thin up there, a popular article's
  // outgoing links. That harvest is pooled and persisted, so the `parse` is paid
  // once per ~15 batches of candidates.
  const fromTop = topByRarity.uncommon.splice(0, 20);
  if (fromTop.length > 0) {
    await enrichTop(fromTop);
    return 1;
  }

  let spent = 0;
  if (linkPool.length < 20) {
    // seed from a popular article already in the pool, so this keeps working
    // once the un-enriched top lists have been drained
    const seed = randomOf([...buckets.mythic, ...buckets.rare]);
    const title = seed?.page.title ?? randomOf(topByRarity.rare)?.title;
    if (!title) return 0;
    spent++;
    const links = await wiki.linksOf(title).catch(() => []);
    if (links.length === 0) return spent;
    linkPool.push(...shuffle(links).slice(0, 300));
  }
  if (linkPool.length === 0) return spent;
  spent++;
  for (const page of await wiki.enrichTitles(linkPool.splice(0, 20)).catch(() => [])) {
    stashInto(buckets, page, wiki.monthlyFromViews60(page.views60 ?? 0));
  }
  return spent;
}

/**
 * Stock the random pool. Returns immediately (no network) unless a bucket has
 * fallen below `MIN` — so most pack builds cost nothing. `budget` caps the
 * requests one pass may spend.
 */
async function fillRandom(budget: number, force = false): Promise<number> {
  if (!force && !RARITIES.some((r) => buckets[r].length < MIN[r])) return 0;

  let spent = 0;

  // Phase 1 — one step per starved band, cheapest-and-most-needed first, so
  // even a tight `quick` budget yields a pack with all four rarities rather
  // than spending everything deepening one band.
  for (const r of RARITIES) {
    if (spent >= budget) break;
    if (buckets[r].length < MIN[r]) spent += await sourceOne(r);
  }

  // Phase 2 — spend what's left deepening toward FILL, so the next several
  // packs need no sourcing at all.
  for (const r of RARITIES) {
    while (spent < budget && buckets[r].length < FILL[r]) {
      const used = await sourceOne(r);
      if (used === 0) break;
      spent += used;
    }
  }
  return spent;
}

// --- rarity bands ------------------------------------------------------------
// A pack is 4 commons, 2 uncommons and a rare, so readiness is per band rather
// than a raw candidate count — a pool that is all one rarity can't make a pack.

type Band = 0 | 1 | 2;
const BANDS: Band[] = [0, 1, 2];
const bandHave = (b: Buckets, band: Band): number =>
  band === 0 ? b.rare.length + b.mythic.length : band === 1 ? b.uncommon.length : b.common.length;

// --- assembly (synchronous — never touches the network) ---------------------

function toStub(c: Candidate): Card {
  return {
    id: c.page.pageid,
    title: c.page.title,
    url: c.page.url,
    extract: c.page.extract,
    image: c.page.image,
    rarity: rarityFromViews(c.monthlyViews),
    strength: 0,
    defence: 0,
    foil: 0,
    negated: false,
    signature: null,
    tags: [],
    raw: { links: 0, bytes: c.page.bytes, monthlyViews: c.monthlyViews }
  };
}

/**
 * Turn pooled candidates into a finished pack. **Synchronous and network-free**
 * — link counts were resolved by the background stocker, so this is a pure
 * function of the pool and cannot interleave with it.
 */
function assembleSync(): Card[] {
  const byId = new Map<number, Candidate>();
  const pools: RarityPools = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const r of RARITIES) {
    for (const c of buckets[r]) {
      byId.set(c.page.pageid, c);
      pools[r].push(toStub(c));
    }
  }

  const chosen = generatePack(pools);
  const cands = chosen.map((stub) => byId.get(stub.id)!);
  for (const c of cands) usedIds.add(c.page.pageid);

  const cards = cands.map((cand) => {
    // an exact count if the stocker got to it, otherwise the estimate
    const links = cand.links ?? estLinks(cand.page);
    // `pilicense=any` covers most lead art; the rest is resolved lazily (and
    // persisted) by Card.svelte on reveal.
    return wiki.toCard({ page: cand.page, monthlyViews: cand.monthlyViews, links });
  });

  dropConsumed(buckets);
  return applyMythicSignatures(applyPackFoil(cards));
}

// --- readiness --------------------------------------------------------------

/** A pack wants 4 commons, 2 uncommons and a rare — plus slack for upgrade rolls. */
const READY_NEED: Record<Band, number> = { 0: 1, 1: 2, 2: 4 };

/** Can a pack be assembled from the pool right now, with no network? */
function canAssemble(): boolean {
  if (countAll(buckets) < PACK_SIZE) return false;
  return BANDS.every((band) => bandHave(buckets, band) >= READY_NEED[band]);
}

// --- public API -------------------------------------------------------------

/** True when a pack can be produced instantly, with no request. */
export function poolReady(): boolean {
  restoreCandidates();
  return canAssemble();
}

/** How many candidates are pooled. */
export function poolCount(): number {
  restoreCandidates();
  return countAll(buckets);
}

/** True once the pool is stocked well past a single pack — nothing left to do. */
export function poolFull(): boolean {
  restoreCandidates();
  return RARITIES.every((r) => buckets[r].length >= FILL[r]);
}

/**
 * Assemble a pack from the pool **right now**, or null if the pool can't cover
 * one yet. Synchronous: no request is made, so a stocked pool opens instantly.
 */
export function assemblePack(): Card[] | null {
  restoreCandidates();
  if (!canAssemble()) return null;
  const cards = assembleSync();
  persistCandidates();
  return cards;
}

/**
 * One unit of background work: a single sourcing request, or — when the pool is
 * already stocked — resolving one pooled card's exact link count so assembly
 * stays network-free.
 *
 * Returns the requests spent; 0 means there is nothing useful left to do.
 */
export function stockStep(): Promise<number> {
  return withLock(async () => {
    restoreCandidates();
    if (RARITIES.some((r) => buckets[r].length < FILL[r])) {
      const spent = await fillRandom(2, true);
      persistCandidates();
      if (spent > 0) return spent;
    }
    const spent = await resolveOneLinkCount();
    if (spent) persistCandidates();
    return spent;
  });
}

/**
 * Give one pooled rare/mythic its exact link count. Strength is the internal
 * link count and an exact figure is one `parse` call, so the stocker pays for
 * them in the background rather than making the player wait at assembly time.
 */
async function resolveOneLinkCount(): Promise<number> {
  for (const r of ['mythic', 'rare'] as const) {
    const cand = buckets[r].find((c) => c.links === undefined);
    if (!cand) continue;
    cand.links = await wiki.linkCount(cand.page.title).catch(() => estLinks(cand.page));
    return 1;
  }
  return 0;
}

/**
 * Stock until a pack can be assembled, then assemble it. The background stocker
 * normally gets there first — this is the blocking fallback for a cold start
 * (and what the tests drive).
 */
export async function buildPack(opts: { quick?: boolean } = {}): Promise<Card[]> {
  const budget = opts.quick ? QUICK_BUDGET : BUDGET;
  for (let i = 0; i < budget && !poolReady(); i++) {
    if ((await stockStep()) === 0) break;
  }
  const pack = assemblePack();
  if (!pack) throw new Error('Not enough Wikipedia articles to fill a pack — retrying shortly.');
  return pack;
}

/** Test hook — reset all session state. */
export function _resetSession(): void {
  for (const r of RARITIES) {
    buckets[r] = [];
    topByRarity[r] = [];
  }
  usedIds.clear();
  pendingIds.clear();
  topSeen.clear();
  fetchedMonths.clear();
  linkPool = [];
  restored = false;
  chain = Promise.resolve();
}
