import type { Card, Rarity } from './types';

export interface RarityPools {
  common: Card[];
  uncommon: Card[];
  rare: Card[];
  mythic: Card[];
}

export const PACK_SIZE = 7;

export type Rng = () => number;

/**
 * Base rarity of each slot, in reveal order, before upgrade rolls. Slot 7 is a
 * guaranteed rare-or-better; the rest form the modal 4-common / 2-uncommon pack.
 * Nothing here is a hard floor except the guaranteed rare — every slot then
 * rolls to climb the ladder.
 */
export const PACK_BASE: Rarity[] = [
  'common',
  'common',
  'common',
  'common',
  'uncommon',
  'uncommon',
  'rare'
];

/**
 * Per-roll upgrade chance for a slot, by its 0-based depth: shallow slots
 * almost never upgrade, the deepest slots often do. A card keeps rolling one
 * tier up (at this fixed chance) until a roll fails or it reaches mythic — so
 * a lucky shallow common could still chain all the way up, just rarely.
 */
export const UPGRADE_MIN = 0.03;
export const UPGRADE_STEP = 0.017;

export function upgradeChance(depth: number): number {
  return UPGRADE_MIN + UPGRADE_STEP * depth;
}

const NEXT_TIER: Record<Rarity, Rarity | null> = {
  common: 'uncommon',
  uncommon: 'rare',
  rare: 'mythic',
  mythic: null
};

/** Climb the rarity ladder from `base`, stopping at the first failed roll. */
export function rollUpgrades(base: Rarity, depth: number, rng: Rng): Rarity {
  const p = upgradeChance(depth);
  let rarity = base;
  while (NEXT_TIER[rarity] && rng() < p) {
    rarity = NEXT_TIER[rarity] as Rarity;
  }
  return rarity;
}

export function splitByRarity(cards: Card[]): RarityPools {
  const pools: RarityPools = { common: [], uncommon: [], rare: [], mythic: [] };
  for (const card of cards) pools[card.rarity].push(card);
  return pools;
}

function pickDistinct(source: Card[], count: number, used: Set<number>, rng: Rng): Card[] {
  const available = source.filter((c) => !used.has(c.id));
  const picked: Card[] = [];
  const bag = [...available];
  const n = Math.min(count, bag.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * bag.length);
    const [card] = bag.splice(idx, 1);
    picked.push(card);
    used.add(card.id);
  }
  return picked;
}

/** Rarity fallback order when a bucket is empty — try higher tiers before dropping. */
const FALLBACK: Record<Rarity, Rarity[]> = {
  common: ['common', 'uncommon', 'rare', 'mythic'],
  uncommon: ['uncommon', 'rare', 'mythic', 'common'],
  rare: ['rare', 'mythic', 'uncommon', 'common'],
  mythic: ['mythic', 'rare', 'uncommon', 'common']
};

function drawSlot(rarity: Rarity, pools: RarityPools, used: Set<number>, rng: Rng): Card | null {
  for (const r of FALLBACK[rarity]) {
    const [card] = pickDistinct(pools[r], 1, used, rng);
    if (card) return card;
  }
  return null;
}

/**
 * Build one pack: each slot starts from its base rarity (PACK_BASE), rolls up
 * the ladder (rollUpgrades), then draws a distinct card of that rarity. The
 * last slot is a guaranteed rare that can climb to mythic. The modal pack is
 * 4 common / 2 uncommon / 1 rare. `rng` is injectable so tests are deterministic.
 */
export function generatePack(pools: RarityPools, rng: Rng = Math.random): Card[] {
  const used = new Set<number>();
  const pack: Card[] = [];

  for (let depth = 0; depth < PACK_SIZE; depth++) {
    const rarity = rollUpgrades(PACK_BASE[depth], depth, rng);
    const card = drawSlot(rarity, pools, used, rng);
    if (card) pack.push(card);
  }

  // Backfill from any pool if some buckets were too small to fill every slot.
  if (pack.length < PACK_SIZE) {
    const everything = [...pools.common, ...pools.uncommon, ...pools.rare, ...pools.mythic];
    pack.push(...pickDistinct(everything, PACK_SIZE - pack.length, used, rng));
  }

  return pack;
}

/** Mulberry32 — small seedable PRNG for tests and "daily pack" style features. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
