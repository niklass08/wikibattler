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
and **view your collection**. **Disenchant** unwanted cards for **knowledge**, spend
it in the **Shop** on consumable **thematic packs** (one per theme, colour-coded,
all seven cards on-theme). Plus **Battle** (a deterministic auto-battler vs a
practice dummy) and the **Arena** (an opt-in global PvP ladder — see below). The
core game is fully client-side — no backend, no API keys. Your collection lives in
`localStorage`.

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

### The card pool and the background stocker

Packs are **not** pre-built. `src/lib/packQueue.ts` runs a background stocker for
the whole life of the session — whatever view the player is on — keeping a
**pool of cards** topped up for the random pack and for every theme the player
holds packs for. When the player clicks, `assemblePack()` builds the pack out of
that pool **synchronously, with no request at all**: if seven religion cards are
already in stock, the religion pack opens instantly.

The stocker re-targets on every pack-type switch and every purchase. Its
priority each tick is: the type the player is about to open (aggressively, if
its pool can't cover a pack yet), then the themes they own, then random — so
switching back and forth is instant too. It idles once everything is stocked.

Because assembly must not touch the network, exact link counts (one `parse`
call per rare/mythic card) are resolved **by the stocker in the background**;
a card assembled before its turn falls back to the estimate.

Wikimedia rate-limits anonymous browser clients hard, so sourcing is batched
(one request yields ~20 candidates) and a single pass stocks several packs.

- a rarity is only sourced once it drops below `MIN`, and is then stocked to
  `FILL` (`src/lib/draw.ts`); `stockStep()` is one unit of that work;
- sourcing runs in two phases — one step per starved band first (so even a cold
  "quick" build yields all four rarities), then deepening with the leftover
  budget. Every pass has a hard request `BUDGET`;
- the uncommon link harvest is **pooled**: one `parse` of a popular article
  yields hundreds of mid-popularity titles, enriched 20 at a time;
- pools persist (`wikitcg:candidates:v2`, `wikitcg:themed-candidates:v1`), so a
  reload opens instantly too;
- **requests are serial** — `wiki.ts` runs 1 in flight with a ~500 ms gap
  (Wikimedia's ask for anon clients);
- **exact link counts only for rare/mythic** (one `parse` each); the rest
  estimate from byte length *and category count*, so strength doesn't collapse
  into a function of defence (which is bytes);
- a **circuit breaker** trips only on a *sustained* block (a 429 surviving all
  its backoffs), then fails fast for 30 s so a retry storm can't build.

If the API is rate-limiting / unreachable and the pool is short, the pack screen
shows an error + retry.

Rarity/stat thresholds live in `src/lib/rarity.ts`.

## Economy — disenchant & thematic packs

- **`src/lib/economy.ts`** — the one config file: `DISENCHANT_VALUE` per rarity,
  foil/negated bonuses, `THEMATIC_PACK_PRICE`. Tuned generous (one disenchanted
  uncommon ≈ one themed pack); every number is a one-line edit.
- **`src/lib/shop.ts`** — the `knowledge` / `ownedPacks` / `activePack` stores
  (`wikitcg:knowledge:v1`, `:owned-packs:v1`, `:active-pack:v1`) + `buyPacks()`.
- **`src/lib/themes.ts`** — per-theme colour + icon + the `gsrsearch` query that
  sources on-theme candidates.
- **Thematic pack building** (`draw.ts`): themed sourcing goes by
  **infobox template** — `THEMES[t].infobox` is a `hastemplate:"Infobox film"`
  query, an authoritative topic signal with no keyword noise (a keyword `search`
  backs it up when a theme has no usable infobox).

  A relevance-sorted search is ordered by prominence, so the **offset selects a
  rarity band** — verified live against en.wikipedia:

  | `hastemplate:"Infobox film"` | band |
  |---|---|
  | offset 0 | rare / mythic |
  | offset ~100–400 | uncommon |
  | offset 1200+ | common |

  So three requests at three offsets stock a full rarity spread. **Each theme
  keeps its own pool and its own cursors**, so holding several themed packs at
  once costs nothing extra and switching between them re-sources nothing. Cursors
  advance, so a pool never re-fetches a page it already has. `span` is learned
  per theme (halved when a page comes back empty) so small themes page shallower.

  The theme tag is forced onto every card and the same `RarityPools` goes to the
  unchanged `generatePack`. The background stocker keeps every owned theme's pool
  topped up, prioritising whichever one the player has selected.

## Deploy

Static output. For a GitHub Pages project site, build with the repo name as base:

```bash
VITE_BASE=/wikitcg/ npm run build
```

`.github/workflows/deploy.yml` does this on push to `main`.

## Arena (global PvP ladder)

The Arena lets a player publish a **defending team** and other players **attack**
it, with an Elo leaderboard. Battles resolve entirely on the client — the
simulation is deterministic, so any battle is replayable from the two team codes
(`src/lib/battle/defence.ts`) — and the only backend is **Firebase Firestore**,
used purely as a store for serialized teams and ratings. There is no server code.

### The "no API keys" exception

The Firebase **web config** (`src/lib/firebase.ts`) is committed to the repo. A
web config *identifies* a project; it is **not a secret** (Google's docs say so).
Every write is gated by the committed security rules in `firestore.rules`. This is
a deliberate, documented exception to the project's no-secrets / no-build-time-env
rule — it is not a secret, and there is no CI change.

If the config still has its `REPLACE_…` placeholders the Arena tab shows
"not configured" and the rest of the app is unaffected.

### Pointing it at your own Firebase project

1. Create a Firestore project; **Build → Authentication → Sign-in method → Anonymous → Enable**.
2. `npm i -g firebase-tools && firebase login`, set the project id in `.firebaserc`.
3. `firebase deploy --only firestore` (pushes `firestore.rules` + `firestore.indexes.json`).
4. **Authentication → Settings → Authorized domains** — add your Pages origin
   (e.g. `<user>.github.io`) and `localhost`.
5. Project settings → *Your apps* → Web → copy the config over the placeholders in
   `src/lib/firebase.ts`, and the project id into `.firebaserc`.

Free (Spark) tier is plenty for a hobby ladder — ~50k reads / 20k writes per day,
never pauses. List pages are capped at 25 and cached for 5 minutes in
`localStorage` to stay well under that.

### Testing the security rules (local, not in CI)

```bash
firebase emulators:start --only firestore,auth
# then, against the emulator, with @firebase/rules-unit-testing
```

`npm test` stays emulator-free; it covers the deterministic pieces
(`tests/defence.test.ts`, `tests/elo.test.ts`, `tests/battle.symmetric.test.ts`,
`tests/battle.snapshot.test.ts`, `tests/arena-logic.test.ts`).

## Attribution

Card text and images come from Wikipedia and are used under their respective licenses
(mostly CC BY-SA / public domain). Each card links back to its source article.
