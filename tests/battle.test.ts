import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import type { Card, Rarity } from '../src/lib/types';
import { classifyCard } from '../src/lib/battle/classify';
import { assembleTeam, simulate, type TeamStats } from '../src/lib/battle/engine';
import { GOLDFISH } from '../src/lib/battle/opponents';
import { battleTeam } from '../src/lib/battle/team';

function card(over: Partial<Card> = {}): Card {
  return {
    id: 1,
    title: 'X',
    url: '',
    extract: '',
    image: null,
    rarity: 'common' as Rarity,
    strength: 100,
    defence: 100,
    foil: 0,
    negated: false,
    tags: [],
    raw: { links: 0, bytes: 0, monthlyViews: 0 },
    ...over
  };
}

const stats = (over: Partial<TeamStats>): TeamStats => ({
  members: [],
  maxHp: 100,
  attack: 0,
  regen: 0,
  reflect: 0,
  mods: { hpFlat: 0, hpPct: 0, atkFlat: 0, atkPct: 0, regen: 0, reflect: 0 },
  livingCount: 0,
  abstractCount: 0,
  ...over
});

describe('classifyCard', () => {
  it('reads a person as living', () => {
    expect(
      classifyCard(card({ extract: 'Lionel Messi (born 24 June 1987) is an Argentine footballer.' }))
    ).toBe('living');
    expect(
      classifyCard(card({ extract: 'Ada Lovelace was an English mathematician and writer.' }))
    ).toBe('living');
  });

  it('reads an organism as living', () => {
    expect(classifyCard(card({ extract: 'The blue whale is a marine mammal.' }))).toBe('living');
    expect(
      classifyCard(card({ extract: 'The red fox is a species of the family Canidae.' }))
    ).toBe('living');
  });

  it('reads a work / place / concept as abstract', () => {
    expect(
      classifyCard(card({ extract: 'Inception is a 2010 science fiction film.', tags: ['cinema'] }))
    ).toBe('abstract');
    expect(
      classifyCard(card({ extract: 'France is a country in Western Europe.', tags: ['geography'] }))
    ).toBe('abstract');
  });

  it('falls back to the nature tag when the prose is silent', () => {
    expect(classifyCard(card({ extract: '', tags: ['nature'] }))).toBe('living');
  });
});

describe('assembleTeam', () => {
  const team = () =>
    assembleTeam([
      card({ id: 1, strength: 300, defence: 200, extract: 'She is a professional tennis player.' }),
      card({ id: 2, strength: 100, defence: 150, extract: 'It is a species of small owl.' }),
      card({ id: 3, strength: 50, defence: 500, tags: ['history'], extract: 'The Cold War was a period of tension.' })
    ]);

  it('HP is the sum of every card defence (plus field flat bonus)', () => {
    // history → "Legacy": +round(500 * 0.2) = +100 flat HP
    expect(team().maxHp).toBe(200 + 150 + 500 + 100);
  });

  it('attack counts strength from living cards only', () => {
    expect(team().attack).toBe(300 + 100);
  });

  it('counts the roles', () => {
    const t = team();
    expect(t.livingCount).toBe(2);
    expect(t.abstractCount).toBe(1);
    expect(t.members.find((m) => m.card.id === 3)?.effect?.name).toBe('Legacy');
  });
});

describe('simulate vs the Goldfish', () => {
  it('one big swing ends it in a round', () => {
    const r = simulate(stats({ maxHp: 900, attack: 400 }), GOLDFISH);
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(1);
    expect(r.damageDealt).toBe(400);
    expect(r.damageTaken).toBe(0);
  });

  it('a slow team still wins, taking a flop each round until then', () => {
    const r = simulate(stats({ maxHp: 500, attack: 30 }), GOLDFISH); // 250 / 30 -> 9 rounds
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(9);
    expect(r.damageTaken).toBe(12 * 8); // the goldfish answers on rounds 1..8 only
    expect(r.rounds.at(-1)?.playerHp).toBe(500 - 96);
  });

  it('a team with no fighters cannot win and eventually falls', () => {
    const r = simulate(stats({ maxHp: 40, attack: 0 }), GOLDFISH);
    expect(r.outcome).toBe('loss');
    expect(r.damageDealt).toBe(0);
  });

  it('the last round carries a result line', () => {
    const r = simulate(stats({ maxHp: 900, attack: 400 }), GOLDFISH);
    expect(r.rounds.at(-1)?.lines.at(-1)?.kind).toBe('result');
  });
});

describe('battleTeam store', () => {
  it('toggles cards in and out and caps at seven', () => {
    battleTeam.clear();
    for (let i = 1; i <= 9; i++) battleTeam.toggle(i);
    expect(get(battleTeam)).toHaveLength(7);
    expect(get(battleTeam)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    battleTeam.toggle(3); // remove
    expect(get(battleTeam)).toEqual([1, 2, 4, 5, 6, 7]);
    battleTeam.toggle(8); // now there is room
    expect(get(battleTeam)).toEqual([1, 2, 4, 5, 6, 7, 8]);
    battleTeam.clear();
  });
});
