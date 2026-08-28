import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Card from '../src/components/Card.svelte';
import RarityBadge from '../src/components/RarityBadge.svelte';
import App from '../src/App.svelte';
import { loadPools, totalCards, rarityPools } from '../src/lib/pools';
import { generatePack } from '../src/lib/pack';
import type { Card as CardT } from '../src/lib/types';

const sample: CardT = {
  id: 1,
  title: 'Antikythera mechanism',
  url: 'https://en.wikipedia.org/wiki/Antikythera_mechanism',
  extract: 'An ancient Greek analogue computer.',
  image: null,
  rarity: 'mythic',
  strength: 58,
  defence: 77,
  raw: { links: 340, bytes: 84000, monthlyViews: 500000 }
};

describe('component render (SSR)', () => {
  it('renders a Card without throwing and shows its stats', () => {
    const { body } = render(Card, { props: { card: sample } });
    expect(body).toContain('Antikythera mechanism');
    expect(body).toContain('58');
    expect(body).toContain('77');
    expect(body).toContain('rarity-mythic');
  });

  it('renders a face-down Card', () => {
    const { body } = render(Card, { props: { card: sample, faceDown: true } });
    expect(body).toContain('Unrevealed card');
  });

  it('renders every rarity badge', () => {
    for (const rarity of ['common', 'uncommon', 'rare', 'mythic'] as const) {
      const { body } = render(RarityBadge, { props: { rarity } });
      expect(body).toContain(`rarity-${rarity}`);
    }
  });
});

describe('app with the real pool', () => {
  it('loads a non-trivial pool with all four rarities populated', async () => {
    await loadPools();
    expect(totalCards).toBeGreaterThan(200);
    for (const r of ['common', 'uncommon', 'rare', 'mythic'] as const) {
      expect(rarityPools[r].length).toBeGreaterThan(0);
    }
  });

  it('renders <App> without throwing', async () => {
    await loadPools();
    const { body } = render(App);
    expect(body).toContain('Open a pack');
    expect(body).toContain('/1800'); // collection count reflects the loaded pool
  });

  it('generates a valid pack from the real pool', async () => {
    await loadPools();
    const pack = generatePack(rarityPools);
    expect(pack).toHaveLength(7);
    expect(new Set(pack.map((c) => c.id)).size).toBe(7);
  });
});
