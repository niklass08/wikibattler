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
 *
 * Themed packs source instead by *search offset band*: a relevance-sorted search
 * for the theme's infobox template is ordered by prominence, so the first page
 * holds its rare/mythic articles, the middle its uncommons and the deep pages
 * its commons. Three requests therefore stock a full rarity spread.
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

/**
 * Themed: a pool is "stocked" when every band it can supply meets its quota
 * (see BAND_QUOTA) and it holds at least this many candidates. The stocker
 * sources one band per step, so all three get covered across steps.
 */
const THEMED_MIN = 9;

const CANDIDATES_KEY = 'wikitcg:candidates:v2';
const THEMED_KEY = 'wikitcg:themed-candidates:v1';

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
  try {
    const raw = safeGet(THEMED_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Record<
        string,
        { buckets?: Buckets; span?: number; step?: number; dry?: number[] }
      >;
      for (const [tag, v] of Object.entries(s)) {
        if (!(tag in THEMES)) continue;
        const st = themeState(tag as Tag);
        adopt(st.buckets, v.buckets);
        if (typeof v.span === 'number' && v.span > 0) st.span = v.span;
        if (typeof v.step === 'number' && v.step >= 0) st.step = v.step;
        if (Array.isArray(v.dry) && v.dry.length === 3) st.dry = v.dry as [number, number, number];
      }
    }
  } catch {
    /* ignore */
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

function persistThemed(): void {
  const out: Record<string, unknown> = {};
  for (const [tag, s] of themed)
    out[tag] = { buckets: s.buckets, span: s.span, step: s.step, dry: s.dry };
  safeSet(THEMED_KEY, JSON.stringify(out));
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

// --- themed sourcing --------------------------------------------------------
//
// A relevance-sorted search is ordered by prominence, so the *offset* selects a
// popularity band — verified against the live API:
//
//   hastemplate:"Infobox film"   offset    0 → rare/mythic
//                                offset  100 → uncommon
//                                offset 1200 → common
//
// So three requests at three offsets stock a full rarity spread. Each theme
// keeps its own pool and its own cursors, so holding several themed packs at
// once costs nothing extra and switching between them never re-sources.

type Band = 0 | 1 | 2;
const BANDS: Band[] = [0, 1, 2];
/** What each band is for, and how much of it a themed pool wants. */
const BAND_QUOTA: Record<Band, number> = { 0: 3, 1: 5, 2: 8 };
const bandHave = (b: Buckets, band: Band): number =>
  band === 0 ? b.rare.length + b.mythic.length : band === 1 ? b.uncommon.length : b.common.length;

interface ThemeState {
  buckets: Buckets;
  /** learned usable depth of this theme's result set; halves when a page is empty */
  span: number;
  /** rotates every pass, so successive passes pull fresh pages and templates */
  step: number;
  /** per-band fetches that failed to grow that band — a theme with no rares
   *  should stop asking for them rather than re-sourcing on every pack */
  dry: [number, number, number];
}

const themed = new Map<Tag, ThemeState>();

function themeState(theme: Tag): ThemeState {
  let s = themed.get(theme);
  if (!s) {
    s = { buckets: emptyBuckets(), span: 2000, step: 0, dry: [0, 0, 0] };
    themed.set(theme, s);
  }
  return s;
}

/** The offset for a band, as a fraction of the theme's learned span. */
function bandOffset(s: ThemeState, band: Band): number {
  const rot = s.step * 20;
  if (band === 0) return rot % 60; // front → the theme's flagships: rare / mythic
  if (band === 1) return Math.round(s.span * 0.06) + (rot % Math.max(20, Math.round(s.span * 0.2)));
  return Math.round(s.span * 0.5) + (rot % Math.max(20, Math.round(s.span * 0.4))); // deep → common
}

/** Which band this theme's pool most needs, or null when it's covered. */
function bandNeed(s: ThemeState): Band | null {
  for (const band of BANDS) {
    if (s.dry[band] >= 2) continue; // this theme simply hasn't got that band
    if (bandHave(s.buckets, band) < BAND_QUOTA[band]) return band;
  }
  return null;
}

/**
 * Stock one theme's pool. Returns immediately (no network) once every band is
 * covered, so consecutive themed packs are instant.
 *
 * Band selection is need-driven rather than round-robin: a pack is 4 commons,
 * 2 uncommons and a rare, so a pool that only has one band produces a pack of
 * all one rarity. Each band maps to a search offset (see the note above).
 */
async function stockThemed(theme: Tag, budget: number): Promise<void> {
  const s = themeState(theme);
  if (bandNeed(s) === null && countAll(s.buckets) >= THEMED_MIN) return;

  const def = THEMES[theme];
  let spent = 0;

  // Driven purely by which band is short — a total-count cap here would stop
  // sourcing before the last band was ever fetched, leaving packs all one rarity.
  while (spent < budget) {
    const band = bandNeed(s);
    if (band === null) break;
    const before = bandHave(s.buckets, band);

    // one template per request — CirrusSearch won't union `hastemplate:` clauses,
    // so the theme's templates are rotated across passes instead
    const tpl = def.infobox[(s.step + band) % Math.max(1, def.infobox.length)];
    const query = tpl ? `hastemplate:"${tpl}"` : def.search;
    let verify = def.verify || !tpl;

    spent++;
    let pages = await wiki
      .searchEnriched(query, 20, 'relevance', bandOffset(s, band))
      .catch(() => []);

    if (pages.length === 0) {
      if (bandOffset(s, band) > 0) {
        // ran off the end of this theme's results — it's smaller than we thought
        s.span = Math.max(120, Math.round(s.span / 2));
      } else if (tpl && spent < budget) {
        // the template found nothing at all — fall back to the keyword query,
        // which needs the deriveTags gate because it matches on prose
        spent++;
        verify = true;
        pages = await wiki.searchEnriched(def.search, 20, 'relevance', 0).catch(() => []);
      }
    }

    for (const p of pages) {
      if (verify && !deriveTags(p.categories, p.extract).includes(theme)) continue;
      stashInto(s.buckets, p, wiki.monthlyFromViews60(p.views60 ?? 0));
    }

    // did that actually grow the band we were after?
    if (bandHave(s.buckets, band) > before) s.dry[band] = 0;
    else s.dry[band] += 1;
    s.step += 1;
  }
}

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
function assembleSync(source: Buckets, forceTag?: Tag): Card[] {
  const byId = new Map<number, Candidate>();
  const pools: RarityPools = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const r of RARITIES) {
    for (const c of source[r]) {
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
    const card = wiki.toCard({ page: cand.page, monthlyViews: cand.monthlyViews, links });
    if (forceTag) {
      // the pack's theme is authoritative (infobox-sourced) — lead with it
      card.tags = [forceTag, ...card.tags.filter((t) => t !== forceTag)].slice(0, 4);
    }
    return card;
  });

  dropConsumed(source);
  return applyMythicSignatures(applyPackFoil(cards));
}

// --- readiness --------------------------------------------------------------

/** A pack wants 4 commons, 2 uncommons and a rare — plus slack for upgrade rolls. */
const READY_NEED: Record<Band, number> = { 0: 1, 1: 2, 2: 4 };

/**
 * Can a pack be assembled from this pool right now, with no network? A band the
 * theme has proven it cannot supply (`dry`) is treated as satisfied — a pack
 * from such a theme legitimately leans on `generatePack`'s rarity fallback.
 */
function canAssemble(b: Buckets, dry?: ThemeState['dry']): boolean {
  if (countAll(b) < PACK_SIZE) return false;
  return BANDS.every((band) => (dry && dry[band] >= 2) || bandHave(b, band) >= READY_NEED[band]);
}

function poolFor(theme?: Tag | null): { buckets: Buckets; dry?: ThemeState['dry'] } {
  if (!theme) return { buckets };
  const s = themeState(theme);
  return { buckets: s.buckets, dry: s.dry };
}

/** True when `theme` (or the random pool) can produce a pack instantly. */
export function poolReady(theme?: Tag | null): boolean {
  restoreCandidates();
  const { buckets: b, dry } = poolFor(theme);
  return canAssemble(b, dry);
}

/** How many candidates are pooled for `theme` (or the random pool). */
export function poolCount(theme?: Tag | null): number {
  restoreCandidates();
  return countAll(poolFor(theme).buckets);
}

/** True once the pool is stocked well past a single pack — nothing left to do. */
export function poolFull(theme?: Tag | null): boolean {
  restoreCandidates();
  if (!theme) return RARITIES.every((r) => buckets[r].length >= FILL[r]);
  const s = themeState(theme);
  return bandNeed(s) === null && countAll(s.buckets) >= THEMED_MIN;
}

// --- public API -------------------------------------------------------------

/**
 * Assemble a pack from the pool **right now**, or null if the pool can't cover
 * one yet. Synchronous: no request is made, so a stocked pool opens instantly.
 */
export function assemblePack(theme?: Tag | null): Card[] | null {
  restoreCandidates();
  const { buckets: b, dry } = poolFor(theme);
  if (!canAssemble(b, dry)) return null;
  const cards = assembleSync(b, theme ?? undefined);
  if (theme) persistThemed();
  else persistCandidates();
  return cards;
}

/**
 * One unit of background work for `theme` (null = the random pool): a single
 * sourcing request, or — when the pool is already stocked — resolving one
 * pooled card's exact link count so assembly stays network-free.
 *
 * Returns the requests spent; 0 means there is nothing useful left to do.
 */
export function stockStep(theme?: Tag | null): Promise<number> {
  return withLock(async () => {
    restoreCandidates();

    if (theme) {
      const s = themeState(theme);
      if (bandNeed(s) !== null) {
        await stockThemed(theme, 1);
        persistThemed();
        return 1;
      }
      const spent = await resolveOneLinkCount(s.buckets);
      if (spent) persistThemed();
      return spent;
    }

    if (RARITIES.some((r) => buckets[r].length < FILL[r])) {
      const spent = await fillRandom(2, true);
      persistCandidates();
      if (spent > 0) return spent;
    }
    const spent = await resolveOneLinkCount(buckets);
    if (spent) persistCandidates();
    return spent;
  });
}

/**
 * Give one pooled rare/mythic its exact link count. Strength is the internal
 * link count and an exact figure is one `parse` call, so the stocker pays for
 * them in the background rather than making the player wait at assembly time.
 */
async function resolveOneLinkCount(source: Buckets): Promise<number> {
  for (const r of ['mythic', 'rare'] as const) {
    const cand = source[r].find((c) => c.links === undefined);
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
export async function buildPack(opts: { quick?: boolean; theme?: Tag } = {}): Promise<Card[]> {
  const theme = opts.theme ?? null;
  const budget = opts.quick ? QUICK_BUDGET : BUDGET;
  for (let i = 0; i < budget && !poolReady(theme); i++) {
    if ((await stockStep(theme)) === 0) break;
  }
  const pack = assemblePack(theme);
  if (!pack) {
    throw new Error(
      theme
        ? `Not enough ${THEMES[theme].label} articles to fill a pack — retrying shortly.`
        : 'Not enough Wikipedia articles to fill a pack — retrying shortly.'
    );
  }
  return pack;
}

/** Test hook — reset all session state. */
export function _resetSession(): void {
  for (const r of RARITIES) {
    buckets[r] = [];
    topByRarity[r] = [];
  }
  themed.clear();
  usedIds.clear();
  pendingIds.clear();
  topSeen.clear();
  fetchedMonths.clear();
  linkPool = [];
  restored = false;
  chain = Promise.resolve();
}
