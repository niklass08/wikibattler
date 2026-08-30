/**
 * The thematic-pack economy's persisted state:
 *   knowledge   — the currency, earned by disenchanting cards (see collection.ts)
 *   ownedPacks  — unopened thematic packs held, per theme (consumed one per open)
 *   activePack  — which pack the opener draws from ('random' or a theme)
 *
 * All three mirror the `createPacksOpened` pattern in collection.ts: a writable
 * seeded from a defensive loader, mutators that persist inside `update`.
 */
import { get, writable } from 'svelte/store';
import { safeGet, safeSet } from './arena/local';
import { TAGS, type Tag } from './tags';
import { isTag } from './themes';
import { THEMATIC_PACK_PRICE } from './economy';

export type ActivePack = 'random' | Tag;

const KNOWLEDGE_KEY = 'wikitcg:knowledge:v1';
const OWNED_KEY = 'wikitcg:owned-packs:v1';
const ACTIVE_KEY = 'wikitcg:active-pack:v1';

// ── knowledge ──────────────────────────────────────────────────────────────
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
    reset() {
      set(persist(0));
    }
  };
}

export const knowledge = createKnowledge();

// ── ownedPacks ─────────────────────────────────────────────────────────────
type PackCounts = Partial<Record<Tag, number>>;

function loadOwned(): PackCounts {
  const raw = safeGet(OWNED_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: PackCounts = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (isTag(k) && Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

function createOwnedPacks() {
  const store = writable<PackCounts>(loadOwned());
  const { subscribe, update, set } = store;
  const persist = (v: PackCounts) => {
    safeSet(OWNED_KEY, JSON.stringify(v));
    return v;
  };
  return {
    subscribe,
    add(tag: Tag, qty: number) {
      if (!(qty > 0)) return;
      update((v) => persist({ ...v, [tag]: (v[tag] ?? 0) + Math.floor(qty) }));
    },
    /** Open one — decrement, drop the key at zero. */
    consume(tag: Tag) {
      update((v) => {
        const left = (v[tag] ?? 0) - 1;
        const next = { ...v };
        if (left > 0) next[tag] = left;
        else delete next[tag];
        return persist(next);
      });
    },
    /** Non-reactive read. */
    count(tag: Tag): number {
      return get(store)[tag] ?? 0;
    },
    reset() {
      set(persist({}));
    }
  };
}

export const ownedPacks = createOwnedPacks();

// ── activePack ─────────────────────────────────────────────────────────────
function loadActive(): ActivePack {
  const raw = safeGet(ACTIVE_KEY);
  if (raw && isTag(raw) && ownedPacks.count(raw) > 0) return raw;
  return 'random';
}

function createActivePack() {
  const { subscribe, set } = writable<ActivePack>(loadActive());
  return {
    subscribe,
    set(v: ActivePack) {
      set(v);
      safeSet(ACTIVE_KEY, v);
    },
    reset() {
      set('random');
      safeSet(ACTIVE_KEY, 'random');
    }
  };
}

export const activePack = createActivePack();

// ── purchase ───────────────────────────────────────────────────────────────
/** Buy `qty` packs of `tag`. Returns false (no mutation) when knowledge is short. */
export function buyPacks(tag: Tag, qty: number): boolean {
  if (!(qty > 0) || !isTag(tag)) return false;
  if (!knowledge.spend(qty * THEMATIC_PACK_PRICE)) return false;
  ownedPacks.add(tag, qty);
  return true;
}

/** Themes the player currently holds packs for, in canonical order. */
export function ownedThemes(counts: PackCounts): Tag[] {
  return TAGS.filter((t) => (counts[t] ?? 0) > 0);
}
