/**
 * Live pack assembly. Fills a candidate pool per rarity from the right API
 * source, then hands it to the pure `generatePack()` from pack.ts (a 4C/2U/1R
 * modal pack where every slot can roll upgrades).
 *
 * Sources per rarity:
 *   common   — generator=random (the overwhelming majority of articles)
 *   rare     — pageviews "top" lists, views in the rare band
 *   mythic   — pageviews "top" lists, views above the mythic threshold
 *   uncommon — "top" list tails, then outgoing links of a popular article
 *              (the mid-popularity middle is too thin in the top 1000)
 */
import type { Card, Rarity } from './types';
import { RARITIES } from './types';
import { generatePack, type RarityPools } from './pack';
import { applyPackFoil } from './foil';
import { applyMythicSignatures } from './signature';
import { rarityFromViews } from './rarity';
import { deriveTags, type Tag } from './tags';
import { THEMES } from './themes';
import * as wiki from './wiki';

type Buckets = Record<Rarity, Candidate[]>;
const emptyBuckets = (): Buckets => ({ common: [], uncommon: [], rare: [], mythic: [] });

/**
 * How many candidates to stock per rarity before assembling a pack. Above the
 * modal 4C / 2U / 1R so upgrade rolls have cards to draw from; generatePack's
 * fallback covers the rare case where they don't.
 */
const TARGET: Record<Rarity, number> = { common: 7, uncommon: 5, rare: 4, mythic: 2 };

/**
 * A "quick" first pack after a cold start (empty queue, player waiting): stock
 * the bare minimum so the first open is fast; the queue refills properly after.
 */
const QUICK_TARGET: Record<Rarity, number> = { common: 5, uncommon: 2, rare: 2, mythic: 1 };

/**
 * Background warm target — stock a little past what one pack needs so the next
 * couple of builds do less sourcing. Filled by `warmBuckets()` in small bounded
 * steps while the player is looking at a pack.
 */
const WARM_TARGET: Record<Rarity, number> = { common: 12, uncommon: 8, rare: 6, mythic: 3 };

const CANDIDATES_KEY = 'wikitcg:candidates:v1';

/** Rough internal-link count from wikitext byte length — ~1 ns-0 link per 190 B. */
const estLinks = (bytes: number): number => Math.max(1, Math.round(bytes / 190));

const shuffle = <T>(a: T[]): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const randomOf = <T>(a: T[]): T | undefined => a[Math.floor(Math.random() * a.length)];

interface Candidate {
  page: wiki.WikiPage;
  monthlyViews: number;
}

// --- session state (module-level; one run of the app) -----------------------

const buckets: Record<Rarity, Candidate[]> = {
  common: [],
  uncommon: [],
  rare: [],
  mythic: []
};
/** pageids already dealt into a pack — never reuse. */
const usedIds = new Set<number>();
/** pageids sitting in a bucket — avoid stocking duplicates. */
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

// --- persistence: warm candidates survive a reload -------------------------

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

function restoreCandidates(): void {
  if (restored) return;
  restored = true;
  try {
    const raw = safeGet(CANDIDATES_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as {
      buckets?: Record<Rarity, Candidate[]>;
      topByRarity?: Record<Rarity, wiki.TopArticle[]>;
      topSeen?: string[];
      fetchedMonths?: string[];
    };
    for (const r of RARITIES) {
      for (const c of s.buckets?.[r] ?? []) {
        if (c?.page?.pageid && !usedIds.has(c.page.pageid) && !pendingIds.has(c.page.pageid)) {
          buckets[r].push(c);
          pendingIds.add(c.page.pageid);
        }
      }
      for (const t of s.topByRarity?.[r] ?? []) topByRarity[r].push(t);
    }
    for (const t of s.topSeen ?? []) topSeen.add(t);
    for (const m of s.fetchedMonths ?? []) fetchedMonths.add(m);
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
      fetchedMonths: [...fetchedMonths]
    })
  );
}

