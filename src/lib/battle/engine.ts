/**
 * Auto-battler resolution. A team of up to 7 cards is folded into one shared
 * pool — HP from every card's Defence, attack from the Strength of the 'living'
 * cards only — then environmental effects from the 'abstract' cards bend the
 * pool before the fight. The simulation is deterministic: no RNG, fixed damage,
 * so the combat log is reproducible and unit-testable.
 *
 * `simulate` is symmetric: two assembled teams trade blows, side A first. The
 * A-first order is a deliberate attacker first-strike advantage — if A's swing
 * empties B's pool, B never retaliates — so `simulate(A, B)` is not the strict
 * inverse of `simulate(B, A)`. The single-player Goldfish fight runs through
 * `simulateVsDummy`, which wraps a flat stat block as a one-sided team.
 */
import type { Card } from '../types';
import { classifyCard, type Role } from './classify';
import {
  effectFor,
  planRounds,
  roundEffectFor,
  sumMods,
  type FieldMods,
  type ResolvedEffect,
  type ResolvedRoundEffect,
  type RoundPlan
} from './effects';
import { applySignatures, type ResolvedSignature, type SignatureHooks } from './signatures';

export const TEAM_SIZE = 7;
export const MAX_MYTHIC = 1;
/** A fight still going at this many rounds is called a draw. */
export const ROUND_CAP = 40;

export interface TeamMember {
  card: Card;
  role: Role;
  /** the static environmental effect this card contributes, when abstract */
  effect: ResolvedEffect | null;
  /** the scheduled round effect this card contributes, from its theme (any role) */
  round: ResolvedRoundEffect | null;
}

export interface TeamStats {
  members: TeamMember[];
  maxHp: number;
  attack: number;
  regen: number;
  reflect: number;
  mods: FieldMods;
  roundPlan: RoundPlan;
  /** mythic signatures resolved against this team */
  signatures: ResolvedSignature[];
  /** per-round levers the signatures set; the simulation reads these */
  hooks: SignatureHooks;
  livingCount: number;
  abstractCount: number;
}

export interface Opponent {
  id: string;
  name: string;
  blurb: string;
  maxHp: number;
  attack: number;
}

/** Fold the chosen cards into one battle-ready pool. */
export function assembleTeam(cards: Card[]): TeamStats {
  const members: TeamMember[] = cards.map((card) => {
    const role = classifyCard(card);
    const round = roundEffectFor(card);
    // an abstract card gets its static field effect — unless it already brings a
    // scheduled effect, in which case that IS its field presence
    const effect = role === 'abstract' && !round ? effectFor(card) : null;
    return { card, role, effect, round };
  });

  const mods = sumMods(
    members.map((m) => m.effect).filter((e): e is ResolvedEffect => e !== null)
  );
  const roundPlan = planRounds(
    members.map((m) => m.round).filter((r): r is ResolvedRoundEffect => r !== null)
  );

  // mythic signatures fold into mods / roundPlan (mutated) and set the hooks
  const { applied: signatures, hooks } = applySignatures(
    members.map((m) => ({
      card: m.card,
      effectMods: m.effect?.mods ?? null,
      effectName: m.effect?.name ?? null
    })),
    mods,
    roundPlan
  );

  const baseHp = cards.reduce((n, c) => n + c.defence, 0);
  const baseAtk = members
    .filter((m) => m.role === 'living')
    .reduce((n, m) => n + m.card.strength, 0);

  const maxHp = Math.max(1, Math.round((baseHp + mods.hpFlat) * (1 + mods.hpPct)));
  const attack = Math.round((baseAtk + mods.atkFlat) * (1 + mods.atkPct));

  return {
    members,
    maxHp,
    attack,
    regen: mods.regen,
    reflect: mods.reflect,
    mods,
    roundPlan,
    signatures,
    hooks,
    livingCount: members.filter((m) => m.role === 'living').length,
    abstractCount: members.filter((m) => m.role === 'abstract').length
  };
}

export type LogKind = 'you' | 'enemy' | 'field' | 'result';

export interface LogLine {
  kind: LogKind;
  text: string;
}

export interface Round {
  n: number;
  lines: LogLine[];
  playerHp: number;
  enemyHp: number;
}

export type Outcome = 'win' | 'loss' | 'draw';

export interface BattleResult {
  outcome: Outcome;
  rounds: Round[];
  damageDealt: number;
  damageTaken: number;
}

const clamp = (n: number) => Math.max(0, Math.round(n));

const ZERO_HOOKS: SignatureHooks = {
  enemyAtkMult: 1,
  negateEnemyHits: 0,
  blitzRounds: 0,
  comboEvery: 0,
  comboBonus: 0,
  apexAtkPct: 0,
  longGamePer4: 0,
  bloomHealFrac: 0
};

