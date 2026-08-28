# WikiTCG — Implementation Plan

A trading-card game built on Wikipedia. Every Wikipedia article maps to a card.
Fully client-side, no backend, deployable as static files.

This document is the source of truth for agents building the project. Read it fully
before working. Update it when decisions change.

---

## 0. Status — v1 is built (2026-08-28)

Working end to end: scaffold, both screens, pack opening with reveal/foil, collection
with filters + completion meters, card detail, the crawler, and a committed
1,800-card `pools.json`. `npm run dev` runs it; `npm test` (19 tests) and
`npm run check` and `npm run build` all pass.

Deltas from the plan below, worth knowing:

- **Rarity thresholds** were tuned against the first real crawl to
  `uncommon 10k / rare 150k / mythic 400k` monthly views → a 55 / 31 / 12 / 3 split.
  Constants live in `src/lib/rarity.ts`; `scripts/.cache/pools.summary.json` shows the
  split after each crawl.
- **`pools.json` is code-split**, not statically bundled — `main.ts` calls
  `loadPools()` (dynamic `import()`) behind a boot splash before mounting. App chunk
  ~24 KB gz, pool chunk ~338 KB gz.
- **Popularity** uses the 60-day `prop=pageviews` sum ÷ 2 for *every* card (it comes
  free in the enrich batch); the per-article monthly REST call was dropped as too slow
  for marginal gain. `getMonthlyViews` is still in `scripts/lib/wiki.ts` if wanted.
- **Mid-tier seeding** (the "missing middle") works by harvesting outgoing links from
  the top ~200 popular articles — see `seedTitles()`. Enrich batches are 20 (the
  TextExtracts intro-extract cap), not 50.
- The current pool skews to 2026 sport/entertainment because recent "most viewed"
  lists do. Regenerate with a wider `MONTHS_BACK` or curated seeds to diversify.
- Known follow-ups: lazy-load / shrink the pool chunk further, "wild" live-draw mode,
  collection export/import, nicer mobile hand layout.

---

## 1. Product summary

Two features only:

1. **Pack opening** — open a 7-card pack, cards revealed one by one with animation.
2. **Collection viewing** — browse every card you have pulled, with filters and
   completion stats.

### Card model

| Field      | Source                                                        |
|------------|--------------------------------------------------------------|
| name       | Article title                                                |
| image      | Article lead image (Wikipedia `pageimages`), typographic fallback |
| strength   | Derived from the **number of links in the article**          |
| defence    | Derived from the **byte length of the article** (wikitext)   |
| rarity     | Derived from the **popularity** (pageviews) of the article   |
| link       | Canonical URL to the article (shown on card detail)          |

### Rarities

`common` · `uncommon` · `rare` · `mythic`

### Confirmed design decisions

- **Card art:** use the article lead image; typographic fallback when absent.
- **Pack economy:** unlimited, free. Button to open a pack, no currency, no cooldown.
- **Pack rarity:** *guaranteed distribution* per 7-card pack (real-TCG feel):
  - 4 × common
  - 2 × uncommon
  - 1 × rare-or-better — this slot upgrades to `mythic` ~1 in 8 openings (tune later).
- **Duplicates:** allowed; collection tracks a count per card ("×3" badge). No crafting.
- **Stack:** Vite + **Svelte 5** (runes) + TypeScript. Hand-rolled CSS with design
  tokens (no Tailwind/UI kit). Svelte transitions for animation; add `motion`/GSAP
  only if a specific effect needs it.
- **Aesthetic:** minimalist, dark, "slick". See §6.

### Open questions (not blocking — pick the default, note it in code)

- Language edition: **default `en.wikipedia`**. Keep the project string in one config
  constant so it can change.
- Curated pool size: **default ~4,000 cards total** across rarities (see §4). Bigger =
  more meaningful "collection completion" but larger `pools.json`.
- Exclude `List of…` / disambiguation / year articles? **Default: exclude
  disambiguation and non-mainspace; keep the rest.**
