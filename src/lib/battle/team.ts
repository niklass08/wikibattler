/**
 * The player's chosen battle team — up to 7 card ids, persisted. The one-mythic
 * cap depends on card data (rarity), so it is enforced by the team builder UI;
 * this store only guards the hard size limit and keeps insertion order.
 */
import { writable } from 'svelte/store';
import { TEAM_SIZE } from './engine';
import { safeGet, safeSet } from '../storage';

const KEY = 'wikitcg:battle-team:v1';

function load(): number[] {
  const raw = safeGet(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number').slice(0, TEAM_SIZE);
  } catch {
    return [];
  }
}

function createBattleTeam() {
  const { subscribe, set, update } = writable<number[]>(load());

  const persist = (ids: number[]) => {
    safeSet(KEY, JSON.stringify(ids));
    return ids;
  };

  return {
    subscribe,
    /** Add a card if there is room; remove it if already picked. No-op when full. */
    toggle(id: number) {
      update((ids) => {
        if (ids.includes(id)) return persist(ids.filter((x) => x !== id));
        if (ids.length >= TEAM_SIZE) return ids;
        return persist([...ids, id]);
      });
    },
    remove(id: number) {
      update((ids) => persist(ids.filter((x) => x !== id)));
    },
    hydrate(ids: number[]) {
      set(persist(ids.filter((n) => typeof n === 'number').slice(0, TEAM_SIZE)));
    },
    clear() {
      set(persist([]));
    }
  };
}

export const battleTeam = createBattleTeam();