/** Wrap a flat {maxHp, attack} stat block as a one-sided team (no effects). */
export function dummyTeam(o: { maxHp: number; attack: number }): TeamStats {
  return {
    members: [],
    maxHp: Math.max(1, Math.round(o.maxHp)),
    attack: Math.max(0, Math.round(o.attack)),
    regen: 0,
    reflect: 0,
    mods: { hpFlat: 0, hpPct: 0, atkFlat: 0, atkPct: 0, regen: 0, reflect: 0 },
    roundPlan: { effects: [], dotStart: 0, dotRamp: 0, atkRampPct: 0, blooms: [], overdrives: [] },
    signatures: [],
    hooks: { ...ZERO_HOOKS },
    livingCount: o.attack > 0 ? 1 : 0,
    abstractCount: 0
  };
}

interface SideState {
  stats: TeamStats;
  hp: number;
  atkRamp: number;
  comboSwings: number;
  shields: number;
}

const initSide = (stats: TeamStats): SideState => ({
  stats,
  hp: stats.maxHp,
  atkRamp: 0,
  comboSwings: 0,
  shields: stats.hooks.negateEnemyHits
});

/**
 * Play the whole fight out and return every round plus the tally. `outcome` and
 * `damageDealt`/`damageTaken` are from side A's perspective.
 */
