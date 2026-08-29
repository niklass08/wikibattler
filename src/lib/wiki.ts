/**
 * Browser-side Wikimedia API client. Anonymous, no key, no custom headers
 * (custom headers would trigger a CORS preflight the API doesn't answer — the
 * Action API needs `origin=*` in the query string instead).
 *
 * Used by draw.ts to assemble live packs. The old build-time crawler
 * (scripts/build-pools.ts) is gone; this is the only path to card data now.
 */
import type { Card } from './types';
import { rarityFromViews, strengthFromLinks, defenceFromBytes } from './rarity';
import { deriveTags } from './tags';

/** Language edition. Kept as one constant so it can change. */
export const PROJECT = 'en.wikipedia';
const API = `https://${PROJECT}.org/w/api.php`;
const REST = 'https://wikimedia.org/api/rest_v1';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialise request starts with a minimum gap. Wikimedia asks anonymous clients
 * to make requests in series, not parallel — this is the whole app's rate limiter.
 * Latency is hidden behind the background pack queue, so we can afford to be slow.
 */
let minGapMs = 250;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + minGapMs;
  if (wait > 0) await sleep(wait);
}

/** Test hook — drop the inter-request delay so mocked suites run fast. */
export function _setMinGap(ms: number): void {
  minGapMs = ms;
}

async function fetchJson<T = any>(url: string, tries = 6): Promise<T> {
  let lastErr = '';
  for (let attempt = 0; attempt < tries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt === tries - 1) break;
      await sleep(Math.min(8000, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Wikipedia request failed (${lastErr})`);
}

// --- junk filtering -----------------------------------------------------------

const JUNK_PREFIX =
  /^(Main_Page$|Special:|Wikipedia:|Portal:|Help:|Template:|Category:|File:|Talk:|User:|Draft:|Module:|MediaWiki:|Book:)/;
const JUNK_TITLE = /^(-|—|Undefined|Wikipedia)$/i;

export function isRealArticle(title: string): boolean {
  const t = title.replace(/ /g, '_');
  return !JUNK_PREFIX.test(t) && !JUNK_TITLE.test(title);
}

// --- enriched page -----------------------------------------------------------

export interface WikiPage {
  pageid: number;
  title: string;
  url: string;
  bytes: number;
  extract: string;
  /** Lead image (`pageimages`), or null — see `backupImage` for a fallback. */
  image: string | null;
  /** Non-hidden category titles (without the `Category:` prefix). */
  categories: string[];
  disambiguation: boolean;
  /** Sum of the last ~60 days of pageviews, or null when not requested. */
  views60: number | null;
}

/** A ~60-day view sum halved is a decent proxy for a monthly average. */
export function monthlyFromViews60(views60: number): number {
  return Math.round(views60 / 2);
}

/** Playable = a real, non-stub, non-disambiguation mainspace article. */
export function isPlayable(page: WikiPage): boolean {
  return (
    !page.disambiguation &&
    page.bytes >= 1500 &&
    page.extract.length > 0 &&
    isRealArticle(page.title)
  );
}

const ENRICH_PARAMS: Record<string, string> = {
  action: 'query',
  format: 'json',
  formatversion: '2',
  origin: '*',
  prop: 'extracts|pageimages|info|pageprops|pageviews|categories',
  inprop: 'url',
  piprop: 'thumbnail',
  pithumbsize: '600',
  // include fair-use images — album covers, film posters, book covers, logos.
  // `pageimages` hides them by default (pilicense=free) and they're most of the
  // interesting art. Card detail links back to the article for attribution.
  pilicense: 'any',
  cllimit: 'max',
  clshow: '!hidden',
  exintro: '1',
  explaintext: '1',
  exsentences: '2',
  ppprop: 'disambiguation',
  pvipdays: '60',
  redirects: '1'
};

/** Wikipedia UI chrome, icons, maps, diagrams, insignia — never good card art. */
const FILE_JUNK =
  /(Commons-logo|Wik(tionary|inews|iquote|isource|ibooks|iversity|ivoyage|idata|ispecies)|Portal[ _]|Symbol[ _]|Question[ _]book|Ambox|Edit-clear|Text[ _]document|Nuvola|Crystal[ _]|Gnome-|Folder[ _]Hexagonal|Wiki[ _]letter|Disambig|Magnify-clip|_pog\.|Loudspeaker|OOjs|Increase|Decrease|Steady|Yes[ _]check|X[ _]mark|Star_(empty|full|half)|Semi-protection|padlock|WPVG|Office-book|Blank|placeholder|No[ _]image|Replace_this_image|BSicon|Coat_of_[Aa]rms|Location_map|locator|_map[_.]|route[ _]?map|railway[ _]?map|_railways\.|Flag_of|timeline|_chart[_.]|_diagram[_.]|logo\.svg|\.og[gav]$|\.webm$)/i;

function parsePages(data: any): WikiPage[] {
  const pages: any[] = data?.query?.pages ?? [];
  return pages
    .filter((p) => !p.missing && p.pageid)
    .map((p) => {
      const pv = p.pageviews as Record<string, number | null> | undefined;
      const views60 = pv
        ? Object.values(pv).reduce<number>((s, v) => s + (v ?? 0), 0)
        : null;
      return {
        pageid: p.pageid,
        title: p.title,
        url:
          p.fullurl ??
          `https://${PROJECT}.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_'))}`,
        bytes: p.length ?? 0,
        extract: (p.extract ?? '').trim(),
        image: p.thumbnail?.source ?? null,
        categories: (p.categories ?? []).map((c: any) =>
          String(c.title ?? '').replace(/^Category:/, '')
        ),
        disambiguation: p.pageprops?.disambiguation !== undefined,
        views60
      } satisfies WikiPage;
    });
}

