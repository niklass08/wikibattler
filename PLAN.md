# WikiTCG — Implementation Plan

A trading-card game built on Wikipedia. Every Wikipedia article maps to a card.
Fully client-side, no backend, deployable as static files.

This document is the source of truth for agents building the project. Read it fully
before working. Update it when decisions change.

---

## 0. Status — live-fetch rework (2026-08-28)

Working end to end: scaffold, both screens, pack opening with the stacked-deck
reveal, collection with filters + per-rarity counts, card detail. `npm run dev`
runs it; `npm test` (23 tests), `npm run check`, `npm run build` all pass. App
bundle ~27 KB gz, no data chunk.

**The build-time crawler is gone.** Cards are now fetched live from the Wikimedia
APIs on demand, so any of Wikipedia's ~7M articles can appear in a pack. Sections
§2–§5 below are rewritten / marked historical to match.

Key pieces:

- `src/lib/wiki.ts` — browser Wikimedia client. `origin=*`, **no custom headers**
  (they'd force a CORS preflight the API won't answer), 250 ms inter-request
  throttle, retry with `Retry-After`. `backupImage(title)` fills card art for
  articles with no lead image, from the REST `media-list` gallery set.
- `src/lib/draw.ts` — `buildPack()`: fill a candidate bucket per rarity from the
  right source, hand it to the unchanged pure `generatePack()` (pack.ts), then
  set each card's strength — an exact `parse` link count for rare/mythic, a
  byte-length estimate (`estLinks`) for common/uncommon so no extra request.
  Sources: common ← `generator=random`; rare/mythic ← pageviews *top* lists;
  uncommon ← top-list tails + links harvested off popular articles. Buckets and
  sourcing progress are **persisted** (`wikitcg:candidates:v1`); `warmBuckets()`
  tops them up in small bounded steps while the player looks at a pack. A shared
  lock serialises `buildPack` and `warmBuckets`.
- `src/lib/packQueue.ts` — ~3 fully-built packs kept ready in the background,
  persisted to `localStorage`. `take()` is synchronous; the queue refills after
  and then calls `warmBuckets()`. An empty queue flips fetch mode to `fg` and
  builds the next pack "quick"; empty queue + API error ⇒ PackOpener error + Retry.
- `src/lib/collection.ts` — v2 store; entries carry the full `Card` (no pool to
  look them up in). `computeProgress` is counts only (no completion %).
- **Rarity thresholds** unchanged in `src/lib/rarity.ts`: `uncommon 10k / rare 150k
  / mythic 400k` monthly views. The `strengthFromLinks` / `defenceFromBytes` log
  formulas (once the "wild mode" fallback) are now the only stat path.
- **Foil** (`src/lib/foil.ts`) is a rarity-independent holographic finish rolled per
  pack (~1 pack in 7), 3 tiers, `Foil.svelte`. ~1 pack in 25 is a **god pack**
  (`GOD_PACK_CHANCE`) — every one of its 7 cards foiled. See §6.
- **Themes** (`src/lib/tags.ts`) — `deriveTags()` maps an article's Wikipedia
  categories (added to the enrich call as `prop=categories`) to a small fixed set
  (`TAGS`: cinema, music, sport, politics, war, history, science, geography, arts,
  games, nature, business, religion), each a keyword regex scored over the category
  titles. Stored on `Card.tags`; the Collection view shows a theme filter row and
  batch-backfills tags on older cards via `wiki.fetchCategories`.

Known follow-ups: diversify uncommon sourcing (link-harvest skews to whatever the
seed article is about), collection export/import, a "packs ready" affordance.

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
- **Pack rarity:** base 4 common / 2 uncommon / 1 rare, then **every slot rolls to
  upgrade** one tier at a time until a roll misses; the chance rises with slot
  depth (`upgradeChance`). Last slot is a guaranteed rare that can reach mythic.
  Modal pack ≈ 4C/2U/1R (~55%). Constants in `pack.ts` (§ generation algorithm).
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
Static SPA. No server, no API keys, no bundled data. Browser only.

  Wikimedia APIs
     │
  src/lib/wiki.ts      origin=*, throttled, retrying fetch helpers
     │
  src/lib/draw.ts      buildPack(): stock a bucket per rarity from the right
     │                 source, then generatePack() (pack.ts, pure, unchanged)
     │                 picks the 7 (4C/2U/1R modal, per-slot upgrade rolls)
  src/lib/packQueue.ts up to 10 packs kept ready in the background,
     │                 persisted to localStorage
  PackOpener.svelte    take() a ready pack instantly → stacked-deck reveal
     │
  collection store (localStorage, v2 — stores the full Card)
     │
  Collection.svelte    counts + filters + sort (no completion %)