export function simulate(
  a: TeamStats,
  b: TeamStats,
  labels: { bName?: string } = {}
): BattleResult {
  const bName = labels.bName ?? 'the enemy';

  const A = initSide(a);
  const B = initSide(b);
  let damageDealt = 0;
  let damageTaken = 0;
  const rounds: Round[] = [];

  const resultLine = (outcome: Outcome, n: number): LogLine => ({
    kind: 'result',
    text:
      outcome === 'win'
        ? `Victory — the ${bName} is down in ${n} round${n === 1 ? '' : 's'}.`
        : outcome === 'loss'
          ? `Defeat — your team falls in ${n} round${n === 1 ? '' : 's'}.`
          : `Draw — ${ROUND_CAP} rounds and neither side broke.`
  });

  const end = (outcome: Outcome, n: number, lines: LogLine[]): BattleResult => {
    lines.push(resultLine(outcome, n));
    rounds.push({ n, lines, playerHp: clamp(A.hp), enemyHp: clamp(B.hp) });
    return { outcome, rounds, damageDealt, damageTaken };
  };

  // a 'hit' the attacker lands is A's dealt damage when A attacks, A's taken
  // damage when B attacks; a 'reflect' bounces to the attacker, so it inverts.
  const record = (isA: boolean, v: number, kind: 'hit' | 'reflect') => {
    if ((kind === 'hit') === isA) damageDealt += v;
    else damageTaken += v;
  };

  /** One side's whole turn: ramp, swings (+ overdrive/blitz/combo), DoT, blooms. */
  const actSide = (atk: SideState, def: SideState, n: number, lines: LogLine[], isA: boolean) => {
    const h = atk.stats.hooks;
    const plan = atk.stats.roundPlan;
    const selfName = isA ? 'Team' : bName;
    const foeName = isA ? bName : 'Team';
    const atkNoFighters = atk.stats.attack <= 0;

    if (plan.atkRampPct > 0) {
      atk.atkRamp += plan.atkRampPct;
      const pct = Math.round(atk.atkRamp * 100);
      lines.push({
        kind: 'field',
        text: isA
          ? `📈 Attack ramp — team attack now +${pct}%.`
          : `📈 Attack ramp — ${bName} attack now +${pct}%.`
      });
    }

    const longGame = 1 + h.longGamePer4 * Math.floor((n - 1) / 4);
    const apex = atk.hp > atk.stats.maxHp / 2 ? 1 + h.apexAtkPct : 1;
    const roundAttack = atkNoFighters
      ? 0
      : Math.round(atk.stats.attack * (1 + atk.atkRamp) * longGame * apex);

    const overdriveHits = plan.overdrives.filter((d) => n % d === 0).length;
    const blitzHit = n <= h.blitzRounds ? 1 : 0;

    if (atkNoFighters) {
      lines.push(
        isA
          ? { kind: 'you', text: 'No fighter on the team — the swing is skipped.' }
          : { kind: 'enemy', text: `${bName} does nothing in particular.` }
      );
    } else {
      const mult = def.stats.hooks.enemyAtkMult;
      for (let s = 0; s < 1 + overdriveHits + blitzHit; s++) {
        if (def.hp <= 0 || atk.hp <= 0) break;
        atk.comboSwings += 1;
        const combo = h.comboEvery > 0 && atk.comboSwings % h.comboEvery === 0;
        let hit = combo ? Math.round(roundAttack * (1 + h.comboBonus)) : roundAttack;
        hit = Math.round(hit * mult);

        // a divine shield on the defender turns one swing aside
        if (hit > 0 && def.shields > 0) {
          def.shields -= 1;
          lines.push({ kind: 'field', text: `✨ Divine Shield turns the blow aside.` });
          continue;
        }

        def.hp -= hit;
        record(isA, hit, 'hit');
        const label = combo
          ? '🎮 Combo — a heavy hit for '
          : s === 0
            ? isA
              ? 'Your team hits for '
              : `${bName} hits for `
            : s <= overdriveHits
              ? '🚗 Overdrive — an extra strike for '
              : '🗡️ Blitzkrieg — a second strike for ';
        lines.push({
          kind: s === 0 && !combo ? (isA ? 'you' : 'enemy') : 'field',
          text: `${label}${hit}. ${foeName} ${clamp(def.hp + hit)} → ${clamp(def.hp)}.`
        });
        if (def.hp <= 0) break;

        // the defender bounces a fraction of a swing back
        if (def.stats.attack > 0 && def.stats.reflect > 0) {
          const back = Math.round(hit * def.stats.reflect);
          if (back > 0) {
            atk.hp -= back;
            record(isA, back, 'reflect');
            lines.push({
              kind: 'field',
              text: `Countermeasures reflect ${back}. ${selfName} ${clamp(atk.hp + back)} → ${clamp(atk.hp)}.`
            });
            if (atk.hp <= 0) break;
          }
        }
      }
    }

    // disease festers, worse each round
    if (def.hp > 0 && (plan.dotStart > 0 || plan.dotRamp > 0)) {
      const dot = plan.dotStart + plan.dotRamp * (n - 1);
      if (dot > 0) {
        def.hp -= dot;
        record(isA, dot, 'hit');
        lines.push({
          kind: 'field',
          text: `🦠 Contagion festers for ${dot}. ${foeName} ${clamp(def.hp + dot)} → ${clamp(def.hp)}.`
        });
      }
    }

    // plants that have finished charging bloom (all due blooms resolve together)
    if (def.hp > 0) {
      for (const bl of plan.blooms) {
        if (n % bl.delay !== 0) continue;
        def.hp -= bl.damage;
        record(isA, bl.damage, 'hit');
        lines.push({
          kind: 'field',
          text: `🌱 Bloom — ${bl.damage} damage. ${foeName} ${clamp(def.hp + bl.damage)} → ${clamp(def.hp)}.`
        });
        if (h.bloomHealFrac > 0) {
          const heal = Math.min(Math.round(bl.damage * h.bloomHealFrac), atk.stats.maxHp - atk.hp);
          if (heal > 0) {
            atk.hp += heal;
            lines.push({
              kind: 'field',
              text: `🌱 Fast Bloom heals ${heal}. ${selfName} → ${clamp(atk.hp)}.`
            });
          }
        }
      }
    }
  };

  const regen = (side: SideState, name: string, lines: LogLine[]) => {
    if (side.stats.regen > 0 && side.hp > 0 && side.hp < side.stats.maxHp) {
      const healed = Math.min(side.stats.regen, side.stats.maxHp - side.hp);
      side.hp += healed;
      lines.push({ kind: 'field', text: `Field heals ${healed}. ${name} → ${clamp(side.hp)}.` });
    }
  };

  for (let n = 1; n <= ROUND_CAP; n++) {
    const lines: LogLine[] = [];

    actSide(A, B, n, lines, true);
    if (B.hp <= 0) return end('win', n, lines);
    if (A.hp <= 0) return end('loss', n, lines);

    actSide(B, A, n, lines, false);
    if (B.hp <= 0) return end('win', n, lines);
    if (A.hp <= 0) return end('loss', n, lines);

    regen(A, 'Team', lines);
    regen(B, bName, lines);

    rounds.push({ n, lines, playerHp: clamp(A.hp), enemyHp: clamp(B.hp) });
  }

  const last = rounds[rounds.length - 1];
  last.lines.push({ kind: 'field', text: 'The round cap runs out.' });
  last.lines.push(resultLine('draw', ROUND_CAP));
  return { outcome: 'draw', rounds, damageDealt, damageTaken };
}

/** The single-player path: a team against a flat practice stat block. */
export function simulateVsDummy(team: TeamStats, enemy: Opponent): BattleResult {
  return simulate(team, dummyTeam(enemy), { bName: enemy.name });
}
