# WikiTCG

A trading-card game built on Wikipedia. Every article is a card:

- **Strength** ← number of internal links in the article
- **Defence** ← byte length of the article
- **Rarity** (common / uncommon / rare / mythic) ← the article's popularity (pageviews)
- **Foil** — a rarity-independent holographic finish (Shimmer / Radiant / Cosmic),
  rolled ~1 pack in 7; ~1 pack in 25 is a **god pack** with all 7 cards foiled
- **Themes** — thematic tags (Cinema, Politics, Geography, History, …) classified
  from the article's Wikipedia categories; filter the collection by them

Two screens: **open packs** (7 cards — modally 4 common / 2 uncommon / 1 rare, with
an upgrade roll on every card and a guaranteed rare-or-better in the last slot)
and **view your collection**. Fully client-side — no backend, no API keys. Your
collection lives in `localStorage`.

See [`PLAN.md`](./PLAN.md) for the full design + API notes.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run check      # svelte-check + tsc
npm run build      # -> dist/  (static, deploy anywhere)
```

## Card data — live

There is no card database. Every pack is assembled on demand from the Wikimedia
APIs (`src/lib/wiki.ts` → `src/lib/draw.ts`), so **any** article can turn up:

- **common** — `generator=random` mainspace articles (almost everything)
- **rare / mythic** — the pageviews *top* lists for a few recent months
- **uncommon** — the tail of those top lists, plus outgoing links harvested from
  popular articles (the mid-popularity middle is thin in the top 1000)

When an article has no lead image of its own, `wiki.backupImage()` pulls the first
"content" image from the REST media-list (Wikipedia's own curated gallery set);
articles with nothing usable get a title-tinted typographic card.

`src/lib/packQueue.ts` keeps up to 10 fully-built packs ready in the background
(persisted to `localStorage`), so opening one is instant even though a build makes
~15–20 throttled API calls (exact per-article link counts + image lookups). If the
API is unreachable and the queue is empty, the pack screen shows an error + retry.

Rarity/stat thresholds live in `src/lib/rarity.ts`.

## Deploy

Static output. For a GitHub Pages project site, build with the repo name as base:

```bash
VITE_BASE=/wikitcg/ npm run build
```

`.github/workflows/deploy.yml` does this on push to `main`.

## Attribution

Card text and images come from Wikipedia and are used under their respective licenses
(mostly CC BY-SA / public domain). Each card links back to its source article.
