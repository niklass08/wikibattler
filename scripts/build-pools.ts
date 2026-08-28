/**
 * Build src/data/pools.json — the static card pool the game runs on.
 *
 *   npm run pools                 # default: ~4000 cards, en.wikipedia
 *   TARGET=800 npm run pools      # smaller pool (faster)
 *   MONTHS_BACK=6 npm run pools   # how many months of "top" lists to seed from
 *
 * The output MUST be committed. A tiny fixture lives at src/data/pools.sample.json
 * so the UI works before this has ever run.
 *
 * Tuning: after a run, open scripts/.cache/pools.summary.json and adjust
 * RARITY_THRESHOLDS in src/lib/rarity.ts until the split feels right, then re-run.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PROJECT,
  getTopArticles,
  getRandomTitles,
  enrichBatch,
  getLinks,
  getLinksSafe,
  mapLimit,
  isRealArticle
} from './lib/wiki.ts';
import { rarityFromViews, RARITY_THRESHOLDS, percentileNormalise } from '../src/lib/rarity.ts';
import type { Card, PoolsFile, Rarity } from '../src/lib/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/data/pools.json');
const CACHE_DIR = resolve(HERE, '.cache');
const SUMMARY = resolve(CACHE_DIR, 'pools.summary.json');

const TARGET = Number(process.env.TARGET ?? 4000);
const MONTHS_BACK = Number(process.env.MONTHS_BACK ?? 6);
const MIN_BYTES = 1200;

/**
 * Where cards come from. Uniform-random articles are almost all stubs or very
 * low-traffic (=> common), and the "most viewed" lists are all 200k+/month
 * (=> rare/mythic). The middle tier — the bulk of a good pool — comes from
 * harvesting the links out of popular articles: anything notable enough to be
 * linked from a popular page, but not itself a top-1000 article.
 */
const SHARE = { popular: 0.2, mid: 0.5, random: 0.3 };
const LINK_SEED_ARTICLES = 200; // popular articles whose links we harvest for the mid tier

function cachePath(key: string) {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
  return resolve(CACHE_DIR, `${safe}.json`);
}
function readCache<T>(key: string): T | null {
  const p = cachePath(key);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}
function writeCache(key: string, value: unknown) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(key), JSON.stringify(value));
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = readCache<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  writeCache(key, value);
  return value;
}

