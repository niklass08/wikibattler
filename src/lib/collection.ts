import { writable } from 'svelte/store';
import type { Card, Collection, OwnedEntry, Rarity } from './types';
import { RARITIES } from './types';

// v2: entries carry the full card — there is no static pool to look it up in.
const COLLECTION_KEY = 'wikitcg:collection:v2';
const PACKS_KEY = 'wikitcg:packs-opened:v1';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — collection is session-only this run */
  }
}

function loadCollection(): Collection {
  const raw = safeGet(COLLECTION_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Collection;
    if (!parsed || typeof parsed !== 'object') return {};
    // keep only well-formed entries (a card with an id)
    const clean: Collection = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry && typeof entry === 'object' && entry.card && typeof entry.card.id === 'number') {
        entry.card.foil ??= 0; // cards saved before the foil system
        entry.card.negated ??= false; // cards saved before the negated system
        entry.card.tags ??= []; // cards saved before the tag system
        clean[Number(id)] = entry;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function loadPacks(): number {
  const raw = safeGet(PACKS_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function createCollection() {
  const { subscribe, set, update } = writable<Collection>(loadCollection());

  return {
    subscribe,
    /** Add a batch of pulled cards; returns which ids were new to the collection. */
    addCards(cards: Card[]): Set<number> {
      const newIds = new Set<number>();
      update((c) => {
        const next: Collection = { ...c };
        const now = new Date().toISOString();
        for (const card of cards) {
          const existing = next[card.id];
          if (existing) {
            // refresh card data, but keep the best finishes, any image and tags
            const foil = Math.max(existing.card.foil, card.foil) as Card['foil'];
            const negated = existing.card.negated || card.negated;
            const image = card.image ?? existing.card.image;
            const tags = card.tags.length ? card.tags : existing.card.tags;
            next[card.id] = {
              ...existing,
              count: existing.count + 1,
              card: { ...card, foil, negated, image, tags }
            };
          } else {
            next[card.id] = { count: 1, firstOpenedAt: now, card } satisfies OwnedEntry;
            newIds.add(card.id);
          }
        }
        safeSet(COLLECTION_KEY, JSON.stringify(next));
        return next;
      });
      return newIds;
    },
    /** Backfill card art for an already-owned card that was pulled without one. */
    setImage(id: number, url: string) {
      update((c) => {
        const entry = c[id];
        if (!entry || entry.card.image) return c;
        const next = { ...c, [id]: { ...entry, card: { ...entry.card, image: url } } };
        safeSet(COLLECTION_KEY, JSON.stringify(next));
        return next;
      });
    },
    /** Backfill thematic tags on a card pulled before the tag system. */
    setTags(id: number, tags: string[]) {
      update((c) => {
        const entry = c[id];
        if (!entry) return c;
        const next = { ...c, [id]: { ...entry, card: { ...entry.card, tags } } };
        safeSet(COLLECTION_KEY, JSON.stringify(next));
        return next;
      });
    },
    reset() {
      set({});
      safeSet(COLLECTION_KEY, JSON.stringify({}));
    }
  };
}

function createPacksOpened() {
  const { subscribe, update } = writable<number>(loadPacks());
  return {
    subscribe,
    increment() {
      update((n) => {
        const next = n + 1;
        safeSet(PACKS_KEY, String(next));
        return next;
      });
    }
  };
}

export const collection = createCollection();
export const packsOpened = createPacksOpened();

export interface RarityCount {
  rarity: Rarity;
  owned: number;
}

/**
 * Pure collection stats. There is no fixed universe to complete against any
 * more, so this is counts only: unique cards, total cards (with duplicates),
 * and unique owned per rarity.
 */
export function computeProgress(col: Collection): {
  perRarity: RarityCount[];
  ownedUnique: number;
  totalCards: number;
} {
  const owned: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
  let totalCards = 0;
  for (const entry of Object.values(col)) {
    owned[entry.card.rarity] += 1;
    totalCards += entry.count;
  }
  return {
    perRarity: RARITIES.map((rarity) => ({ rarity, owned: owned[rarity] })),
    ownedUnique: Object.keys(col).length,
    totalCards
  };
}