```

**Why live works despite the guaranteed distribution.** A known population per
rarity is still needed — `list=random` alone can't fill the rare slot. The fix is
**per-slot sources**: `generator=random` for commons, the pageviews *top* lists for
rare/mythic, link-harvesting for the uncommon middle. Latency is hidden behind the
background **prefetch queue** of ~3 packs + persisted candidate buckets, and the
per-pack call count is kept low (serial requests, exact link counts only for
rare/mythic, a sustained-block circuit breaker) so a browser client stays off
Wikimedia's 429 list. No offline mode: empty queue + unreachable API ⇒ error + retry.

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

## 4. Build script — HISTORICAL, removed

`scripts/build-pools.ts` and the committed `src/data/pools.json` were deleted in the
live-fetch rework (§0). The API notes in §3 still apply — the browser client in
`src/lib/wiki.ts` uses the same endpoints. The steps below are kept only as a record
of how the old crawl worked.

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
7. **Derive stats** on the 1–1000 log scale (§Stats). Store both raw and derived.
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
      "strength": 470,                  // 1–1000 log scale
      "defence": 760,
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

Log scale on the heavy-tailed inputs, mapped to **1–1000** between per-stat
anchors with a curve that spreads the mid-range (see `rarity.ts`):

```ts
// t = normalised log position between the min/max anchor, clamped 0..1
strength = round(1000 * clamp(t(links, 3, 6000), 0, 1) ** 1.6)   // 1..1000
defence  = round(1000 * clamp(t(bytes, 800, 500_000), 0, 1) ** 1.6)
```

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

Rarity accents (`--common/uncommon/rare/mythic`, plus `--mythic-2` gold) drive the
corner **rarity glyph** — a small mark whose treatment escalates with rarity
(`Card.svelte`). Rarity itself no longer implies any shine.

Holographic **foil** is a separate axis (`src/lib/foil.ts`, `--foil-1..5` palette):

- Rolled per pack, `FOIL_PACK_CHANCE = 1/7`, tiers weighted `.62 / .28 / .1`.
- `GOD_PACK_CHANCE = 1/25`: all 7 cards foiled; PackOpener shows a rainbow banner.
- Any card of any rarity can be foil; the collection keeps the best tier pulled.
- 3 tiers in `Foil.svelte`, `Shimmer / Radiant / Cosmic`:
  1. the old mythic conic shimmer + pointer-tracked sheen (subtle baseline)
  2. + tilt-reactive holographic bands + a travelling shine
  3. + a hue-cycling rainbow wash + twinkling sparkles + a pulsing border
- Suppressed while `faceDown` (would leak the pull, and blend/animation layers
  bleed past `backface-visibility`).

Respect `prefers-color-scheme` only loosely — the game is dark by design; still honour
`prefers-reduced-motion` (global CSS freezes every animation; static gradients remain).

### Card component — `src/components/Card.svelte`

- Fixed aspect ratio (2.5 : 3.5, like a real card). Responsive via `container` units.
- Layout: image band (top ~55%), title, thin rule, centred `STR / DEF` row.
- Typographic fallback: large initials in the image band on a rarity-tinted field.
- Corner rarity glyph (top-left), `NEW` / `×N` tags (top-right).
- Foil finish (`card.foil > 0`): iridescent border + glow (tiered) and a `<Foil>`
  overlay. `foil` is surfaced by name in the pack-open summary and card detail.
- Props: `card`, `faceDown?`, `dupCount?`, `isNew?`, `onclick?`.

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
  package.json          # scripts: dev, build, preview, check, test
  vite.config.ts
  tsconfig.json  tsconfig.node.json  svelte.config.js
  PLAN.md  README.md
  src/
    main.ts             # mount immediately, then packQueue.start()
    App.svelte
    lib/
      wiki.ts           # browser Wikimedia client (fetch helpers, toCard)
      draw.ts           # buildPack(): per-rarity sourcing + generatePack()
      packQueue.ts      # background prefetch of ~5 ready packs + persistent candidate buckets
      rarity.ts         # thresholds + stat formulas (pure, tested)
      pack.ts           # generatePack(): 4C/2U/1R modal, per-slot upgrade rolls (pure, tested)
      collection.ts     # persisted store (v2: stores full Card) + computeProgress
      types.ts
    components/
      Card.svelte  Foil.svelte  RarityBadge.svelte
      PackOpener.svelte  Collection.svelte  CardDetail.svelte  NavBar.svelte
    stores/view.ts      # 'open' | 'collection'
    styles/tokens.css  styles/global.css
  tests/
    rarity.test.ts  pack.test.ts  collection.test.ts
    render.test.ts  live.test.ts   # live.test.ts stubs fetch
```

