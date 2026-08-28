import type { Card, PoolsFile, Rarity } from './types';
import { splitByRarity, type RarityPools } from './pack';

/**
 * The generated card pool. It is code-split into its own chunk and loaded once,
 * before the app mounts (see main.ts), so these exports are synchronous for every
 * component. Falls back to the small sample fixture when the full pools.json has
 * not been generated yet (see scripts/build-pools.ts).
 */
export let poolsFile: PoolsFile = emptyPools();
export let allCards: Card[] = [];
export let cardById: Map<number, Card> = new Map();
export let rarityPools: RarityPools = splitByRarity([]);
export let totalsByRarity: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
export let totalCards = 0;
export let usingSample = false;

function emptyPools(): PoolsFile {
  return {
    generatedAt: '',
    project: 'en.wikipedia',
    thresholds: { uncommon: 10000, rare: 150000, mythic: 400000 },
    cards: []
  };
}

export async function loadPools(): Promise<void> {
  const full = (await import('../data/pools.json')).default as PoolsFile;
  usingSample = full.cards.length === 0;
  const source = usingSample
    ? ((await import('../data/pools.sample.json')).default as PoolsFile)
    : full;

  poolsFile = source;
  allCards = source.cards;
  cardById = new Map(allCards.map((c) => [c.id, c]));
  rarityPools = splitByRarity(allCards);
  totalsByRarity = {
    common: rarityPools.common.length,
    uncommon: rarityPools.uncommon.length,
    rare: rarityPools.rare.length,
    mythic: rarityPools.mythic.length
  };
  totalCards = allCards.length;
}
