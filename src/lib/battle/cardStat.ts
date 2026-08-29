/**
 * The one-glance battle line shown on every card face (next to STR / DEF), so a
 * card's role in the Auto Battler reads without opening the mode:
 *
 *   ⚔️ 480   — a fighter; the number is the attack it adds to the team
 *   ⛰️ +12%  — a field card; its lead environmental effect and magnitude
 *
 * Pure and derived straight from the card, so it is identical in the pack
 * opener, the collection and the battle screen.
 */
import type { Card } from '../types';
import { classifyCard, ROLE_META } from './classify';
import { effectFor } from './effects';
import type { FieldStat } from './effects.config';

export interface CardBattleStat {
  icon: string;
  /** short value string: "480", "+12%", "+180", "+15/r" */
  value: string;
  /** short label: "Fighter" or the effect name */
  label: string;
  /** full tooltip / caption */
  hint: string;
}

export function cardBattleStat(card: Card): CardBattleStat {
  if (classifyCard(card) === 'living') {
    return {
      icon: ROLE_META.living.icon,
      value: String(card.strength),
      label: ROLE_META.living.label,
      hint: `${ROLE_META.living.label} — adds ${card.strength} to the team's attack each round`
    };
  }
  const e = effectFor(card);
  return {
    icon: e.icon,
    value: e.headline,
    label: e.name,
    hint: `${e.name} (field) — ${e.detail}`
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  Full breakdown for the card-detail sheet: which TEAM stat each part of the
 *  card boosts, and by how much. Grouped by stat so "what does this boost?"
 *  reads at a glance.
 * ──────────────────────────────────────────────────────────────────────────── */

/** A team-facing stat this card moves. */
export type TeamStatName = 'HP pool' | 'Attack' | 'Regen' | 'Reflect';

export interface StatBoost {
  stat: TeamStatName;
  icon: string;
  /** e.g. "+400", "+12%", "+15/round", "18%" */
  amount: string;
  /** where it comes from — "Defence", "Fighter", or the effect name */
  source: string;
}

export interface BattleBreakdown {
  role: 'Fighter' | 'Field';
  /** effect name for a field card, else null */
  effect: string | null;
  /** every team stat this card touches, HP → Attack → Regen → Reflect */
  boosts: StatBoost[];
}

const STAT_ICON: Record<TeamStatName, string> = {
  'HP pool': '❤️',
  Attack: '⚔️',
  Regen: '♻️',
  Reflect: '🪃'
};

const FIELD_STAT: Record<FieldStat, TeamStatName> = {
  hpFlat: 'HP pool',
  hpPct: 'HP pool',
  atkFlat: 'Attack',
  atkPct: 'Attack',
  regen: 'Regen',
  reflect: 'Reflect'
};

const ORDER: TeamStatName[] = ['HP pool', 'Attack', 'Regen', 'Reflect'];

function amountFor(stat: FieldStat, compact: string): string {
  return stat === 'regen' ? compact.replace('/r', '/round') : compact;
}

export function battleBreakdown(card: Card): BattleBreakdown {
  const living = classifyCard(card) === 'living';
  const boosts: StatBoost[] = [
    // every card, whatever its role, pads the shared HP pool with its Defence
    { stat: 'HP pool', icon: STAT_ICON['HP pool'], amount: `+${card.defence}`, source: 'Defence' }
  ];

  if (living) {
    boosts.push({
      stat: 'Attack',
      icon: STAT_ICON.Attack,
      amount: `+${card.strength}`,
      source: ROLE_META.living.label
    });
    return { role: 'Fighter', effect: null, boosts: sortBoosts(boosts) };
  }

  const e = effectFor(card);
  for (const p of e.parts) {
    const stat = FIELD_STAT[p.stat];
    boosts.push({ stat, icon: STAT_ICON[stat], amount: amountFor(p.stat, p.compact), source: e.name });
  }
  return { role: 'Field', effect: e.name, boosts: sortBoosts(boosts) };
}

function sortBoosts(boosts: StatBoost[]): StatBoost[] {
  return [...boosts].sort((a, b) => ORDER.indexOf(a.stat) - ORDER.indexOf(b.stat));
}