/** `n` random mainspace articles, fully enriched, in one call. */
export async function randomEnriched(n: number): Promise<WikiPage[]> {
  const params = new URLSearchParams(ENRICH_PARAMS);
  params.set('generator', 'random');
  params.set('grnnamespace', '0');
  params.set('grnlimit', String(Math.min(Math.max(n, 1), 20)));
  return parsePages(await fetchJson(`${API}?${params}`));
}

/** Batched metadata for up to 20 titles (the intro-extract cap). */
export async function enrichTitles(titles: string[]): Promise<WikiPage[]> {
  if (titles.length === 0) return [];
  const params = new URLSearchParams(ENRICH_PARAMS);
  params.set('titles', titles.slice(0, 20).join('|'));
  return parsePages(await fetchJson(`${API}?${params}`));
}

const rasterFirst = (title: string) => (/\.(jpe?g|png|webp)$/i.test(title) ? 0 : 1);

/**
 * Backup card art for an article with no lead image of its own: the first
 * "content" image from the REST media-list (Wikipedia's own curated gallery
 * set, so chrome and infobox icons are already excluded), photos preferred.
 */
export async function backupImage(title: string): Promise<string | null> {
  const slug = encodeURIComponent(title.replace(/ /g, '_'));
  let data: any;
  try {
    data = await fetchJson(`https://${PROJECT}.org/api/rest_v1/page/media-list/${slug}`);
  } catch {
    return null;
  }
  const items: any[] = (data?.items ?? [])
    .filter(
      (i: any) => i?.type === 'image' && i.showInGallery && i.title && !FILE_JUNK.test(String(i.title))
    )
    .sort((a: any, b: any) => rasterFirst(a.title) - rasterFirst(b.title));

  for (const it of items) {
    const src: string | undefined = it.srcset?.[0]?.src ?? it.original?.source;
    if (src) return src.startsWith('//') ? `https:${src}` : src;
  }
  return null;
}

// --- pageviews top lists ----------------------------------------------------

export interface TopArticle {
  title: string;
  views: number;
  rank: number;
}

const TOP_TTL_MS = 30 * 24 * 3600 * 1000;

function readCache<T>(key: string, ttl: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (typeof t !== 'number' || Date.now() - t > ttl) return null;
    return v as T;
  } catch {
    return null;
  }
}

function writeCache(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
  } catch {
    /* private mode / quota — fine, we just refetch */
  }
}

/** Top ~1000 articles for one month, with that month's total view counts. */
export async function topMonth(year: number, month: number): Promise<TopArticle[]> {
  const mm = String(month).padStart(2, '0');
  const key = `wikitcg:top:${year}-${mm}`;
  const cached = readCache<TopArticle[]>(key, TOP_TTL_MS);
  if (cached) return cached;

  const url = `${REST}/metrics/pageviews/top/${PROJECT}/all-access/${year}/${mm}/all-days`;
  const data = await fetchJson<any>(url);
  const raw: any[] = data?.items?.[0]?.articles ?? [];
  const list: TopArticle[] = raw
    .map((a) => ({
      title: String(a.article),
      views: Number(a.views) || 0,
      rank: Number(a.rank) || 0
    }))
    .filter((a) => isRealArticle(a.title));
  writeCache(key, list);
  return list;
}

// --- links -----------------------------------------------------------------

/** Internal mainspace links out of an article (single `parse` call). */
export async function linksOf(title: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    formatversion: '2',
    origin: '*',
    page: title,
    prop: 'links',
    redirects: '1'
  });
  const data = await fetchJson<any>(`${API}?${params}`);
  if (data?.error) return [];
  const links: { ns: number; exists?: boolean; title: string }[] = data?.parse?.links ?? [];
  return links.filter((l) => l.ns === 0 && l.exists !== false).map((l) => String(l.title));
}

/** Exact count of internal mainspace links — drives strength. */
export async function linkCount(title: string): Promise<number> {
  return (await linksOf(title)).length;
}

// --- card assembly --------------------------------------------------------

export interface CardInputs {
  page: WikiPage;
  monthlyViews: number;
  links: number;
}

export function toCard({ page, monthlyViews, links }: CardInputs): Card {
  return {
    id: page.pageid,
    title: page.title,
    url: page.url,
    extract: page.extract,
    image: page.image,
    rarity: rarityFromViews(monthlyViews),
    strength: strengthFromLinks(links),
    defence: defenceFromBytes(page.bytes),
    foil: 0,
    negated: false,
    signature: null,
    tags: deriveTags(page.categories, page.extract),
    raw: { links, bytes: page.bytes, monthlyViews }
  };
}

/**
 * Categories for a batch of titles — used to backfill thematic tags on cards
 * pulled before the tag system existed. Batched small to avoid `clcontinue`.
 */
export async function fetchCategories(titles: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < titles.length; i += 12) {
    const slice = titles.slice(i, i + 12);
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      titles: slice.join('|'),
      prop: 'categories',
      cllimit: 'max',
      clshow: '!hidden',
      redirects: '1'
    });
    let data: any;
    try {
      data = await fetchJson(`${API}?${params}`);
    } catch {
      continue;
    }
    for (const p of data?.query?.pages ?? []) {
      if (p.missing) continue;
      out.set(
        String(p.title),
        (p.categories ?? []).map((c: any) => String(c.title ?? '').replace(/^Category:/, ''))
      );
    }
  }
  return out;
}
