import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import Card from '../src/components/Card.svelte';
import CardDetail from '../src/components/CardDetail.svelte';
import RarityBadge from '../src/components/RarityBadge.svelte';
import App from '../src/App.svelte';
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
  foil: 0,
  negated: false,
  signature: null,
  tags: [],
  raw: { links: 340, bytes: 84000, monthlyViews: 500000 }
};

describe('component render (SSR)', () => {
  it('renders a Card without throwing', () => {
    const { body } = render(Card, { props: { card: sample } });
    expect(body).toContain('Antikythera mechanism');
    expect(body).toContain('rarity-mythic');
  });

  it('a field card shows DEF (not STR) plus its effect line', () => {
    // "an ancient Greek analogue computer" -> abstract -> Landmark: +round(77*0.2)
    const { body } = render(Card, { props: { card: sample } });
    expect(body).toContain('>DEF<');
    expect(body).toContain('77');
    expect(body).not.toContain('>STR<');
    expect(body).toContain('stat bt');
    expect(body).toContain('+15');
  });

  it('a fighter shows STR (not DEF) plus its attack', () => {
    const fighter = { ...sample, extract: 'He was a Greek astronomer and mathematician.', strength: 42 };
    const { body } = render(Card, { props: { card: fighter } });
    expect(body).toContain('>STR<');
    expect(body).not.toContain('>DEF<');
    expect(body).toMatch(/stat bt[\s\S]*?42/);
  });

  it('renders a face-down Card', () => {
    const { body } = render(Card, { props: { card: sample, faceDown: true } });
    expect(body).toContain('Unrevealed card');
  });

  it('does not leak the foil finish or rarity glyph on a face-down card', () => {
    const foilCard: CardT = { ...sample, foil: 3 };
    const up = render(Card, { props: { card: foilCard } }).body;
    const down = render(Card, { props: { card: foilCard, faceDown: true } }).body;
    // face-up: the foil overlay (incl. its tier-3 sparkles) and the foiled class
    expect(up).toContain('foiled');
    expect(up).toContain('sparks');
    expect(up).toContain('data-foil="3"');
    // face-down: nothing — the pull can't be told before the reveal
    expect(down).not.toContain('foiled');
    expect(down).not.toContain('sparks');
    expect(down).not.toContain('data-foil');
    // the corner rarity glyph is likewise face-up only
    expect(up).toContain('glyph');
    expect(down).not.toContain('glyph');
  });

  it('shows no foil layers on a plain (foil 0) card', () => {
    const { body } = render(Card, { props: { card: { ...sample, foil: 0 } } });
    expect(body).not.toContain('foiled');
    expect(body).not.toContain('class="foil');
  });

  it('CardDetail names the team stat behind the card-face number', () => {
    const fighter: CardT = { ...sample, extract: 'He was a Greek astronomer.', strength: 42, defence: 60 };
    const { body } = render(CardDetail, { props: { card: fighter, onclose: () => {} } });
    expect(body).toContain('Team Attack');
    expect(body).toContain('+42'); // Strength → Team Attack
    expect(body).toContain('Team HP');
    expect(body).toContain('+60'); // Defence → Team HP
    expect(body).toContain('from its Defence');
  });

  it('renders every rarity badge', () => {
    for (const rarity of ['common', 'uncommon', 'rare', 'mythic'] as const) {
      const { body } = render(RarityBadge, { props: { rarity } });
      expect(body).toContain(`rarity-${rarity}`);
    }
  });
});

describe('app shell', () => {
  it('renders <App> with no pool and no network', () => {
    const { body } = render(App);
    expect(body).toContain('Open a pack');
    expect(body).toContain('drawn live from Wikipedia');
  });

  // The nav row is ~780px wide with every item showing; before the burger it
  // pushed the page 405px past a 360px viewport and the whole app scrolled
  // sideways. Keep the collapse mechanism wired up.
  it('the nav ships a burger toggle wired to the menu', () => {
    const { body } = render(App);
    expect(body).toContain('class="burger');
    expect(body).toContain('aria-controls="nav-menu"');
    expect(body).toContain('id="nav-menu"');
    expect(body).toContain('aria-expanded="false"');
  });
});
