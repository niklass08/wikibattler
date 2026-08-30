import { describe, it, expect } from 'vitest';
import { simulate, ROUND_CAP, type TeamStats } from '../src/lib/battle/engine';

const stats = (over: Partial<TeamStats>): TeamStats => ({
  members: [],
  maxHp: 1000,
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

const hooks = (over: Partial<TeamStats['hooks']>) => ({ ...stats({}).hooks, ...over });
const plan = (over: Partial<TeamStats['roundPlan']>) => ({ ...stats({}).roundPlan, ...over });

describe('symmetric simulate', () => {
  it('is deterministic — same inputs, byte-identical result', () => {
    const a = stats({ maxHp: 900, attack: 120 });
    const b = stats({ maxHp: 850, attack: 110, reflect: 0.2 });
    expect(simulate(a, b)).toEqual(simulate(a, b));
  });

  it('gives the attacker (A) first strike — a lethal A swing ends it before B answers', () => {
    const r = simulate(stats({ maxHp: 100, attack: 5000 }), stats({ maxHp: 4000, attack: 9999 }));
    expect(r.outcome).toBe('win');
    expect(r.rounds).toHaveLength(1);
    expect(r.rounds[0].lines.some((l) => l.kind === 'enemy')).toBe(false); // B never swung
    expect(r.damageTaken).toBe(0);
  });

  it('two identical teams — the first mover wins, and it is not the inverse of the swap', () => {
    const t = () => stats({ maxHp: 1000, attack: 260 });
    const ab = simulate(t(), t());
    const ba = simulate(t(), t());
    expect(ab.outcome).toBe('win');
    expect(ba.outcome).toBe('win'); // whoever is passed first
  });

  it("the defender's enemyAtkMult weakens the attacker's swings", () => {
    const full = simulate(stats({ maxHp: 9000, attack: 100 }), stats({ maxHp: 250, attack: 0 }));
    const dampened = simulate(
      stats({ maxHp: 9000, attack: 100 }),
      stats({ maxHp: 250, attack: 0, hooks: hooks({ enemyAtkMult: 0.5 }) })
    );
    // 100/round kills 250 in 3 rounds; 50/round needs 5
    expect(full.rounds).toHaveLength(3);
    expect(dampened.rounds).toHaveLength(5);
  });

  it('reflect versus reflect still terminates', () => {
    const r = simulate(
      stats({ maxHp: 5000, attack: 300, reflect: 0.5 }),
      stats({ maxHp: 5000, attack: 300, reflect: 0.5 })
    );
    expect(['win', 'loss', 'draw']).toContain(r.outcome);
    expect(r.rounds.length).toBeLessThanOrEqual(ROUND_CAP);
  });

  it('a mutual disease race — the heavier contagion wins', () => {
    const r = simulate(
      stats({ maxHp: 4000, attack: 0, roundPlan: plan({ dotStart: 200, dotRamp: 0 }) }),
      stats({ maxHp: 4000, attack: 0, roundPlan: plan({ dotStart: 100, dotRamp: 0 }) })
    );
    expect(r.outcome).toBe('win');
  });

  it('divine shields are tracked per side', () => {
    const r = simulate(
      stats({ maxHp: 300, attack: 200, hooks: hooks({ negateEnemyHits: 1 }) }),
      stats({ maxHp: 5000, attack: 90, hooks: hooks({ negateEnemyHits: 1 }) })
    );
    // A's shield eats B's first hit; B's shield eats A's first swing
    const shieldLines = r.rounds.flatMap((rd) => rd.lines).filter((l) => l.text.includes('Divine Shield'));
    expect(shieldLines.length).toBe(2);
  });

  it('two pure-field teams grind to the round cap', () => {
    const r = simulate(stats({ maxHp: 500, attack: 0 }), stats({ maxHp: 500, attack: 0 }));
    expect(r.outcome).toBe('draw');
    expect(r.rounds).toHaveLength(ROUND_CAP);
    expect(r.rounds.at(-1)?.lines.some((l) => l.text === 'The round cap runs out.')).toBe(true);
    expect(r.rounds.at(-1)?.lines.at(-1)?.kind).toBe('result');
  });

  it('labels name side B in the result and swing lines', () => {
    const r = simulate(stats({ maxHp: 100, attack: 9000 }), stats({ maxHp: 200, attack: 0 }), {
      bName: 'Ada#3f7c'
    });
    expect(r.rounds.at(-1)?.lines.at(-1)?.text).toContain('Ada#3f7c');
  });
});
