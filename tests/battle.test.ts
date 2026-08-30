import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import type { Card, Rarity } from '../src/lib/types';
import { classifyCard } from '../src/lib/battle/classify';
import { assembleTeam, simulateVsDummy, type TeamStats } from '../src/lib/battle/engine';
import { GOLDFISH } from '../src/lib/battle/opponents';
import { battleTeam } from '../src/lib/battle/team';
import { applyMythicSignatures, rollSignature } from '../src/lib/signature';
import { seededRng } from '../src/lib/pack';
import {
  effectFor,
  effectIdFor,
  resolveEffect,
  sumMods,
  roundEffectFor,
  planRounds
} from '../src/lib/battle/effects';
import { EFFECTS, TAG_EFFECT, ROUND_EFFECTS } from '../src/lib/battle/effects.config';
import {
  cardBattleStat,
  battleBreakdown,
  showsStrength,
  showsDefence
} from '../src/lib/battle/cardStat';
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
    signature: null,
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
  roundPlan: { effects: [], dotStart: 0, dotRamp: 0, atkRampPct: 0, blooms: [], overdrives: [] },
  signatures: [],
  hooks: {
    enemyAtkMult: 1,
    negateEnemyHits: 0,
    blitzRounds: 0,
    comboEvery: 0,
    comboBonus: 0,
    apexAtkPct: 0,
    longGamePer4: 0,
    bloomHealFrac: 0
  },
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
    const r = simulateVsDummy(stats({ maxHp: 9000, attack: 1000 }), GOLDFISH); // 6000 / 1000 -> 6 rounds
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(6);
    expect(r.damageDealt).toBe(6000);
    expect(r.damageTaken).toBe(45 * 5); // it answers on rounds 1..5 only
    expect(r.rounds.at(-1)?.playerHp).toBe(9000 - 225);
  });

  it('a huge team still needs a couple of rounds', () => {
    const r = simulateVsDummy(stats({ maxHp: 9000, attack: 3500 }), GOLDFISH);
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(2);
  });

  it('a team with no fighters cannot win and eventually falls', () => {
    const r = simulateVsDummy(stats({ maxHp: 200, attack: 0 }), GOLDFISH);
    expect(r.outcome).toBe('loss');
    expect(r.damageDealt).toBe(0);
  });

  it('the last round carries a result line', () => {
    const r = simulateVsDummy(stats({ maxHp: 9000, attack: 3500 }), GOLDFISH);
    expect(r.rounds.at(-1)?.lines.at(-1)?.kind).toBe('result');
  });
});