// Serialise everything that mutates the shared buckets — a background
// `warmBuckets()` must not run concurrently with a `buildPack()`.
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
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
  while (topByRarity[rarity].length < min && guard++ < 10) {
    const next = recentMonths(1, 24).find((m) => !fetchedMonths.has(`${m.y}-${m.m}`));
    if (!next) break;
    fetchedMonths.add(`${next.y}-${next.m}`);
    let list: wiki.TopArticle[];
    try {
      list = await wiki.topMonth(next.y, next.m);
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

function stash(page: wiki.WikiPage, monthlyViews: number): void {
  if (usedIds.has(page.pageid) || pendingIds.has(page.pageid)) return;
  if (!wiki.isPlayable(page)) return;
  pendingIds.add(page.pageid);
  buckets[rarityFromViews(monthlyViews)].push({ page, monthlyViews });
}

const looseEq = (a: string, b: string) =>
  a.replace(/ /g, '_').toLowerCase() === b.replace(/ /g, '_').toLowerCase();

/** Top up one bucket to `need` candidates from its source. */
async function topUp(rarity: Rarity, need: number, guardMax = 25): Promise<void> {
  let guard = 0;
  while (buckets[rarity].length < need && guard++ < guardMax) {
    if (rarity === 'common') {
      for (const page of await wiki.randomEnriched(20)) {
        stash(page, wiki.monthlyFromViews60(page.views60 ?? 0));
      }
      continue;
    }

    if (rarity === 'rare' || rarity === 'mythic') {
      await ensureTopSupply(rarity);
      const picks = topByRarity[rarity].splice(0, 20);
      if (picks.length === 0) break;
      const pages = await wiki.enrichTitles(picks.map((p) => p.title));
      for (const page of pages) {
        const known = picks.find((p) => looseEq(p.title, page.title));
        stash(page, known ? known.views : wiki.monthlyFromViews60(page.views60 ?? 0));
      }
      continue;
    }

    // uncommon: top-list tails, then harvest links off a popular article
    await ensureTopSupply('rare');
    let titles = topByRarity.uncommon.splice(0, 20).map((p) => p.title);
    if (titles.length < 12) {
      const seed = randomOf([...topByRarity.rare, ...topByRarity.mythic]);
      if (seed) {
        const links = shuffle(await wiki.linksOf(seed.title));
        titles = titles.concat(links.slice(0, 20 - titles.length));
      }
    }
    if (titles.length === 0) break;
    for (const page of await wiki.enrichTitles(titles)) {
      stash(page, wiki.monthlyFromViews60(page.views60 ?? 0));
    }
  }
}

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
 * Stock the buckets to `targets`. `common` (random articles) is independent of
 * the top-list group, so the two run in parallel; the top-list rarities share
 * `topByRarity` and stay sequential among themselves.
 */
async function stockBuckets(targets: Record<Rarity, number>, guardMax = 25): Promise<void> {
  await Promise.all([
    topUp('common', targets.common, guardMax),
    (async () => {
      await topUp('rare', targets.rare, guardMax);
      await topUp('mythic', targets.mythic, guardMax);
      await topUp('uncommon', targets.uncommon, guardMax);
    })()
  ]);
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

/**
 * The theme-agnostic assembly tail, shared by the random and themed paths: let
 * `generatePack()` choose the 7 with the guaranteed split, fetch link counts
 * (one batched call + parallel exact fallback), and apply the finishes.
 */
async function assembleFrom(source: Buckets, opts: { persist: boolean }): Promise<Card[]> {
  const byId = new Map<number, Candidate>();
  const pools: RarityPools = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const r of RARITIES) {
    for (const c of source[r]) {
      byId.set(c.page.pageid, c);
      pools[r].push(toStub(c));
    }
  }

  const chosen = generatePack(pools);
  if (chosen.length < 7) {
    throw new Error('Not enough Wikipedia articles to fill a pack — retrying shortly.');
  }

  const cands = chosen.map((stub) => byId.get(stub.id)!);
  for (const c of cands) usedIds.add(c.page.pageid);

  const cards = await Promise.all(
    cands.map(async (cand) => {
      const rarity = rarityFromViews(cand.monthlyViews);
      // Strength = internal link count. An exact count is one `parse` call each —
      // too many for a browser client — so only rare/mythic (where the stat is
      // battle-relevant and the article is big enough for the estimate to be
      // shaky) get the real number; common/uncommon estimate from byte length.
      const links =
        rarity === 'rare' || rarity === 'mythic'
          ? await wiki.linkCount(cand.page.title).catch(() => estLinks(cand.page.bytes))
          : estLinks(cand.page.bytes);
      // `pilicense=any` covers most lead art; the rest is resolved lazily
      // (and persisted) by Card.svelte on reveal.
      return wiki.toCard({ page: cand.page, monthlyViews: cand.monthlyViews, links });
    })
  );

  dropConsumed(source);
  if (opts.persist) persistCandidates();
  return applyMythicSignatures(applyPackFoil(cards));
}

// --- themed sourcing --------------------------------------------------------
// Separate from the random `buckets` — one theme is active at a time. usedIds /
// pendingIds stay shared so no article shows up in two packs.

let themedTag: Tag | null = null;
const themedBuckets: Buckets = emptyBuckets();
/** pageids that failed the deriveTags check this session — never re-verify. */
const themedRejects = new Set<number>();

function clearThemed(): void {
  for (const r of RARITIES) {
    for (const c of themedBuckets[r]) pendingIds.delete(c.page.pageid);
    themedBuckets[r] = [];
  }
  themedRejects.clear();
  themedTag = null;
}

/** stash() + the theme gate. Returns whether the page was accepted. */
function stashThemed(page: wiki.WikiPage, monthlyViews: number, theme: Tag): boolean {
  const id = page.pageid;
  if (usedIds.has(id) || pendingIds.has(id) || themedRejects.has(id)) return false;
  if (!wiki.isPlayable(page)) return false;
  if (!deriveTags(page.categories, page.extract).includes(theme)) {
    themedRejects.add(id);
    return false;
  }
  pendingIds.add(id);
  themedBuckets[rarityFromViews(monthlyViews)].push({ page, monthlyViews });
  return true;
}

async function stockThemedBuckets(theme: Tag, targets: Record<Rarity, number>): Promise<void> {
  if (themedTag !== theme) {
    clearThemed();
    themedTag = theme;
  }
  const q = THEMES[theme].search;
  const take = (pages: wiki.WikiPage[]) => {
    let added = 0;
    for (const p of pages) {
      if (stashThemed(p, wiki.monthlyFromViews60(p.views60 ?? 0), theme)) added++;
    }
    return added;
  };
  const bulkShort = () =>
    themedBuckets.common.length < targets.common ||
    themedBuckets.uncommon.length < targets.uncommon;
  const rareShort = () =>
    themedBuckets.rare.length < targets.rare || themedBuckets.mythic.length < targets.mythic;

  // random pass — variety; fills common / uncommon (rare/mythic are too scarce
  // in a random slice of a keyword search, so the rescue pass handles those)
  for (let i = 0; i < 10 && bulkShort(); i++) {
    const pages = await wiki.searchEnriched(q, 20, 'random');
    if (pages.length === 0) break;
    if (take(pages) === 0 && i >= 3) break;
  }

  // rescue pass — relevance sort surfaces the theme's flagship, high-traffic
  // articles, filling the rare/mythic bands the random pass starves (and topping
  // up common/uncommon if the random pass came up short on a niche theme)
  for (let i = 0, offset = 0; i < 4 && (rareShort() || bulkShort()); i++, offset += 20) {
    const pages = await wiki.searchEnriched(q, 20, 'relevance', offset);
    if (pages.length === 0) break;
    if (take(pages) === 0) break;
  }
}

/**
 * Build one complete 7-card pack — random by default, or `theme`-locked. Stock
 * the candidate pool from the right source, then `assembleFrom` does the rest.
 */
export function buildPack(opts: { quick?: boolean; theme?: Tag } = {}): Promise<Card[]> {
  return withLock(async () => {
    const targets = opts.quick ? QUICK_TARGET : TARGET;
    if (opts.theme) {
      await stockThemedBuckets(opts.theme, targets);
      return assembleFrom(themedBuckets, { persist: false });
    }
    restoreCandidates();
    await stockBuckets(targets);
    return assembleFrom(buckets, { persist: true });
  });
}

/**
 * Idle-time work: stock candidates past what one pack needs so later builds do
 * little or no sourcing. Bounded per call (adds a few per rarity) so it never
 * blocks a waiting `buildPack` for long — the queue calls it repeatedly.
 */
export function warmBuckets(): Promise<void> {
  return withLock(async () => {
    restoreCandidates();
    const step: Record<Rarity, number> = {
      common: Math.min(buckets.common.length + 4, WARM_TARGET.common),
      uncommon: Math.min(buckets.uncommon.length + 3, WARM_TARGET.uncommon),
      rare: Math.min(buckets.rare.length + 2, WARM_TARGET.rare),
      mythic: Math.min(buckets.mythic.length + 2, WARM_TARGET.mythic)
    };
    if (RARITIES.every((r) => buckets[r].length >= step[r])) return;
    await stockBuckets(step, 3);
    persistCandidates();
  });
}

/** True once every bucket has enough for a pack without any sourcing. */
export function bucketsWarm(): boolean {
  return RARITIES.every((r) => buckets[r].length >= TARGET[r]);
}

/** Test hook — reset all session state. */
export function _resetSession(): void {
  for (const r of RARITIES) {
    buckets[r] = [];
    topByRarity[r] = [];
    themedBuckets[r] = [];
  }
  usedIds.clear();
  pendingIds.clear();
  topSeen.clear();
  fetchedMonths.clear();
  themedRejects.clear();
  themedTag = null;
  restored = false;
  chain = Promise.resolve();
}
