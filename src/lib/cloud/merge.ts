/**
 * Pure merge rules for cloud sync. No Firestore, no localStorage — every
 * function here is a total function over plain data so the test suite can pin
 * the semantics down, which matters because getting `count` wrong silently
 * inflates or destroys collections.
 *
 * The governing rule is IDEMPOTENCE: syncing the same state twice must be a
 * no-op. That is why counts merge with `max` and not `+`. The cost is real —
 * two devices that each open a pack offline, for the same card, converge on one
 * copy rather than two — but the alternative (summing) multiplies a collection
 * on every re-sync, which is unrecoverable. Losing an occasional duplicate is
 * the cheaper failure.
 */
import type { Card, Collection, FoilTier, OwnedEntry } from '../types';

/** Earliest of two ISO timestamps; a malformed one loses to a valid one. */
function earliest(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta <= tb ? a : b;
}

/**
 * Merge two records of the same card. `next` is treated as the fresher card
 * data (title/stats/extract re-derive from the live article anyway); the
 * player's own accumulated properties — best finish, first signature, art,
 * tags, the earliest acquisition date — are preserved from whichever side has
 * them. Mirrors the re-pull rules in `collection.addCards`.
 */
export function mergeEntry(prev: OwnedEntry, next: OwnedEntry): OwnedEntry {
  const card: Card = {
    ...next.card,
    foil: Math.max(prev.card.foil ?? 0, next.card.foil ?? 0) as FoilTier,
    negated: !!prev.card.negated || !!next.card.negated,
    signature: prev.card.signature ?? next.card.signature ?? null,
    image: next.card.image ?? prev.card.image ?? null,
    tags: next.card.tags?.length ? next.card.tags : (prev.card.tags ?? [])
  };
  return {
    count: Math.max(prev.count, next.count),
    firstOpenedAt: earliest(prev.firstOpenedAt, next.firstOpenedAt),
    card
  };
}

/** Union two collections entry-wise. Commutative and idempotent. */
export function mergeCollections(a: Collection, b: Collection): Collection {
  const out: Collection = { ...a };
  for (const [key, entry] of Object.entries(b)) {
    const id = Number(key);
    const prev = out[id];
    out[id] = prev ? mergeEntry(prev, entry) : entry;
  }
  return out;
}

/**
 * The rest of the player's state. Counters take the max for the same
 * idempotence reason as `count`; the team and handle are a straight
 * last-write-wins on `updatedAt`, since they are single choices rather than
 * accumulations and merging them would produce something the player never
 * picked.
 */
export interface SideState {
  favourites: number[];
  knowledge: number;
  packsOpened: number;
  team: number[];
  handle: string;
  updatedAt: number;
}

export function mergeSide(a: SideState, b: SideState): SideState {
  const newer = b.updatedAt > a.updatedAt ? b : a;
  return {
    favourites: [...new Set([...a.favourites, ...b.favourites])].sort((x, y) => x - y),
    knowledge: Math.max(a.knowledge, b.knowledge),
    packsOpened: Math.max(a.packsOpened, b.packsOpened),
    // an empty team is "not chosen yet", so never let it clobber a real one
    team: newer.team.length ? newer.team : a.team.length ? a.team : b.team,
    handle: newer.handle || a.handle || b.handle,
    updatedAt: Math.max(a.updatedAt, b.updatedAt)
  };
}