- Stub filter: **default** drop articles under ~1,500 bytes (they make dull cards).

---

## 2. Architecture

```
Static SPA. One generated data file. No server, no API keys.

           build time (run manually, output committed)
  ┌─────────────────────────────────────────────────────┐
  │ scripts/build-pools.ts                               │
  │   Wikimedia APIs ──▶ compute stats+rarity ──▶        │
  │   src/data/pools.json  (committed to the repo)       │
  └─────────────────────────────────────────────────────┘

           runtime (browser only)
  ┌─────────────────────────────────────────────────────┐
  │ pools.json (bundled)                                 │
  │   └─▶ pack.ts  builds a guaranteed-distribution pack │
  │         └─▶ PackOpener.svelte  reveal animation      │
  │               └─▶ collection store (localStorage)    │
  │                     └─▶ Collection.svelte            │
  └─────────────────────────────────────────────────────┘
```

**Why a build-time pool instead of live random draws:**
Guaranteed rarity distribution needs a known population per rarity. `list=random` is
uniform, so filling the "rare-or-better" slot live would mean fetching and discarding
dozens of random articles per pack (rare+ is a low single-digit % of all articles),
plus 2 extra calls per card for stats. A committed pool makes packs instant, works
offline, and makes collection-completion a real goal. Live "wild" draws can be added
later as an optional mode (§7).

---

## 3. Wikimedia API reference (verified 2026-08)

