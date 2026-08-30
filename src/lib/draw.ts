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
import * as wiki from './wiki';

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
 * Background warm target — stock candidates well past what one pack needs so
 * later builds do little or no sourcing. Filled by `warmBuckets()` while idle.
 */
const WARM_TARGET: Record<Rarity, number> = { common: 24, uncommon: 16, rare: 12, mythic: 8 };

const CANDIDATES_KEY = 'wikitcg:candidates:v1';

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

function dropConsumed(): void {
  for (const r of RARITIES) {
    buckets[r] = buckets[r].filter((c) => {
      const consumed = usedIds.has(c.page.pageid);
      if (consumed) pendingIds.delete(c.page.pageid);
      return !consumed;
    });
  }
}

/**
 * Build one complete 7-card pack: stock every bucket, let generatePack() choose
 * the 7 with the guaranteed split, then fetch link counts for those 7 — one
 * batched call, with a parallel exact fallback for any the batch truncated.
 */
export function buildPack(opts: { quick?: boolean } = {}): Promise<Card[]> {
  return withLock(async () => {
    restoreCandidates();
    await stockBuckets(opts.quick ? QUICK_TARGET : TARGET);

    const byId = new Map<number, Candidate>();
    const pools: RarityPools = { common: [], uncommon: [], rare: [], mythic: [] };
    for (const r of RARITIES) {
      for (const c of buckets[r]) {
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

    const counts = await wiki.linkCounts(cands.map((c) => c.page.title));
    const cards = await Promise.all(
      cands.map(async (cand) => {
        let links =
          counts.get(cand.page.title) ??
          [...counts].find(([k]) => looseEq(k, cand.page.title))?.[1];
        if (links === undefined) {
          links = await wiki.linkCount(cand.page.title).catch(() => 0);
        }
        // `pilicense=any` covers most lead art; the rest is resolved lazily
        // (and persisted) by Card.svelte on reveal.
        return wiki.toCard({ page: cand.page, monthlyViews: cand.monthlyViews, links });
      })
    );

    dropConsumed();
    persistCandidates();
    return applyMythicSignatures(applyPackFoil(cards));
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
      common: Math.min(buckets.common.length + 8, WARM_TARGET.common),
      uncommon: Math.min(buckets.uncommon.length + 6, WARM_TARGET.uncommon),
      rare: Math.min(buckets.rare.length + 5, WARM_TARGET.rare),
      mythic: Math.min(buckets.mythic.length + 4, WARM_TARGET.mythic)
    };
    if (RARITIES.every((r) => buckets[r].length >= step[r])) return;
    await stockBuckets(step, 6);
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
  }
  usedIds.clear();
  pendingIds.clear();
  topSeen.clear();
  fetchedMonths.clear();
  restored = false;
  chain = Promise.resolve();
}
