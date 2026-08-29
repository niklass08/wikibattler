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
 *  Full breakdown for the card-detail sheet. The card face only has room for a
 *  bare "+12%" / "+192"; this spells out *which team stat* that number moves.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface StatBoost {
  /** the team stat this raises, in words: "Team Attack", "Team HP", … */
  stat: string;
  /** how much: "+192", "+12%", "+15/round", "18%" */
  amount: string;
}

export interface BattleBreakdown {
  role: 'Fighter' | 'Field';
  /** ⚔️ for a fighter, else the effect's pictogram */
  icon: string;
  /** "Fighter" or the effect name */
  title: string;
  /** what this card actively raises (excludes the universal Defence → HP) */
  boosts: StatBoost[];
  /** every card also adds this much to the team HP pool, from its Defence */
  hpFromDefence: number;
}

/** field stat → the words shown to the player */
const STAT_LABEL: Record<FieldStat, string> = {
  hpFlat: 'Team HP',
  hpPct: 'Team HP',
  atkFlat: 'Team Attack',
  atkPct: 'Team Attack',
  regen: 'Regen',
  reflect: 'Damage reflect'
};

function amountFor(stat: FieldStat, compact: string): string {
  return stat === 'regen' ? compact.replace('/r', '/round') : compact;
}

export function battleBreakdown(card: Card): BattleBreakdown {
  if (classifyCard(card) === 'living') {
    return {
      role: 'Fighter',
      icon: ROLE_META.living.icon,
      title: ROLE_META.living.label,
      boosts: [{ stat: 'Team Attack', amount: `+${card.strength}` }],
      hpFromDefence: card.defence
    };
  }
  const e = effectFor(card);
  return {
    role: 'Field',
    icon: e.icon,
    title: e.name,
    boosts: e.parts.map((p) => ({ stat: STAT_LABEL[p.stat], amount: amountFor(p.stat, p.compact) })),
    hpFromDefence: card.defence
  };
}