All endpoints are anonymous, no key. Be a good citizen: set a descriptive
`Api-User-Agent` header (browser can't set `User-Agent`, but this custom header is
accepted and is what Wikimedia's policy asks for). In the Node build script set a real
`User-Agent` with a contact URL.

### 3.1 Action API — `https://en.wikipedia.org/w/api.php`

CORS: add `origin=*` to the query string (required, even for GET). Response then
behaves as logged-out. Format: `format=json&formatversion=2`.

**Batch metadata for up to 50 titles in one call** (used for both build + any live draw):

```
/w/api.php?action=query&format=json&formatversion=2&origin=*
  &titles=Cat|Dog|Paris|...            (≤50, pipe-separated)
  &prop=info|pageviews|pageimages|extracts|pageprops
  &inprop=url                          → info.fullurl (canonical link)
  &pvipdays=60                         → pageviews (max 60 days; see REST for longer)
  &piprop=thumbnail|original&pithumbsize=600   → pageimages thumbnail.source
  &exintro&explaintext&exsentences=2   → extract (card flavour text / detail)
  &ppprop=disambiguation               → pageprops.disambiguation present ⇒ skip
```

- `info.length` = **wikitext byte length** → **defence** input. (Cat ≈ 171,674.)
- `pageviews` = `{ "YYYY-MM-DD": count | null }` for last `pvipdays` days. Sum the
  non-null values; ignore trailing `null` (today, not yet aggregated).
- `pageimages.thumbnail.source` = image URL (from `upload.wikimedia.org`, loads fine
  as `<img src>`). May be absent → typographic card.

**Link count** — one call per page (Action API `query+links` is capped at 500 with
`plcontinue` pagination; `parse` returns the full list in a single response):

```
/w/api.php?action=parse&format=json&formatversion=2&origin=*
  &page=Cat&prop=links&redirects=1
→ parse.links: [ { ns, title, exists }, ... ]   (Cat ≈ 1,100 entries, no continuation)
```

Count only `ns === 0 && exists !== false` → **strength** input. This is the one
unavoidable per-article request; the build script parallelises it with a concurrency
cap (see §4).

**Random mainspace titles** (for the common pool + future wild mode):

```
/w/api.php?action=query&format=json&formatversion=2&origin=*
  &list=random&rnnamespace=0&rnlimit=20
```

### 3.2 Pageviews REST — `https://wikimedia.org/api/rest_v1`

CORS: `Access-Control-Allow-Origin: *`, no `origin` param, no key.

**Top articles for a month** (seed list for uncommon/rare/mythic pools):

```
/metrics/pageviews/top/en.wikipedia/all-access/{YYYY}/{MM}/all-days
→ { items: [ { articles: [ { article, views, rank }, … ~1000 ] } ] }
```

Pull several recent months and dedupe to get a few thousand popular titles. Filter out
`Main_Page`, `Special:*`, `Wikipedia:*`, `Portal:*`, `-` (search box artefact), etc.

**Per-article monthly views** (more history than the 60-day Action API cap; use for a
stable popularity number in the build):

```
/metrics/pageviews/per-article/en.wikipedia/all-access/user/{URL-ENCODED_TITLE}/monthly/{YYYYMM0100}/{YYYYMM0100}
→ { items: [ { timestamp, views }, … ] }
```

Use `agent=user` (excludes bots/spiders). Average the last 3–6 complete months for the
popularity score.

### 3.3 Rate / etiquette

- Action API: keep concurrency ≤ ~5, serial-ish; add exponential backoff on HTTP 429.
- The build script is the only heavy consumer. ~4,000 cards × (1 parse call) +
  batched metadata (80 batch calls) ≈ 4,100 requests. At concurrency 4 with polite
  spacing this is a few minutes. Cache intermediate results to disk so re-runs are
  cheap (`scripts/.cache/`).

---

## 4. Build script — `scripts/build-pools.ts`

Node script (`tsx scripts/build-pools.ts`), not part of the app bundle. Output
`src/data/pools.json` is **committed** so `npm install && npm run dev` works with no
network.

### Steps

1. **Seed popular titles:** fetch `top` pageviews for the last 6 months, dedupe,
   filter junk/non-mainspace. → ~3,000–5,000 candidates.
2. **Seed commons:** loop `list=random&rnlimit=20` until you have ~3,000 unique
   mainspace titles not already in the popular set.
3. **Enrich** (batches of 50): `prop=info|pageviews|pageimages|extracts|pageprops`,
   `inprop=url`. Drop: disambiguation, `info.length < 1500`, missing extract.
4. **Link counts:** `action=parse&prop=links` per surviving title, concurrency 4,
   disk-cached. Compute `strength` input = count of `ns 0 && exists`.
5. **Popularity:** for popular-seed titles use per-article monthly REST (avg last 3–6
   months); for random-seed commons the 60-day `pageviews` sum ÷ 2 is fine.
6. **Assign rarity** by monthly-views thresholds (§5). If a bucket is thin (esp.
   `mythic`), that's fine — rarity should be rare.
7. **Normalise stats** to 1–99 using **percentile rank within the final pool**
   (spreads the heavy-tailed raw values). Store both raw and normalised.
8. **Write** `src/data/pools.json`:

```jsonc
{
  "generatedAt": "2026-08-28T00:00:00Z",
  "project": "en.wikipedia",
  "thresholds": { "uncommon": 2000, "rare": 20000, "mythic": 200000 },
  "cards": [
    {
      "id": 6678,                       // pageid — stable key
      "title": "Cat",
      "url": "https://en.wikipedia.org/wiki/Cat",
      "extract": "The cat is a small domesticated carnivore…",
      "image": "https://upload.wikimedia.org/…/330px-Cat_poster.jpg",   // or null
      "rarity": "uncommon",
      "strength": 61,                   // normalised 1–99
      "defence": 74,
      "raw": { "links": 1123, "bytes": 171674, "monthlyViews": 148230 }
    }
    // …
  ]
}
```

Also emit `pools.summary.json` (counts per rarity, min/median/max stats) for review.

### Regeneration

Document in the script header: how to run, how to change pool size / project /
thresholds, and that the output must be committed. Keep a tiny fixture
(`src/data/pools.sample.json`, ~60 cards) checked in so early UI work isn't blocked on
a full crawl.

---

## 5. Rarity & stat formulas — `src/lib/rarity.ts`

Pure functions, unit-tested. Tunable constants at top of file.

### Rarity from popularity (monthly views, `agent=user`)

| Rarity   | Monthly views      |
|----------|--------------------|
| common   | `< 2,000`          |
| uncommon | `2,000 – 20,000`   |
| rare     | `20,000 – 200,000` |
| mythic   | `≥ 200,000`        |

These are starting points. After the first crawl, inspect `pools.summary.json` and
adjust so the distribution feels right (rough target: 55 / 30 / 12 / 3 %).

### Stats

Primary: **percentile rank within the pool**, computed at build time, mapped to 1–99.

Fallback (for live/wild draws with no pool context) — log scale, heavy-tailed inputs:

```ts
strength = clamp(round(12 * log10(links + 1)), 1, 99)
defence  = clamp(round(11 * (log10(bytes) - 2.5)), 1, 99)
```

Keep both; the pool path is canonical.

---

## 6. Design system

Minimalist, dark, high-contrast, lots of negative space, precise typography, restrained
motion. Think "premium developer tool" not "casino".

### Tokens — `src/styles/tokens.css`

```
--bg:        #0a0a0b;      --surface:   #141416;   --surface-2: #1d1d20;
--text:      #ededef;      --text-dim:  #8a8a93;    --line:      #2a2a2e;
--radius:    14px;         --pad:       clamp(16px, 4vw, 40px);
font: "Inter", "General Sans", system-ui, sans-serif;  // one family, weights 400/500/700
mono for stat numbers: "IBM Plex Mono", ui-monospace
```

Rarity accents (used for border, badge, foil):

```
--common:   #9aa3ad   (cool grey, matte)
--uncommon: #4ea77a   (green)
--rare:     #4a7fd4   (blue)
--mythic:   linear-gradient / conic foil — violet #8b5cf6 → gold #f5c542
```

Respect `prefers-color-scheme` only loosely — the game is dark by design; still honour
`prefers-reduced-motion` (disable flips/foil, cross-fade instead).

### Card component — `src/components/Card.svelte`

- Fixed aspect ratio (2.5 : 3.5, like a real card). Responsive via `container` units.
- Layout: image band (top ~55%), title, thin rule, stat row (`STR nn  DEF nn`),
  rarity badge bottom-right.
- Typographic fallback: large title set in the image band on a rarity-tinted field.
- `rare`/`mythic`: 1px accent border + subtle pointer-tracked foil (animated
  `conic-gradient` masked by a highlight). Mythic adds a slow shimmer.
- Props: `card`, `faceDown?`, `interactive?`. Emits `flip`.

### Screens

- **App shell:** minimal top bar — wordmark left, two nav items (`Open` / `Collection`)
  right, showing a count like `312 / 4,000`. View switching via a store, no router
  needed (add `svelte-spa-router` only if deep-linking to a card is wanted).
- **Open:** centered stack of 7 face-down cards with a soft drop shadow; big `Open pack`
  button; after opening, cards deal out and flip on click/tap; `Reveal all` + `Done`.
  Rare+ pulls get a brief hold + glow. New-to-collection cards get a small "NEW" tag.
- **Collection:** responsive grid, sticky filter bar (rarity chips, sort: recent /
  name / strength / defence, "owned only" is implicit), completion meter per rarity.
  Click → detail overlay with extract, raw stats, and "Read on Wikipedia" link.
- **Empty state:** collection before first pack — one line + arrow to Open.

---

## 7. Project structure

```
wikitcg/
  index.html
  package.json          # scripts: dev, build, preview, pools (tsx build-pools), test
  vite.config.ts
  tsconfig.json
  svelte.config.js
  PLAN.md               # this file
  README.md
  scripts/
    build-pools.ts
    lib/wiki.ts         # shared fetch helpers (also importable by src if wild mode added)
    .cache/             # gitignored
  src/
    main.ts
    App.svelte
    lib/
      pools.ts          # import pools.json, typed accessors, rarity buckets
      rarity.ts         # thresholds + stat formulas (pure, tested)
      pack.ts           # generatePack(): guaranteed-distribution draw
      collection.ts     # persisted Svelte store over localStorage
      types.ts
    components/
      Card.svelte
      Foil.svelte
      PackOpener.svelte
      CardReveal.svelte
      Collection.svelte
      CardDetail.svelte
      RarityBadge.svelte
      NavBar.svelte
    stores/
      view.ts           # 'open' | 'collection'
    styles/
      tokens.css
      global.css
    data/
      pools.json         # generated, committed
      pools.sample.json  # tiny fixture for early dev
  tests/
    rarity.test.ts
    pack.test.ts
```

### `pack.ts` — generation algorithm

```
generatePack(pools, rng = Math.random):
  pick 4 distinct from pools.common
  pick 2 distinct from pools.uncommon
  slot7:
    roll = rng()
    if roll < 1/8 and pools.mythic non-empty: pick 1 from pools.mythic
    else: pick 1 from pools.rare  (fallback to mythic, then uncommon, if a bucket is empty)
  return 7 cards in reveal order [commons…, uncommons…, chase]
  // "distinct" = within this pack; duplicates across packs are expected.
  // Seedable rng so tests are deterministic.
```

### `collection.ts` — persistence

```
localStorage key: "wikitcg:collection:v1"
shape: { [pageid: number]: { count: number, firstOpenedAt: string } }
Card display data comes from pools.json by id (don't duplicate it in storage).
Provide: addCards(cards[]), has(id), count(id), stats() → per-rarity owned/total.
Wrap every read/write in try/catch (private mode, quota). Also store a
"wikitcg:packs-opened" counter for a small stat on the Open screen.
Export/import collection as JSON — nice, cheap, do it if time allows.
```

---

## 8. Milestones (suggested order for future agents)

1. **Scaffold** — Vite + Svelte 5 + TS, tokens/global CSS, `App.svelte` shell with
   `NavBar` + view store, deploy config (static). Commit `pools.sample.json`.
2. **Core logic** — `types.ts`, `rarity.ts` + tests, `pack.ts` + deterministic tests,
   `pools.ts` loading the sample fixture.
3. **Card** — `Card.svelte` with all four rarity treatments, `RarityBadge`, typographic
   fallback, responsive sizing. Storybook-style gallery route optional.
4. **Pack opening** — `PackOpener` + `CardReveal`: deal, flip, foil hold on rare+,
   reduced-motion path.
5. **Collection** — `collection.ts` store, `Collection.svelte` grid + filters +
   completion meters, `CardDetail` overlay with Wikipedia link.
6. **Build script** — `scripts/build-pools.ts`, generate the real `pools.json`
   (~4,000). Review `pools.summary.json`, tune thresholds in `rarity.ts` and re-run.
7. **Polish** — empty states, keyboard nav, focus rings, mobile layout, favicon/OG,
   loading of `pools.json` (code-split if it's large), Lighthouse pass.
8. **Optional** — "wild" mode (live `list=random` + on-the-fly stats, log formulas),
   PWA/offline, collection export/import, share-a-card URL, sound.

---

## 9. Constraints & gotchas

- **No backend, no secrets, no build-time env needed to run the app.** `pools.json` is
  the only data dependency and it's committed.
- **Image licensing:** lead images are Wikimedia-hosted, mostly free-licensed but not
  universally. This is fine for a personal project; always link back to the article
  (attribution) on the card detail. If distributing widely, revisit.
- **`pools.json` size:** ~4,000 cards with short extracts ≈ 1–2 MB. Acceptable
  bundled+gzipped; if it grows, lazy-load it (`await import`) after first paint, or
  split by rarity.
- **Action API needs `origin=*` in the URL** or the request fails CORS — easy to
  forget.
- **`pageviews` trailing `null`** for the current day — filter before summing.
- **`parse&prop=links`** includes templates/categories/files and redlinks — filter to
  `ns 0 && exists`.
- **Redirects:** pass `redirects=1`; key cards by `pageid`, not title.
- **Determinism:** `pack.ts` must accept an injectable RNG for tests.
- **`prefers-reduced-motion`:** every reveal/foil animation needs a static fallback.
