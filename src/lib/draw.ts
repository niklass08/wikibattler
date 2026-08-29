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
import { rarityFromViews } from './rarity';
import * as wiki from './wiki';

/**
 * How many candidates to stock per rarity before assembling a pack. Above the
 * modal 4C / 2U / 1R so upgrade rolls have cards to draw from; generatePack's
 * fallback covers the rare case where they don't.
 */
const TARGET: Record<Rarity, number> = { common: 7, uncommon: 5, rare: 4, mythic: 2 };

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
async function topUp(rarity: Rarity, need: number): Promise<void> {
  let guard = 0;
  while (buckets[rarity].length < need && guard++ < 25) {
    if (rarity === 'common') {
      for (const page of await wiki.randomEnriched(12)) {
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
    tags: [],
    raw: { links: 0, bytes: c.page.bytes, monthlyViews: c.monthlyViews }
  };
}

/**
 * Build one complete 7-card pack: stock every bucket, let generatePack() choose
 * the 7 with the guaranteed split, then fetch exact link counts for those 7.
 */
export async function buildPack(): Promise<Card[]> {
  // Sequential, not parallel — Wikimedia rate-limits bursts from anon clients.
  for (const r of RARITIES) await topUp(r, TARGET[r]);

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
    throw new Error('Not enough Wikipedia articles to fill a pack — retrying.');
  }

  const cards: Card[] = [];
  for (const stub of chosen) {
    const cand = byId.get(stub.id)!;
    usedIds.add(cand.page.pageid);
    const links = await wiki.linkCount(cand.page.title);
    // `pilicense=any` already covers most articles' lead art here; anything still
    // imageless is resolved lazily (and persisted) by Card.svelte on reveal.
    cards.push(wiki.toCard({ page: cand.page, monthlyViews: cand.monthlyViews, links }));
  }

  for (const r of RARITIES) {
    buckets[r] = buckets[r].filter((c) => {
      const consumed = usedIds.has(c.page.pageid);
      if (consumed) pendingIds.delete(c.page.pageid);
      return !consumed;
    });
  }

  return applyPackFoil(cards);
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
}