describe('round effects', () => {
  const plan = (over: Partial<ReturnType<typeof planRounds>>) => ({
    effects: [],
    dotStart: 0,
    dotRamp: 0,
    atkRampPct: 0,
    blooms: [] as { delay: number; damage: number }[],
    overdrives: [] as number[],
    ...over
  });

  it('resolves each new theme to the right scheduled behaviour', () => {
    expect(roundEffectFor(card({ tags: ['disease'], strength: 500 }))?.kind).toBe('dot');
    expect(roundEffectFor(card({ tags: ['scientists'], strength: 500 }))?.kind).toBe('ramp');
    expect(roundEffectFor(card({ tags: ['plants'], strength: 500 }))?.kind).toBe('bloom');
    expect(roundEffectFor(card({ tags: ['vehicles'], strength: 500 }))?.kind).toBe('overdrive');
    expect(roundEffectFor(card({ tags: ['war'] }))).toBeNull();
  });

  it('disease stacks its damage up round after round', () => {
    // dotStart 20, dotRamp 20 -> rounds deal 20, 40, 60, 80, 100 ... to a 300 hp dummy
    const r = simulateVsDummy(stats({ maxHp: 5000, attack: 0, roundPlan: plan({ dotStart: 20, dotRamp: 20 }) }), {
      id: 'x', name: 'Dummy', blurb: '', maxHp: 300, attack: 0
    });
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(5); // 20+40+60+80+100 = 300
    expect(r.damageDealt).toBe(300);
  });

  it('scientists ramp the team attack every round', () => {
    // base 100, +50%/round -> r1 150, r2 200, r3 250 (cumulative 600) vs 550 hp
    const r = simulateVsDummy(
      stats({ maxHp: 9000, attack: 100, roundPlan: plan({ atkRampPct: 0.5 }) }),
      { id: 'x', name: 'Dummy', blurb: '', maxHp: 550, attack: 0 }
    );
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(3);
  });

  it('a plant blooms only on its schedule', () => {
    const r = simulateVsDummy(
      stats({ maxHp: 9000, attack: 0, roundPlan: plan({ blooms: [{ delay: 3, damage: 200 }] }) }),
      { id: 'x', name: 'Dummy', blurb: '', maxHp: 350, attack: 0 }
    );
    // no damage rounds 1-2, 200 on round 3, 200 on round 6 -> dead round 6
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(6);
  });

  it('a charged vehicle grants an extra swing on its schedule', () => {
    const r = simulateVsDummy(
      stats({ maxHp: 9000, attack: 100, roundPlan: plan({ overdrives: [2] }) }),
      { id: 'x', name: 'Dummy', blurb: '', maxHp: 500, attack: 0 }
    );
    // r1: 100, r2: 100 + 100 overdrive = 300, r3: 100, r4: 300 -> 100+300+100+300=800; dead round 4
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(4);
    expect(r.rounds[1].lines.some((l) => l.text.includes('Overdrive'))).toBe(true);
  });

  it('assembleTeam collects round effects across roles', () => {
    const t = assembleTeam([
      card({ id: 1, tags: ['disease'], strength: 400, extract: 'The plague was an epidemic.' }),
      card({ id: 2, tags: ['scientists'], strength: 600, extract: 'She is a physicist.' })
    ]);
    expect(t.roundPlan.dotStart).toBeGreaterThan(0);
    expect(t.roundPlan.atkRampPct).toBeGreaterThan(0);
    expect(t.roundPlan.effects).toHaveLength(2);
  });
});

