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
and **view your collection**. **Disenchant** unwanted cards for **knowledge**
(there is nothing to spend it on yet — the Shop is a *coming soon* preview of the
thematic packs it is meant for). Plus **Battle** (a deterministic auto-battler vs a
practice dummy) and the **Arena** (an opt-in global PvP ladder — see below). The
core game is fully client-side — no backend, no API keys. Your collection lives in
`localStorage`, and can optionally be **synced to a Google account** so it follows
you between devices (see below).

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
**pool of cards** topped up. When the player clicks, `assemblePack()` builds the
pack out of that pool **synchronously, with no request at all**: if there are
already seven cards in stock, the pack opens instantly.

The stocker works urgently (150 ms ticks, impatient fetch profile) while the pool
can't cover a pack, eases off once it can, and idles at 20 s once it is full.

Because assembly must not touch the network, exact link counts (one `parse`
call per rare/mythic card) are resolved **by the stocker in the background**;
a card assembled before its turn falls back to the estimate.

Wikimedia rate-limits anonymous browser clients hard, so sourcing is batched
(one request yields ~20 candidates) and a single pass stocks several packs.

- the stocker works toward **`FILL` = 100 cards of every rarity**
  (`src/lib/draw.ts`), so the pool stays far ahead of consumption and a pack is
  essentially always assemblable; `stockStep()` is one unit of that work;
- sourcing runs in two phases — `SEED` any rarity that can't yet contribute its
  share of a pack (so even a cold start gives a 4C/2U/1R pack), then deepen
  toward `FILL`. Every pass has a hard request `BUDGET`;
- once the pool can cover a pack, stocking **alternates** with resolving exact
  link counts, so neither starves the other;
- persisting a full pool is a ~300 KB stringify, so it is throttled to once
  every 5 s (forced when a pack is actually dealt);
- the uncommon link harvest is **pooled**: one `parse` of a popular article
  yields hundreds of mid-popularity titles, enriched 20 at a time;
- the pool persists (`wikitcg:candidates:v2`), so a reload opens instantly too;
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

## Economy — disenchanting

- **`src/lib/economy.ts`** — the one config file: `DISENCHANT_VALUE` per rarity,
  foil/negated bonuses, `THEMATIC_PACK_PRICE`. Every number is a one-line edit.
- **`collection.disenchant(id, n)` / `disenchantDuplicates()`** turn cards into
  **knowledge** and return the amount earned; favourites are protected and the
  last copy needs a confirm. Buttons live in `CardDetail` and the Collection
  header.
- **`src/lib/shop.ts`** — the `knowledge` store (`wikitcg:knowledge:v1`).

**Thematic packs are not built.** The Shop is a *coming soon* screen: it shows
the knowledge balance and previews the themes that are planned, but nothing is
purchasable. Knowledge still accrues and persists, so a player disenchanting now
keeps the balance for when the shop opens. `src/lib/themes.ts` keeps each theme's
label, icon and colour for that preview.

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

1. Create a Firestore project; **Build → Authentication → Sign-in method** — enable
   both **Anonymous** (the Arena identity) and **Google** (cloud sync).
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

## Cloud sync (sign in with Google)

Optional. Signed out, nothing changes: the game never contacts a backend and the
Firebase SDK is not even downloaded. Sign in and the collection is mirrored to
Firestore under `collections/{uid}`, so opening WikiTCG on a phone and signing in
with the same Google account brings the collection with it.

### Identity

Signing in **links** the Google credential onto the existing anonymous account, so
the uid does not change and Arena rating, defence and attack history carry over
untouched.

The exception is a second device. There the Google account already owns a uid, so
`linkWithPopup` fails with `auth/credential-already-in-use` and the app signs in
*as* that account instead. The collections merge, but the anonymous Arena rating
that device had built up is left behind — a client cannot reassign a document to
another uid under `firestore.rules`. The UI says so explicitly when it happens.

### Storage shape

    collections/{uid}                meta: rev + handle, team, knowledge, favourites
    collections/{uid}/chunks/{0-7}   the collection, one deflate-raw blob each

Both are **owner-only for read as well as write** — the only private tree in the
database, since everything under `defences/` and `profiles/` has to be world-
readable for the ladder to work without a server.

Measured against 700 real random enwiki articles, an entry is ~659 bytes of JSON
and ~177 compressed, so a single document would hit Firestore's 1 MiB cap at
roughly 5,900 unique cards. Splitting by `id % 8` (`src/lib/cloud/wire.ts`) lifts
that to ~47k and means opening a pack rewrites only the shards it touched.
`url` is dropped on the wire and rebuilt from the title; `extract` is kept, because
it cannot be recomputed locally and a restore without it would look broken.

### Merge rules

`src/lib/cloud/merge.ts`, pinned by `tests/cloud.test.ts`. The governing rule is
that syncing twice must be a no-op, so duplicate counts merge with **max**, not
`+` — summing would multiply a collection on every re-sync, which is
unrecoverable. The cost is that two devices opening a pack for the same card while
both offline converge on one copy. Finishes take the best of either side,
`firstOpenedAt` the earliest, favourites union, and handle/team are
last-write-wins on a persisted timestamp.

Sync is pull-on-start / debounced-push-on-change (6s idle, flushed on
`pagehide`), not live replication: `firebase/firestore/lite` has no snapshot
listeners and the full SDK is not worth its bundle here.

### Signing out

Leaves the local collection alone — nothing is deleted from the device, and the
next Arena visit mints a fresh anonymous identity. On a shared browser the next
person would see the collection that was left there.

## localStorage limits

An entry is ~659 bytes, so a browser's typical 5 MB per-origin budget runs out
somewhere around **8,000 unique cards** — sooner in practice, because the
candidate pool (`wikitcg:candidates:v2`) and the pageview caches share it.
Duplicates are free: `count` is an integer, so 3,000 unique cards at ten copies
each is still only ~1.9 MB.

`safeSet` used to swallow the resulting `QuotaExceededError`, which meant a player
at that size silently lost every pack they opened from then on. It now raises
`storageFull` (`src/lib/storage.ts`) and the app shows a banner telling them to
sign in or disenchant duplicates.

## Attribution

Card text and images come from Wikipedia and are used under their respective licenses
(mostly CC BY-SA / public domain). Each card links back to its source article.
