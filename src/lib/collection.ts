import { writable } from 'svelte/store';
import type { Card, Collection, OwnedEntry, Rarity } from './types';
import { RARITIES } from './types';

const COLLECTION_KEY = 'wikitcg:collection:v1';
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
    return parsed && typeof parsed === 'object' ? parsed : {};
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
            next[card.id] = { ...existing, count: existing.count + 1 };
          } else {
            next[card.id] = { count: 1, firstOpenedAt: now } satisfies OwnedEntry;
            newIds.add(card.id);
          }
        }
        safeSet(COLLECTION_KEY, JSON.stringify(next));
        return next;
      });
      return newIds;
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

export interface RarityProgress {
  rarity: Rarity;
  owned: number;
  total: number;
}

export function computeProgress(
  col: Collection,
  cardById: Map<number, Card>,
  totalsByRarity: Record<Rarity, number>
): { perRarity: RarityProgress[]; ownedUnique: number; total: number } {
  const owned: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
  for (const idStr of Object.keys(col)) {
    const card = cardById.get(Number(idStr));
    if (card) owned[card.rarity] += 1;
  }
  const perRarity = RARITIES.map((rarity) => ({
    rarity,
    owned: owned[rarity],
    total: totalsByRarity[rarity]
  }));
  const ownedUnique = perRarity.reduce((s, r) => s + r.owned, 0);
  const total = perRarity.reduce((s, r) => s + r.total, 0);
  return { perRarity, ownedUnique, total };
}
