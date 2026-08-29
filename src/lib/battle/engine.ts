/**
 * Auto-battler resolution. A team of up to 7 cards is folded into one shared
 * pool — HP from every card's Defence, attack from the Strength of the 'living'
 * cards only — then environmental effects from the 'abstract' cards bend the
 * pool before the fight. The simulation is deterministic: no RNG, fixed damage,
 * so the combat log is reproducible and unit-testable.
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

/** Play the whole fight out and return every round plus the tally. */
export function simulate(team: TeamStats, enemy: Opponent): BattleResult {
  let playerHp = team.maxHp;
  let enemyHp = enemy.maxHp;
  let damageDealt = 0;
  let damageTaken = 0;
  const rounds: Round[] = [];

  const resultLine = (outcome: Outcome, n: number): LogLine => ({
    kind: 'result',
    text:
      outcome === 'win'
        ? `Victory — the ${enemy.name} is down in ${n} round${n === 1 ? '' : 's'}.`
        : outcome === 'loss'
          ? `Defeat — your team falls in ${n} round${n === 1 ? '' : 's'}.`
          : `Draw — ${ROUND_CAP} rounds and neither side broke.`
  });

  const end = (outcome: Outcome, n: number, lines: LogLine[]): BattleResult => {
    lines.push(resultLine(outcome, n));
    rounds.push({ n, lines, playerHp: clamp(playerHp), enemyHp: clamp(enemyHp) });
    return { outcome, rounds, damageDealt, damageTaken };
  };

  const plan = team.roundPlan;
  const noFighters = team.attack <= 0;
  let atkRamp = 0; // scientists — grows every round

  for (let n = 1; n <= ROUND_CAP; n++) {
    const lines: LogLine[] = [];

    // scientists ramp the team's attack, a little more every round
    if (plan.atkRampPct > 0) {
      atkRamp += plan.atkRampPct;
      lines.push({
        kind: 'field',
        text: `🧪 Breakthrough — team attack now +${Math.round(atkRamp * 100)}%.`
      });
    }
    const hit = noFighters ? 0 : Math.round(team.attack * (1 + atkRamp));

    // your team swings — once, plus one extra per charged vehicle
    const swings = 1 + plan.overdrives.filter((d) => n % d === 0).length;
    if (noFighters) {
      lines.push({ kind: 'you', text: 'No fighter on the team — the swing is skipped.' });
    } else {
      for (let s = 0; s < swings; s++) {
        enemyHp -= hit;
        damageDealt += hit;
        lines.push({
          kind: s === 0 ? 'you' : 'field',
          text:
            s === 0
              ? `Your team hits for ${hit}. ${enemy.name} ${clamp(enemyHp + hit)} → ${clamp(enemyHp)}.`
              : `🚗 Overdrive — an extra strike for ${hit}. ${enemy.name} ${clamp(enemyHp + hit)} → ${clamp(enemyHp)}.`
        });
        if (enemyHp <= 0) return end('win', n, lines);
      }
    }

    // disease festers, worse each round
    if (plan.dotStart > 0 || plan.dotRamp > 0) {
      const dot = plan.dotStart + plan.dotRamp * (n - 1);
      if (dot > 0) {
        enemyHp -= dot;
        damageDealt += dot;
        lines.push({
          kind: 'field',
          text: `🦠 Contagion festers for ${dot}. ${enemy.name} ${clamp(enemyHp + dot)} → ${clamp(enemyHp)}.`
        });
        if (enemyHp <= 0) return end('win', n, lines);
      }
    }

    // plants that have finished charging bloom
    for (const b of plan.blooms) {
      if (n % b.delay === 0) {
        enemyHp -= b.damage;
        damageDealt += b.damage;
        lines.push({
          kind: 'field',
          text: `🌱 Bloom — ${b.damage} damage. ${enemy.name} ${clamp(enemyHp + b.damage)} → ${clamp(enemyHp)}.`
        });
      }
    }
    if (enemyHp <= 0) return end('win', n, lines);

    // enemy answers
    const dmg = enemy.attack;
    if (dmg > 0) {
      playerHp -= dmg;
      damageTaken += dmg;
      lines.push({
        kind: 'enemy',
        text: `${enemy.name} hits for ${dmg}. Team ${clamp(playerHp + dmg)} → ${clamp(playerHp)}.`
      });
      if (!noFighters && team.reflect > 0) {
        const back = Math.round(dmg * team.reflect);
        if (back > 0) {
          enemyHp -= back;
          damageDealt += back;
          lines.push({
            kind: 'field',
            text: `Countermeasures reflect ${back}. ${enemy.name} ${clamp(enemyHp + back)} → ${clamp(enemyHp)}.`
          });
          if (enemyHp <= 0) return end('win', n, lines);
        }
      }
    } else {
      lines.push({ kind: 'enemy', text: `${enemy.name} does nothing in particular.` });
    }

    if (playerHp <= 0) return end('loss', n, lines);

    // end-of-round regen
    if (team.regen > 0 && playerHp < team.maxHp) {
      const healed = Math.min(team.regen, team.maxHp - playerHp);
      playerHp += healed;
      lines.push({ kind: 'field', text: `Field heals ${healed}. Team → ${clamp(playerHp)}.` });
    }

    rounds.push({ n, lines, playerHp: clamp(playerHp), enemyHp: clamp(enemyHp) });
  }

  const last = rounds[rounds.length - 1];
  last.lines.push({ kind: 'field', text: 'The round cap runs out.' });
  last.lines.push(resultLine('draw', ROUND_CAP));
  return { outcome: 'draw', rounds, damageDealt, damageTaken };
}
