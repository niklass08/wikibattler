/**
 * Shared Wikimedia API helpers for the build script.
 * All endpoints are anonymous (no key). We identify ourselves per Wikimedia policy.
 */

export const PROJECT = 'en.wikipedia';
export const API = 'https://en.wikipedia.org/w/api.php';
export const REST = 'https://wikimedia.org/api/rest_v1';

const UA = 'WikiTCG/0.1 (Wikipedia TCG build script; https://github.com/wikitcg; contact via repo issues)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialise request starts with a minimum gap, so we stay well under the rate limit. */
const MIN_GAP_MS = 120;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait > 0) await sleep(wait);
}

export async function fetchJson<T = any>(url: string, tries = 6): Promise<T> {
  let lastErr = '';
  for (let attempt = 0; attempt < tries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, 'Accept-Encoding': 'gzip' }
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        lastErr = `HTTP ${res.status}`;
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 120)}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt === tries - 1) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`gave up after ${tries} tries (${lastErr}): ${url.slice(0, 120)}`);
}

/** Run `worker` over `items` with a fixed concurrency cap. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const JUNK_PREFIX = /^(Main_Page$|Special:|Wikipedia:|Portal:|Help:|Template:|Category:|File:|Talk:|User:|Draft:)/;
const JUNK_TITLE = /^(-|—|Undefined|Test_card|Wikipedia|XHamster)$/i;

export function isRealArticle(title: string): boolean {
  return !JUNK_PREFIX.test(title) && !JUNK_TITLE.test(title);
}

/** Top ~1000 most-viewed articles for one month. */
export async function getTopArticles(year: number, month: number): Promise<string[]> {
  const mm = String(month).padStart(2, '0');
  const url = `${REST}/metrics/pageviews/top/${PROJECT}/all-access/${year}/${mm}/all-days`;
  const data = await fetchJson<{ items: { articles: { article: string }[] }[] }>(url);
  return (data.items?.[0]?.articles ?? []).map((a) => a.article).filter(isRealArticle);
}

/** Random mainspace titles. */
export async function getRandomTitles(count: number): Promise<string[]> {
  const out = new Set<string>();
  while (out.size < count) {
    const url = `${API}?action=query&format=json&formatversion=2&list=random&rnnamespace=0&rnlimit=20`;
    const data = await fetchJson<{ query: { random: { title: string }[] } }>(url);
    for (const r of data.query.random) {
      out.add(r.title.replace(/ /g, '_'));
    }
  }
  return [...out].slice(0, count);
}

export interface EnrichedPage {
  pageid: number;
  title: string;
  fullurl: string;
  length: number;
  extract: string;
  image: string | null;
  views60: number;
  disambiguation: boolean;
}

/** Batched metadata for up to 50 titles. */
export async function enrichBatch(titles: string[]): Promise<EnrichedPage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: titles.join('|'),
    prop: 'info|pageviews|pageimages|extracts|pageprops',
    inprop: 'url',
    pvipdays: '60',
    piprop: 'thumbnail',
    pithumbsize: '600',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    ppprop: 'disambiguation',
    redirects: '1'
  });
  const data = await fetchJson<any>(`${API}?${params}`);
  const pages: any[] = data.query?.pages ?? [];
  return pages
    .filter((p) => !p.missing && p.pageid)
    .map((p) => {
      const pv: Record<string, number | null> = p.pageviews ?? {};
      const views60 = Object.values(pv).reduce<number>((s, v) => s + (v ?? 0), 0);
      return {
        pageid: p.pageid,
        title: p.title,
        fullurl: p.fullurl,
        length: p.length ?? 0,
        extract: (p.extract ?? '').trim(),
        image: p.thumbnail?.source ?? null,
        views60,
        disambiguation: p.pageprops?.disambiguation !== undefined
      } satisfies EnrichedPage;
    });
}

/** Full list of internal mainspace links in an article (single request). Throws on failure. */
export async function getLinks(title: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: 'parse',
    format: 'json',
    formatversion: '2',
    page: title,
    prop: 'links',
    redirects: '1'
  });
  const data = await fetchJson<any>(`${API}?${params}`);
  if (data.error) return []; // missing page, etc. — not a transient failure
  const links: { ns: number; exists?: boolean; title: string }[] = data.parse?.links ?? [];
  return links.filter((l) => l.ns === 0 && l.exists !== false).map((l) => l.title);
}

/** As getLinks, but returns [] instead of throwing on a transient error. */
export async function getLinksSafe(title: string): Promise<string[]> {
  try {
    return await getLinks(title);
  } catch {
    return [];
  }
}

/** Count of internal mainspace links in an article. */
export async function getLinkCount(title: string): Promise<number> {
  return (await getLinks(title)).length;
}

/** Average monthly pageviews over the last `months` complete months (agent=user). */
export async function getMonthlyViews(title: string, months = 6): Promise<number> {
  const end = new Date();
  end.setUTCDate(1); // first of current month → excludes the incomplete current month
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - months);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;
  const enc = encodeURIComponent(title);
  const url = `${REST}/metrics/pageviews/per-article/${PROJECT}/all-access/user/${enc}/monthly/${fmt(start)}/${fmt(end)}`;
  try {
    const data = await fetchJson<{ items: { views: number }[] }>(url);
    const items = data.items ?? [];
    if (items.length === 0) return 0;
    return Math.round(items.reduce((s, i) => s + i.views, 0) / items.length);
  } catch {
    return 0;
  }
}
