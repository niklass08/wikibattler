/**
 * Knowledge — the currency earned by disenchanting cards (see `collection.ts`
 * and `economy.ts`).
 *
 * There is nothing to spend it on yet: thematic packs are not built. Knowledge
 * still accrues and persists, so a player who disenchants now keeps the balance
 * for when the shop opens.
 */
import { writable } from 'svelte/store';
import { safeGet, safeSet } from './arena/local';

const KNOWLEDGE_KEY = 'wikitcg:knowledge:v1';

function loadKnowledge(): number {
  const n = Number(safeGet(KNOWLEDGE_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function createKnowledge() {
  const { subscribe, update, set } = writable<number>(loadKnowledge());
  const persist = (n: number) => {
    safeSet(KNOWLEDGE_KEY, String(n));
    return n;
  };
  return {
    subscribe,
    /** Earn knowledge. No-op for a non-positive amount. */
    add(n: number) {
      if (!(n > 0)) return;
      update((k) => persist(k + Math.round(n)));
    },
    /** Spend `n` if affordable — returns whether it went through. Atomic. */
    spend(n: number): boolean {
      let ok = false;
      update((k) => {
        if (k >= n) {
          ok = true;
          return persist(k - n);
        }
        return k;
      });
      return ok;
    },
    hydrate(n: number) {
      set(persist(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0));
    },
    reset() {
      set(persist(0));
    }
  };
}

export const knowledge = createKnowledge();
