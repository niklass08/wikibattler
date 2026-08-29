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
import { effectFor, roundEffectFor, type ResolvedRoundEffect } from './effects';
import type { FieldStat } from './effects.config';

/** short value string for a round effect, for the card face */
function roundValue(r: ResolvedRoundEffect): string {
  if (r.dot) return `+${r.dot.start}/r`;
  if (r.ramp) return `+${Math.round(r.ramp.pct * 100)}%/r`;
  if (r.bloom) return `${r.bloom.damage}`;
  if (r.overdrive) return '+1 turn';
  return '';
}

export interface CardBattleStat {
  /** true = a living card that swings; false = a field card with a passive */
  fighter: boolean;
  icon: string;
  /** short value string: "480", "+12%", "+180", "+15/r" */
  value: string;
  /** short label: "Fighter" or the effect name */
  label: string;
  /** full tooltip / caption */
  hint: string;
}

/**
 * Which base stat the card face actually shows for this card (see Card.svelte):
 * fighters display STR, field cards display DEF. Used to keep a "sort by
 * defence" from surfacing cards whose defence is hidden, and vice versa.
 */
export const showsStrength = (card: Card): boolean => classifyCard(card) === 'living';
export const showsDefence = (card: Card): boolean => classifyCard(card) === 'abstract';

export function cardBattleStat(card: Card): CardBattleStat {
  const fighter = classifyCard(card) === 'living';

  // a scheduled theme ability (disease / scientists / plants / vehicles) is the
  // most distinctive thing a card does — it takes the battle cell when present
  const r = roundEffectFor(card);
  if (r) {
    return {
      fighter,
      icon: r.icon,
      value: roundValue(r),
      label: r.name,
      hint: `${r.name} — ${r.detail}`
    };
  }

  if (fighter) {
    return {
      fighter: true,
      icon: ROLE_META.living.icon,
      value: String(card.strength),
      label: ROLE_META.living.label,
      hint: `${ROLE_META.living.label} — adds ${card.strength} to the team's attack each round`
    };
  }
  const e = effectFor(card);
  return {
    fighter: false,
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
  /** a scheduled theme ability that plays out over the rounds, if any */
  schedule: { icon: string; name: string; detail: string } | null;
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
  const fighter = classifyCard(card) === 'living';
  const r = roundEffectFor(card);
  const schedule = r ? { icon: r.icon, name: r.name, detail: r.detail } : null;

  // fighters always add their Strength to Team Attack
  const fighterBoost: StatBoost[] = fighter
    ? [{ stat: 'Team Attack', amount: `+${card.strength}` }]
    : [];

  // a card with a scheduled ability — that ability is its identity; skip the
  // static field effect (it isn't applied either, see assembleTeam)
  if (r) {
    return {
      role: fighter ? 'Fighter' : 'Field',
      icon: r.icon,
      title: r.name,
      boosts: fighterBoost,
      hpFromDefence: card.defence,
      schedule
    };
  }

  if (fighter) {
    return {
      role: 'Fighter',
      icon: ROLE_META.living.icon,
      title: ROLE_META.living.label,
      boosts: fighterBoost,
      hpFromDefence: card.defence,
      schedule: null
    };
  }
  const e = effectFor(card);
  return {
    role: 'Field',
    icon: e.icon,
    title: e.name,
    boosts: e.parts.map((p) => ({ stat: STAT_LABEL[p.stat], amount: amountFor(p.stat, p.compact) })),
    hpFromDefence: card.defence,
    schedule: null
  };
}
