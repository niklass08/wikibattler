import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import type { Card, Rarity } from '../src/lib/types';
import { classifyCard } from '../src/lib/battle/classify';
import { assembleTeam, simulate, type TeamStats } from '../src/lib/battle/engine';
import { GOLDFISH } from '../src/lib/battle/opponents';
import { battleTeam } from '../src/lib/battle/team';
import { effectFor, effectIdFor, resolveEffect, sumMods } from '../src/lib/battle/effects';
import { EFFECTS, TAG_EFFECT } from '../src/lib/battle/effects.config';
import { cardBattleStat, battleBreakdown } from '../src/lib/battle/cardStat';
import { TAGS } from '../src/lib/tags';

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
  it('the goldfish soaks several rounds against a normal team', () => {
    const r = simulate(stats({ maxHp: 9000, attack: 1000 }), GOLDFISH); // 6000 / 1000 -> 6 rounds
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(6);
    expect(r.damageDealt).toBe(6000);
    expect(r.damageTaken).toBe(45 * 5); // it answers on rounds 1..5 only
    expect(r.rounds.at(-1)?.playerHp).toBe(9000 - 225);
  });

  it('a huge team still needs a couple of rounds', () => {
    const r = simulate(stats({ maxHp: 9000, attack: 3500 }), GOLDFISH);
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(2);
  });

  it('a team with no fighters cannot win and eventually falls', () => {
    const r = simulate(stats({ maxHp: 200, attack: 0 }), GOLDFISH);
    expect(r.outcome).toBe('loss');
    expect(r.damageDealt).toBe(0);
  });

  it('the last round carries a result line', () => {
    const r = simulate(stats({ maxHp: 9000, attack: 3500 }), GOLDFISH);
    expect(r.rounds.at(-1)?.lines.at(-1)?.kind).toBe('result');
  });
});

describe('environmental effects config', () => {
  it('maps every tag to a defined effect', () => {
    for (const tag of TAGS) {
      expect(TAG_EFFECT[tag], tag).toBeDefined();
      expect(EFFECTS[TAG_EFFECT[tag]], `${tag} -> ${TAG_EFFECT[tag]}`).toBeDefined();
    }
  });

  it('every effect carries a name, an icon and at least one contribution', () => {
    for (const [id, def] of Object.entries(EFFECTS)) {
      expect(def.name, id).toBeTruthy();
      expect(def.icon, id).toBeTruthy();
      expect(def.contributions.length, id).toBeGreaterThan(0);
    }
  });

  it("picks the effect from the card's strongest mapped tag", () => {
    expect(effectIdFor(card({ tags: ['war', 'history'] }))).toBe('arsenal');
    expect(effectIdFor(card({ tags: ['geography'] }))).toBe('terrain');
    expect(effectIdFor(card({ tags: [] }))).toBe('landmark'); // DEFAULT_EFFECT
  });

  it('evaluates a contribution: base + perStrength·STR + perDefence·DEF', () => {
    // spectacle = atkPct: base 0.04 + strength/4000
    const e = resolveEffect('spectacle', card({ strength: 400 }));
    expect(e.mods.atkPct).toBeCloseTo(0.04 + 400 / 4000);
    expect(e.name).toBe('Spectacle');
    expect(e.icon).toBe('🎬');
    expect(e.detail).toBe('+14% team attack');
  });

  it('rounds and floors the flat stats (regen min 1)', () => {
    // sponsorship = regen: perDefence 0.03, min 1
    expect(resolveEffect('sponsorship', card({ defence: 1000 })).mods.regen).toBe(30);
    expect(resolveEffect('sponsorship', card({ defence: 5 })).mods.regen).toBe(1);
  });

  it('caps a single contribution and the team-wide reflect total', () => {
    // countermeasures reflect maxes at 0.4 per card…
    expect(resolveEffect('countermeasures', card({ strength: 9999 })).mods.reflect).toBe(0.4);
    // …and the team total is capped at 0.75
    const many = Array.from({ length: 5 }, () =>
      resolveEffect('countermeasures', card({ strength: 9999 }))
    );
    expect(sumMods(many).reflect).toBe(0.75);
  });

  it('a multi-contribution effect sums into one line', () => {
    const e = effectFor(card({ tags: ['music'], strength: 0, defence: 400 }));
    expect(e.name).toBe('Anthem');
    expect(e.mods.regen).toBe(12);
    expect(e.detail).toContain('heal 12/round');
    expect(e.headline).toBe('+3%'); // lead contribution: atkPct base 0.03, strength 0
  });
});

describe('cardBattleStat (the card-face line)', () => {
  it('a fighter shows its attack contribution', () => {
    const s = cardBattleStat(card({ strength: 480, extract: 'She is a professional footballer.' }));
    expect(s.value).toBe('480');
    expect(s.label).toBe('Fighter');
  });

  it('a field card shows its lead effect and magnitude', () => {
    const s = cardBattleStat(card({ tags: ['war'], strength: 600, extract: 'World War I was a global conflict.' }));
    expect(s.label).toBe('Arsenal'); // war -> arsenal, atkFlat = round(600 * 0.3)
    expect(s.value).toBe('+180');
    expect(s.icon).toBe('🗡️');
  });
});

describe('battleBreakdown (the card-detail panel)', () => {
  it('a fighter boosts HP pool (Defence) and Attack (Strength)', () => {
    const b = battleBreakdown(card({ strength: 640, defence: 410, extract: 'He is a footballer.' }));
    expect(b.role).toBe('Fighter');
    expect(b.boosts).toEqual([
      { stat: 'HP pool', icon: '❤️', amount: '+410', source: 'Defence' },
      { stat: 'Attack', icon: '⚔️', amount: '+640', source: 'Fighter' }
    ]);
  });

  it('a field card boosts HP pool (Defence) plus whatever its effect grants', () => {
    const b = battleBreakdown(
      card({ tags: ['war'], strength: 600, defence: 800, extract: 'The war was a conflict.' })
    );
    expect(b.role).toBe('Field');
    expect(b.effect).toBe('Arsenal');
    expect(b.boosts).toEqual([
      { stat: 'HP pool', icon: '❤️', amount: '+800', source: 'Defence' },
      { stat: 'Attack', icon: '⚔️', amount: '+180', source: 'Arsenal' }
    ]);
  });

  it('groups a multi-effect field card by team stat, HP → Attack → Regen → Reflect', () => {
    const b = battleBreakdown(
      card({ tags: ['music'], strength: 0, defence: 400, extract: 'A song.' })
    );
    expect(b.boosts.map((x) => x.stat)).toEqual(['HP pool', 'Attack', 'Regen']);
    expect(b.boosts.at(-1)).toEqual({
      stat: 'Regen',
      icon: '♻️',
      amount: '+12/round',
      source: 'Anthem'
    });
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
