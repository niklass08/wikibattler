import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Card from '../src/components/Card.svelte';
import type { Card as CardT } from '../src/lib/types';

const base: CardT = {
  id: 1,
  title: 'Test',
  url: '',
  extract: '',
  image: null,
  rarity: 'common',
  strength: 10,
  defence: 10,
  foil: 0,
  negated: false,
  signature: null,
  tags: [],
  raw: { links: 0, bytes: 0, monthlyViews: 0 }
};

describe('foil tiers render the right layers', () => {
  const layers = (foil: 1 | 2 | 3) => render(Card, { props: { card: { ...base, foil } } }).body;

  it('tier 1 = spin + sheen only', () => {
    const b = layers(1);
    expect(b).toContain('class="spin');
    expect(b).toContain('class="sheen');
    expect(b).not.toContain('class="holo');
    expect(b).not.toContain('class="sparks');
  });

  it('tier 2 adds holo + sweep, no sparks', () => {
    const b = layers(2);
    expect(b).toContain('class="holo');
    expect(b).toContain('class="sweep');
    expect(b).not.toContain('class="rainbow');
    expect(b).not.toContain('class="sparks');
  });

  it('tier 3 adds rainbow + sparks', () => {
    const b = layers(3);
    expect(b).toContain('class="holo');
    expect(b).toContain('class="rainbow');
    expect(b).toContain('class="sparks');
    expect((b.match(/--sx:/g) ?? []).length).toBe(8);
  });

  it('negated adds the negated class, face-up only, and stacks with foil', () => {
    const up = render(Card, { props: { card: { ...base, negated: true } } }).body;
    expect(up).toContain('negated');

    const down = render(Card, { props: { card: { ...base, negated: true }, faceDown: true } }).body;
    expect(down).not.toContain('negated');

    // independent of foil — a card can be both
    const both = render(Card, { props: { card: { ...base, foil: 2, negated: true } } }).body;
    expect(both).toContain('negated');
    expect(both).toContain('foiled');
  });
});
