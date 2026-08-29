/**
 * Auto-battler resolution. A team of up to 7 cards is folded into one shared
 * pool — HP from every card's Defence, attack from the Strength of the 'living'
 * cards only — then environmental effects from the 'abstract' cards bend the
 * pool before the fight. The simulation is deterministic: no RNG, fixed damage,
 * so the combat log is reproducible and unit-testable.
 */
import type { Card } from '../types';
import { classifyCard, type Role } from './classify';
import { effectFor, sumMods, type FieldMods, type ResolvedEffect } from './effects';

export const TEAM_SIZE = 7;
export const MAX_MYTHIC = 1;
/** A fight still going at this many rounds is called a draw. */
export const ROUND_CAP = 40;

export interface TeamMember {
  card: Card;
  role: Role;
  /** the environmental effect this card contributes, when abstract */
  effect: ResolvedEffect | null;
}

export interface TeamStats {
  members: TeamMember[];
  maxHp: number;
  attack: number;
  regen: number;
  reflect: number;
  mods: FieldMods;
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
    return { card, role, effect: role === 'abstract' ? effectFor(card) : null };
  });

  const mods = sumMods(
    members.map((m) => m.effect).filter((e): e is ResolvedEffect => e !== null)
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

  const noFighters = team.attack <= 0;

  for (let n = 1; n <= ROUND_CAP; n++) {
    const lines: LogLine[] = [];

    // your team swings first (unless it has nobody to swing)
    if (noFighters) {
      lines.push({ kind: 'you', text: 'No living card on the team — nothing swings.' });
    } else {
      const hit = team.attack;
      enemyHp -= hit;
      damageDealt += hit;
      lines.push({
        kind: 'you',
        text: `Your team hits for ${hit}. ${enemy.name} ${clamp(enemyHp + hit)} → ${clamp(enemyHp)}.`
      });
      if (enemyHp <= 0) return end('win', n, lines);
    }

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
