import { describe, it, expect } from 'vitest';
import { simulate, simulateVsDummy, type TeamStats } from '../src/lib/battle/engine';
import { GOLDFISH } from '../src/lib/battle/opponents';
import { toTimeline } from '../src/lib/battle/playback';

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
const hooks = (o: Partial<TeamStats['hooks']>) => ({ ...stats({}).hooks, ...o });
const plan = (o: Partial<TeamStats['roundPlan']>) => ({ ...stats({}).roundPlan, ...o });

describe('toTimeline', () => {
  it('attributes a plain trade correctly', () => {
    const r = simulateVsDummy(stats({ maxHp: 9000, attack: 1000 }), GOLDFISH);
    const tl = toTimeline(r, { aMaxHp: 9000, bMaxHp: 6000, bName: 'Goldfish' });
    expect(tl.rounds).toHaveLength(6);

    const r1 = tl.rounds[0];
    const mySwing = r1.beats.find((b) => b.kind === 'swing' && b.by === 'a');
    expect(mySwing).toMatchObject({ at: 'b', amount: 1000 });
    const theirSwing = r1.beats.find((b) => b.kind === 'swing' && b.by === 'b');
    expect(theirSwing).toMatchObject({ at: 'a', amount: 45 });

    expect(r1.aDealt).toBe(1000);
    expect(r1.bDealt).toBe(45);
    expect(r1.aStart).toBe(9000);
    expect(r1.bEnd).toBe(5000);
  });

  it('hp carries across rounds and ends at zero on a win', () => {
    const r = simulateVsDummy(stats({ maxHp: 9000, attack: 1000 }), GOLDFISH);
    const tl = toTimeline(r, { aMaxHp: 9000, bMaxHp: 6000, bName: 'Goldfish' });
    expect(tl.rounds.at(-1)?.bEnd).toBe(0);
    expect(tl.rounds[1].bStart).toBe(tl.rounds[0].bEnd);
    expect(tl.outcome).toBe('win');
  });

  it('flags the distinctive effects that fired', () => {
    const r = simulateVsDummy(
      stats({
        maxHp: 9000,
        attack: 60,
        roundPlan: plan({ dotStart: 30, dotRamp: 10, blooms: [{ delay: 2, damage: 200 }], overdrives: [2] })
      }),
      { id: 'x', name: 'Dummy', blurb: '', maxHp: 4000, attack: 10 }
    );
    const tl = toTimeline(r, { aMaxHp: 9000, bMaxHp: 4000, bName: 'Dummy' });
    const allFx = new Set(tl.rounds.flatMap((rd) => rd.fx));
    expect(allFx.has('dot')).toBe(true);
    expect(allFx.has('bloom')).toBe(true);
    expect(allFx.has('overdrive')).toBe(true);
  });

  it('reads reflect as the opponent bouncing damage back at the attacker', () => {
    const r = simulateVsDummy(stats({ maxHp: 9000, attack: 100, reflect: 0.5 }), GOLDFISH);
    const tl = toTimeline(r, { aMaxHp: 9000, bMaxHp: 6000, bName: 'Goldfish' });
    const reflect = tl.rounds.flatMap((rd) => rd.beats).find((b) => b.kind === 'reflect');
    expect(reflect).toBeTruthy();
    expect(reflect).toMatchObject({ by: 'a', at: 'b' }); // A reflects → B (the attacker) takes it
  });

  it('handles a symmetric PvP fight with a handle name', () => {
    const a = stats({ maxHp: 1200, attack: 300, hooks: hooks({ blitzRounds: 2 }) });
    const b = stats({ maxHp: 1000, attack: 200 });
    const r = simulate(a, b, { bName: 'Ada#3f7c' });
    const tl = toTimeline(r, { aMaxHp: 1200, bMaxHp: 1000, bName: 'Ada#3f7c' });
    const blitz = tl.rounds[0].beats.find((x) => x.kind === 'blitz');
    expect(blitz).toMatchObject({ by: 'a', at: 'b' });
    const bHit = tl.rounds[0].beats.find((x) => x.kind === 'swing' && x.by === 'b');
    expect(bHit).toMatchObject({ at: 'a' });
  });

  it('never leaves a damage beat unattributed', () => {
    const r = simulate(
      stats({ maxHp: 3000, attack: 250, reflect: 0.3, roundPlan: plan({ dotStart: 20, dotRamp: 5 }) }),
      stats({ maxHp: 3000, attack: 250, reflect: 0.3, hooks: hooks({ comboEvery: 2, comboBonus: 0.5 }) }),
      { bName: 'Foe' }
    );
    const tl = toTimeline(r, { aMaxHp: 3000, bMaxHp: 3000, bName: 'Foe' });
    for (const rd of tl.rounds) {
      for (const b of rd.beats) {
        if (b.amount > 0 && !b.heal) {
          expect(b.at, `unattributed: "${b.text}"`).not.toBeNull();
          expect(b.by, `no source: "${b.text}"`).not.toBeNull();
        }
      }
    }
  });
});