### `pack.ts` — generation algorithm

```
PACK_BASE = [common, common, common, common, uncommon, uncommon, rare]

generatePack(pools, rng = Math.random):
  for depth 0..6:
    rarity = rollUpgrades(PACK_BASE[depth], depth, rng)   // climb the ladder
    pick 1 distinct card of that rarity (FALLBACK tries higher tiers first)
  return the 7 cards in reveal order

rollUpgrades(base, depth, rng):
  p = UPGRADE_MIN + UPGRADE_STEP * depth   // ~3% shallow → ~13% deepest
  rarity = base
  while rarity < mythic and rng() < p: rarity = next tier   // stop on first miss
  return rarity

// Slot 7 is a guaranteed rare that can climb to mythic. Nothing else is a
// floor — even a shallow common can chain all the way up, just rarely.
// Modal pack ≈ 4C / 2U / 1R (~55%). "distinct" = within a pack; cross-pack
// dupes expected. Seedable rng so tests are deterministic.
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

## 11. Economy — disenchant & thematic packs (added 2026-08-30)

- **Disenchant → knowledge → consumable thematic packs.** `src/lib/economy.ts` is
  the tunable config (disenchant value per rarity + foil/negated bonus,
  `THEMATIC_PACK_PRICE`); `src/lib/shop.ts` holds `knowledge` / `ownedPacks` /
  `activePack` (mirroring `createPacksOpened`); `collection.disenchant(id, n)` /
  `disenchantDuplicates()` mutate the collection and return the knowledge earned
  (favourites protected, last copy allowed).
- **`src/lib/themes.ts`** — per-`Tag` `{ label, icon, color, search }`. Colour is
  the single source of truth, applied via inline `style:--accent` (tokens.css
  untouched).
- **Thematic pack sourcing** (`draw.ts`): `buildPack({ theme })` fills a separate
  `themedBuckets` (one theme active at a time, `usedIds` shared) from
  `wiki.searchEnriched` — the primary query is `THEMES[t].infobox`, a
  `hastemplate:"Infobox …"` clause (an infobox is an authoritative topic signal
  — cleaner than keyword matching and it works where Wikidata SPARQL times out
  on people/occupations); `THEMES[t].search` keyword query backs it up if the
  template is too narrow. `gsrsort=relevance` with page 0 (flagship rare/mythic)
  then a random offset for variety. The theme tag is forced onto every card
  (`assembleFrom` `forceTag`). ~4–6 requests, same as a random pack. Themed
  buckets not persisted.
- **`packQueue`** subscribes to `activePack` + `ownedPacks`: `target()` caps a
  themed queue at `min(owned, MAX_PREFETCH)`; a type switch bumps `switchGen`
  (discards stale in-flight builds), stashes the old queue in memory, rebuilds;
  persists `{ tag, packs }`.
- **`generator=search` verified** to return `pageviews` + `categories` — no
  `enrichTitles` fallback needed. Niche themes (disease/scientists/vehicles/plants)
  are noisier: the guaranteed rare can degrade to a promoted uncommon via the
  existing `FALLBACK`. Documented in Help.

## 10. Arena — global PvP ladder (added 2026-08-30, after §9)

An opt-in async ladder: publish a **defending team**, attack anyone else's, ranked
by Elo. Lives in its own lazily-loaded chunk so the core game is untouched.

- **Battles are 100% client-side.** `simulate(a, b)` is now **symmetric** — two
  full `TeamStats` trade blows, side A (the attacker) first. The single-player
  Goldfish fight runs through `simulateVsDummy`, which wraps the flat stat block
  as a one-sided team; `tests/battle.snapshot.test.ts` locks that path
  byte-for-byte against the pre-symmetric behaviour.
- **Attacker first-strike is intentional** — if A's swing empties B, B never
  answers. So `simulate(A,B)` is not the inverse of `simulate(B,A)`. It rewards
  attacking, which keeps the ladder active.
- **`DefenceCode`** (`src/lib/battle/defence.ts`): `"1." + base64url(deflate(json))`
  of `{id,title,str,def,rarity,role,signature,tags[]}` per card. `role` is shipped
  so the extract can be dropped; `classifyCard` gained an optional `battleRole`
  override that only the decoder sets. `decodeDefence` never throws.
- **Elo** (`src/lib/arena/elo.ts`): start 1200, K 64 while `games < 10` then 32,
  every step clamped to ±48 (must match the rules bound). Only the **first**
  resolved attack of an (attacker → defender) pair is rated. Board shows
  `games >= 10` only.
- **Store: Firebase Firestore + Anonymous Auth, no server code.** `defences/{uid}`,
  `defences/{uid}/attacks/{attackerUid}`, `profiles/{uid}`. The write path
  (`src/lib/arena/ladder.ts`) runs a transaction so the rules' `getAfter` check on
  the attack doc holds.
- **The Firebase web config is committed and public by design** (`src/lib/firebase.ts`)
  — it identifies the project, it is not a secret; `firestore.rules` gates every
  write. This is the one documented exception to §9's no-secrets rule. Rules can't
  do the Elo arithmetic, so they bound magnitude and require a matching rated
  attack doc for cross-user writes; a determined cheater can still script bounded
  writes — accepted for a friendly ladder.
- **Setup** (maintainer, once): see README "Arena". `firebase deploy --only
  firestore`, enable Anonymous auth, authorize the Pages origin, paste the web
  config. Rules tests run against the local emulator, never in CI.
- **Free-tier discipline:** every list `limit(25)` + cursor; ladder/browse pages
  cached 5 min in `localStorage` (`src/lib/arena/cache.ts`); 60-day staleness
  filter hides abandoned per-device identities.

## 9. Constraints & gotchas

- **No backend, no secrets, no build-time env.** All card data is fetched live at
  runtime; nothing is bundled or committed. (The Arena's Firebase *web config* is
  committed and is not a secret — see §10.)
- **Image licensing:** card art is Wikimedia-hosted. `wiki.ts` sets
  `pilicense=any`, so fair-use images (album/film/book covers, logos, box art) are
  included — most of the interesting art. Fine for a personal project; the card
  detail links back to the article for attribution. Revisit before distributing.
- **`pageimages` hides non-free images by default** (`pilicense=free`). Without
  `pilicense=any` roughly every media article (album, film, game, company) is
  imageless. Anything still imageless is resolved lazily by `Card.svelte`: any
  face-up card with no art calls `backupImage()` (REST `media-list`) once and
  hands the URL back via `onResolveImage`, which every caller wires to
  `collection.setImage` — so grid, detail and reveal all self-heal and persist.
- **Action API needs `origin=*` in the URL** or the request fails CORS — easy to
  forget. Do **not** add custom request headers (e.g. `Api-User-Agent`) from the
  browser — that triggers a preflight the API doesn't answer.
- **Rate limits:** Wikimedia rate-limits anon browser clients aggressively.
  `wiki.ts` runs **serial** (1 in flight, ~500 ms gap), honours a *capped*
  `Retry-After` on 429, and trips a **circuit breaker** (fail fast for 30 s) only
  when a 429 survives *all* its backoffs — a transient burst limit costs nothing.
  Foreground vs background fetch modes trade retries for speed. Keeping the
  per-pack call count low (≈8: exact link counts for rare/mythic only) matters
  more than concurrency.
- **`pageviews` trailing `null`** for the current day — filter before summing.
- **`parse&prop=links`** includes templates/categories/files and redlinks — filter to
  `ns 0 && exists`.
- **Redirects:** pass `redirects=1`; key cards by `pageid`, not title.
- **Determinism:** `pack.ts` must accept an injectable RNG for tests.
- **`prefers-reduced-motion`:** every reveal/foil animation needs a static fallback.
