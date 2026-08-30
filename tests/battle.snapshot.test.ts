/**
 * Regression guard for the symmetric-`simulate` rework. Captures the full combat
 * log of the single-player (team vs flat stat block) path for a spread of teams
 * BEFORE the refactor. After the rework — where the flat opponent becomes
 * `dummyTeam(...)` — these snapshots must stay byte-identical.
 *
 * If a snapshot legitimately needs to change, that is a behaviour change to the
 * existing Goldfish fight and must be a deliberate, reviewed decision.
 */
import { describe, it, expect } from 'vitest';
import { simulateVsDummy, type TeamStats } from '../src/lib/battle/engine';
import { GOLDFISH } from '../src/lib/battle/opponents';
import type { Opponent } from '../src/lib/battle/engine';

// Every assertion goes through this one indirection. It was the two-arg
// `simulate` when the snapshots were captured; the symmetric rework routes the
// flat stat block through `simulateVsDummy`, and every snapshot must be unchanged.
const vsDummy = (team: TeamStats, o: Opponent) => simulateVsDummy(team, o);

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

const dummy = (maxHp: number, attack: number): Opponent => ({
  id: 'x',
  name: 'Dummy',
  blurb: '',
  maxHp,
  attack
});

const CASES: Record<string, () => ReturnType<typeof simulateVsDummy>> = {
  'plain team vs goldfish': () => vsDummy(stats({ maxHp: 9000, attack: 1000 }), GOLDFISH),
  'huge team, fast kill': () => vsDummy(stats({ maxHp: 9000, attack: 3500 }), GOLDFISH),
  'no fighters, loses': () => vsDummy(stats({ maxHp: 200, attack: 0 }), GOLDFISH),
  'grind to the round cap': () => vsDummy(stats({ maxHp: 9000, attack: 10 }), dummy(9_000_000, 1)),
  'dot ramps': () =>
    vsDummy(
      stats({
        maxHp: 5000,
        attack: 0,
        roundPlan: {
          effects: [],
          dotStart: 20,
          dotRamp: 20,
          atkRampPct: 0,
          blooms: [],
          overdrives: []
        }
      }),
      dummy(300, 0)
    ),
  'attack ramp': () =>
    vsDummy(
      stats({
        maxHp: 9000,
        attack: 100,
        roundPlan: {
          effects: [],
          dotStart: 0,
          dotRamp: 0,
          atkRampPct: 0.5,
          blooms: [],
          overdrives: []
        }
      }),
      dummy(550, 0)
    ),
  'blooms and overdrives': () =>
    vsDummy(
      stats({
        maxHp: 9000,
        attack: 50,
        roundPlan: {
          effects: [],
          dotStart: 0,
          dotRamp: 0,
          atkRampPct: 0,
          blooms: [{ delay: 3, damage: 400 }],
          overdrives: [2]
        }
      }),
      dummy(2000, 20)
    ),
  'divine shield soaks the opener': () =>
    vsDummy(
      stats({ maxHp: 100, attack: 100, hooks: { ...stats({}).hooks, negateEnemyHits: 2 } }),
      dummy(1000, 999)
    ),
  'blitz doubles the early swings': () =>
    vsDummy(
      stats({ maxHp: 5000, attack: 100, hooks: { ...stats({}).hooks, blitzRounds: 3 } }),
      dummy(10_000, 10)
    ),
  'combo every third swing': () =>
    vsDummy(
      stats({
        maxHp: 5000,
        attack: 100,
        hooks: { ...stats({}).hooks, comboEvery: 3, comboBonus: 1 }
      }),
      dummy(10_000, 10)
    ),
  'reflect bounces the goldfish': () =>
    vsDummy(stats({ maxHp: 9000, attack: 100, reflect: 0.5 }), GOLDFISH),
  'regen outheals a weak hit': () =>
    vsDummy(stats({ maxHp: 500, attack: 20, regen: 40 }), dummy(4000, 30))
};

describe('simulate — pre-refactor single-player snapshots', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, () => {
      expect(run()).toMatchSnapshot();
    });
  }
});
