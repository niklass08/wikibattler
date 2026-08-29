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