/** Mulberry32 — deterministic shuffle so re-runs pick the same cards. */
function shuffle<T>(arr: T[], seed = 42): T[] {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const norm = (t: string) => t.replace(/ /g, '_');

async function seedTitles() {
  const now = new Date();
  const popularSet = new Set<string>();
  for (let i = 1; i <= MONTHS_BACK; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const list = await cached(`top-${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, () =>
      getTopArticles(d.getUTCFullYear(), d.getUTCMonth() + 1)
    );
    for (const t of list) popularSet.add(t);
  }
  const popular = shuffle([...popularSet]);

  // Mid tier: harvest links out of a sample of popular articles.
  const linkSeeds = popular.slice(0, LINK_SEED_ARTICLES);
  const harvested = await mapLimit(linkSeeds, 3, (t) =>
    cached(`links-of-${norm(t)}`, () => getLinksSafe(t))
  );
  const midSet = new Set<string>();
  for (const list of harvested) {
    for (const t of list) {
      const u = norm(t);
      if (!popularSet.has(u) && isRealArticle(u)) midSet.add(u);
    }
  }
  const mid = shuffle([...midSet], 7);

  const wantRandom = Math.ceil(TARGET * SHARE.random * 2); // over-fetch; most are stubs
  const random = (await cached(`random-${wantRandom}`, () => getRandomTitles(wantRandom))).filter(
    (t) => !popularSet.has(t) && !midSet.has(t) && isRealArticle(t)
  );

  return { popular, mid, random };
}

async function main() {
  console.log(`▶ building pool: TARGET=${TARGET}, MONTHS_BACK=${MONTHS_BACK}`);
  const { popular, mid, random } = await seedTitles();
  console.log(`  seeded ${popular.length} popular / ${mid.length} mid / ${random.length} random`);

  // Over-fetch each tier ~1.6x since filters drop a chunk, then trim after enrich.
  const take = (arr: string[], share: number) =>
    arr.slice(0, Math.ceil(TARGET * share * 1.6));
  const titles = [
    ...take(popular, SHARE.popular),
    ...take(mid, SHARE.mid),
    ...take(random, SHARE.random)
  ];

  // 1. Enrich in batches of 20 (the TextExtracts API caps multi-title intro
  //    extracts at 20 pages per request).
  const BATCH = 20;
  const batches: string[][] = [];
  for (let i = 0; i < titles.length; i += BATCH) batches.push(titles.slice(i, i + BATCH));
  let done = 0;
  const enriched = (
    await mapLimit(batches, 3, async (b, i) => {
      const hit = readCache<Awaited<ReturnType<typeof enrichBatch>>>(`enrich-${i}`);
      if (hit) return hit;
      let r: Awaited<ReturnType<typeof enrichBatch>> = [];
      try {
        r = await enrichBatch(b);
        writeCache(`enrich-${i}`, r); // only cache successes
      } catch (e) {
        console.warn(`  ! batch ${i} failed: ${(e as Error).message}`);
      }
      if (++done % 10 === 0) console.log(`  enriched ${done}/${batches.length} batches`);
      return r;
    })
  ).flat();
  console.log(`  enriched ${enriched.length} pages`);

  const filtered = enriched.filter(
    (p) => !p.disambiguation && p.length >= MIN_BYTES && p.extract.length > 0
  );
  // De-dupe by pageid (redirects can collapse titles) and trim to TARGET.
  const seen = new Set<number>();
  const kept = filtered
    .filter((p) => (seen.has(p.pageid) ? false : (seen.add(p.pageid), true)))
    .slice(0, TARGET);
  console.log(`  ${kept.length} pass filters (disambig / >=${MIN_BYTES}B / has extract)`);

  // 2. Link counts — full link list per article, one request each.
  //    Cache only successful fetches so a transient failure isn't frozen as 0.
  let ldone = 0;
  const linkCounts = await mapLimit(kept, 3, async (p) => {
    const key = `linkcount-${p.pageid}`;
    const hit = readCache<number>(key);
    if (hit !== null) return hit;
    let n = 0;
    try {
      n = (await getLinks(p.title)).length;
      writeCache(key, n);
    } catch (e) {
      console.warn(`  ! links ${p.title} failed: ${(e as Error).message}`);
    }
    if (++ldone % 100 === 0) console.log(`  link counts ${ldone}/${kept.length}`);
    return n;
  });

  // 3. Popularity: 60-day pageview sum (from the enrich batch, no extra request)
  //    halved to approximate an average month.
  const monthly = kept.map((p) => Math.round(p.views60 / 2));

  // 4. Assemble + normalise stats by percentile within the final pool.
  const strengthNorm = percentileNormalise(linkCounts);
  const defenceNorm = percentileNormalise(kept.map((p) => p.length));

  const cards: Card[] = kept.map((p, i) => ({
    id: p.pageid,
    title: p.title,
    url: p.fullurl,
    extract: p.extract,
    image: p.image,
    rarity: rarityFromViews(monthly[i]) as Rarity,
    strength: strengthNorm[i],
    defence: defenceNorm[i],
    raw: { links: linkCounts[i], bytes: p.length, monthlyViews: monthly[i] }
  }));

  const out: PoolsFile = {
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    thresholds: RARITY_THRESHOLDS,
    cards
  };
  // One card per line — keeps git diffs on regeneration readable.
  const body =
    `{\n"generatedAt":${JSON.stringify(out.generatedAt)},\n` +
    `"project":${JSON.stringify(out.project)},\n` +
    `"thresholds":${JSON.stringify(out.thresholds)},\n` +
    `"cards":[\n` +
    cards.map((c) => JSON.stringify(c)).join(',\n') +
    `\n]}\n`;
  writeFileSync(OUT, body);

  const byRarity = (r: Rarity) => cards.filter((c) => c.rarity === r);
  const summary = {
    generatedAt: out.generatedAt,
    total: cards.length,
    thresholds: RARITY_THRESHOLDS,
    rarity: Object.fromEntries(
      (['common', 'uncommon', 'rare', 'mythic'] as Rarity[]).map((r) => {
        const g = byRarity(r);
        return [r, { count: g.length, pct: +((100 * g.length) / cards.length).toFixed(1) }];
      })
    ),
    sampleMythic: byRarity('mythic')
      .slice(0, 15)
      .map((c) => c.title)
  };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SUMMARY, JSON.stringify(summary, null, 2) + '\n');

  console.log(`✔ wrote ${cards.length} cards → ${OUT}`);
  console.table(summary.rarity);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
