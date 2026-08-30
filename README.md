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

`src/lib/packQueue.ts` keeps ~3 fully-built packs ready in the background
(persisted to `localStorage`), so opening one is instant. Wikimedia rate-limits
anonymous browser clients hard, so a build is kept lean:

- **requests are serial** — `wiki.ts` scheduler runs 1 in flight with a ~500 ms
  gap (Wikimedia's stated ask for anon clients);
- **exact link counts only for rare/mythic** (one `parse` call each); common and
  uncommon estimate strength from wikitext byte length — no extra request;
- **candidate buckets persist** (`wikitcg:candidates:v1`); `warmBuckets()` tops
  them up in small bounded steps while the player looks at a pack;
- a **circuit breaker** trips only on a *sustained* block (a 429 that survives
  all its backoffs), then fails fast for 30 s so a retry storm can't build;
- the first pack for a waiting player is built in a **"quick" mode**.

If the API is rate-limiting / unreachable and the queue is empty, the pack screen
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
- **Thematic pack building** (`draw.ts`): `buildPack({ theme })` sources candidates
  by **infobox template** — `THEMES[t].infobox` is a `hastemplate:"Infobox film"`
  (etc.) query, which is an authoritative topic signal (no keyword noise); a
  keyword `search` backs it up if a template is too narrow. `generator=search
  &gsrsort=relevance` with page 0 for the theme's flagship rare/mythic articles
  then a random offset for variety. The theme tag is forced onto every card and
  the same `RarityPools` goes to the unchanged `generatePack`. Costs about the
  same handful of requests as a random pack. `packQueue` follows `activePack`,
  caps a themed queue at the number owned, and stashes the other type's built
  packs for a fast switch-back.

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