describe('environmental effects config', () => {
  it('every tag has either a static field effect or a round effect', () => {
    for (const tag of TAGS) {
      const staticId = TAG_EFFECT[tag];
      const hasStatic = staticId !== undefined && EFFECTS[staticId] !== undefined;
      const hasRound = ROUND_EFFECTS[tag as keyof typeof ROUND_EFFECTS] !== undefined;
      expect(hasStatic || hasRound, `${tag} has no effect`).toBe(true);
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
  it('a fighter shows STR only, a field card DEF only', () => {
    const fighter = card({ extract: 'She is a professional footballer.' });
    const field = card({ tags: ['cinema'], extract: 'Jaws is a 1975 film.' });
    expect(showsStrength(fighter)).toBe(true);
    expect(showsDefence(fighter)).toBe(false);
    expect(showsStrength(field)).toBe(false);
    expect(showsDefence(field)).toBe(true);
  });

  it('a fighter shows its attack contribution', () => {
    const s = cardBattleStat(card({ strength: 480, extract: 'She is a professional footballer.' }));
    expect(s.fighter).toBe(true);
    expect(s.value).toBe('480');
    expect(s.label).toBe('Fighter');
  });

  it('a field card shows its lead effect and magnitude', () => {
    const s = cardBattleStat(card({ tags: ['war'], strength: 600, extract: 'World War I was a global conflict.' }));
    expect(s.fighter).toBe(false);
    expect(s.label).toBe('Arsenal'); // war -> arsenal, atkFlat = round(600 * 0.3)
    expect(s.value).toBe('+180');
    expect(s.icon).toBe('🗡️');
  });
});

describe('battleBreakdown (the card-detail panel)', () => {
  it('names the stat a bare "+192" would move — a fighter raises Team Attack', () => {
    const b = battleBreakdown(card({ strength: 640, defence: 410, extract: 'He is a footballer.' }));
    expect(b.role).toBe('Fighter');
    expect(b.title).toBe('Fighter');
    expect(b.boosts).toEqual([{ stat: 'Team Attack', amount: '+640' }]);
    expect(b.hpFromDefence).toBe(410);
  });

  it('names the stat for a field effect — Arsenal raises Team Attack', () => {
    const b = battleBreakdown(
      card({ tags: ['war'], strength: 600, defence: 800, extract: 'The war was a conflict.' })
    );
    expect(b.role).toBe('Field');
    expect(b.title).toBe('Arsenal');
    expect(b.boosts).toEqual([{ stat: 'Team Attack', amount: '+180' }]);
    expect(b.hpFromDefence).toBe(800);
  });

  it('one row per contribution, each naming its stat', () => {
    const b = battleBreakdown(card({ tags: ['music'], strength: 0, defence: 400, extract: 'A song.' }));
    expect(b.boosts).toEqual([
      { stat: 'Team Attack', amount: '+3%' },
      { stat: 'Regen', amount: '+12/round' }
    ]);
  });

  it('a percentage effect reads as Team HP', () => {
    const b = battleBreakdown(
      card({ tags: ['geography'], defence: 800, extract: 'France is a country.' })
    );
    expect(b.boosts).toEqual([{ stat: 'Team HP', amount: '+25%' }]);
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

describe('mythic signatures', () => {
  it('only rolls a signature onto an un-signed mythic', () => {
    const out = applyMythicSignatures(
      [
        card({ id: 1, rarity: 'mythic', tags: ['cinema'] }),
        card({ id: 2, rarity: 'rare', tags: ['cinema'] }),
        card({ id: 3, rarity: 'mythic', signature: 'war', tags: ['cinema'] })
      ],
      seededRng(1)
    );
    expect(out[0].signature).not.toBeNull(); // rolled
    expect(out[1].signature).toBeNull(); // not a mythic
    expect(out[2].signature).toBe('war'); // already had one, kept
  });

  it('the roll leans toward the card\'s own themes', () => {
    const c = card({ rarity: 'mythic', tags: ['disease'] });
    let own = 0;
    for (let s = 0; s < 400; s++) if (rollSignature(c, seededRng(s)) === 'disease') own++;
    // ~50% lean + ~1/17 of the random half ≈ 53%
    expect(own / 400).toBeGreaterThan(0.4);
    expect(own / 400).toBeLessThan(0.7);
  });

  it('Franchise scales team attack with the cinema count', () => {
    const base = assembleTeam([
      card({ id: 1, strength: 500, extract: 'He is a film director.', tags: ['cinema'] }),
      card({ id: 2, strength: 300, extract: 'She is an actress.', tags: ['cinema'] })
    ]);
    const withSig = assembleTeam([
      card({ id: 1, strength: 500, rarity: 'mythic', signature: 'cinema', extract: 'He is a film director.', tags: ['cinema'] }),
      card({ id: 2, strength: 300, extract: 'She is an actress.', tags: ['cinema'] })
    ]);
    // N = 2 cinema cards → +10% attack
    expect(withSig.signatures[0]?.name).toBe('Franchise');
    expect(withSig.attack).toBe(Math.round(base.attack * 1.1));
  });

  it('Divine Shield negates the first enemy hit', () => {
    const t = stats({ maxHp: 100, attack: 5000, hooks: { ...stats({}).hooks, negateEnemyHits: 1 } });
    const r = simulateVsDummy(t, { id: 'x', name: 'Ogre', blurb: '', maxHp: 20000, attack: 60 });
    // r1: team hits 5000, ogre answers but the shield eats it → 0 taken that round
    expect(r.rounds[0].lines.some((l) => l.text.includes('Divine Shield'))).toBe(true);
    expect(r.rounds[0].playerHp).toBe(100);
  });

  it('Blitzkrieg adds a second team strike on the opening rounds', () => {
    const t = stats({ maxHp: 9000, attack: 100, hooks: { ...stats({}).hooks, blitzRounds: 2 } });
    const r = simulateVsDummy(t, { id: 'x', name: 'Dummy', blurb: '', maxHp: 900, attack: 0 });
    expect(r.rounds[0].lines.filter((l) => l.text.includes('for 100')).length).toBe(2);
  });
});
