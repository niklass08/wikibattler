import type { Card, Rarity } from './types';

export interface RarityPools {
  common: Card[];
  uncommon: Card[];
  rare: Card[];
  mythic: Card[];
}

export const PACK_SIZE = 7;

/** Slots per pack, in reveal order. The final slot is the "chase". */
export const PACK_LAYOUT: Rarity[] = [
  'common',
  'common',
  'common',
  'common',
  'uncommon',
  'uncommon',
  'rare' // may upgrade to mythic
];

/** Probability the chase slot upgrades from rare to mythic. */
export const MYTHIC_UPGRADE_CHANCE = 1 / 8;

export type Rng = () => number;

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

/** Rarity fallback order when a bucket is empty. */
const FALLBACK: Record<Rarity, Rarity[]> = {
  common: ['common', 'uncommon', 'rare', 'mythic'],
  uncommon: ['uncommon', 'rare', 'common', 'mythic'],
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
 * Build one pack with a guaranteed rarity distribution (4 common / 2 uncommon /
 * 1 rare-or-better). "Distinct" applies within a pack; duplicates across packs
 * are expected. `rng` is injectable so tests are deterministic.
 */
export function generatePack(pools: RarityPools, rng: Rng = Math.random): Card[] {
  const used = new Set<number>();
  const pack: Card[] = [];

  for (const slot of PACK_LAYOUT.slice(0, PACK_SIZE - 1)) {
    const card = drawSlot(slot, pools, used, rng);
    if (card) pack.push(card);
  }

  const chaseRarity: Rarity =
    pools.mythic.length > 0 && rng() < MYTHIC_UPGRADE_CHANCE ? 'mythic' : 'rare';
  const chase = drawSlot(chaseRarity, pools, used, rng);
  if (chase) pack.push(chase);

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
