/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BATTLE — ENVIRONMENTAL EFFECTS CONFIG
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every 'abstract' card on a team (a film, a country, a war, a concept…) plants
 * one passive effect on the battlefield, picked from the card's strongest
 * thematic tag. This file is the whole rulebook for that system — pure data, no
 * logic. Tweak the numbers, remap the tags, add an effect: the evaluator in
 * effects.ts turns whatever is here into field modifiers and a description
 * string automatically.
 *
 *   TAG_EFFECT      which effect each of the 13 tags plants (must cover them all)
 *   DEFAULT_EFFECT  used when an abstract card's tags are all unmapped / absent
 *   EFFECTS         each effect: a display name + a list of stat contributions
 *
 * A contribution's value is:
 *
 *   value = base  +  perStrength · card.strength  +  perDefence · card.defence
 *   → rounded to an integer for the flat stats (hpFlat / atkFlat / regen)
 *   → then clamped to [min, max] if given
 *
 * Field stats:
 *   hpFlat   flat HP added to the shared pool
 *   hpPct    fractional HP bonus      (0.05 = +5%), summed then applied once
 *   atkFlat  flat attack per round
 *   atkPct   fractional attack bonus
 *   regen    HP healed at the end of every round
 *   reflect  fraction of incoming damage bounced back (team total capped at 0.75)
 */
import type { Tag } from '../tags';

export type FieldStat = 'hpFlat' | 'hpPct' | 'atkFlat' | 'atkPct' | 'regen' | 'reflect';

export interface Contribution {
  stat: FieldStat;
  /** flat starting value (default 0) */
  base?: number;
  /** added per point of the card's Strength */
  perStrength?: number;
  /** added per point of the card's Defence */
  perDefence?: number;
  /** clamp the final value from below (applied after rounding) */
  min?: number;
  /** clamp the final value from above */
  max?: number;
}

export interface EffectDef {
  /** shown on the team sheet and in the combat log */
  name: string;
  /** one or more stat contributions, all applied */
  contributions: Contribution[];
}

/** Every environmental effect, keyed by a short id. */
export const EFFECTS = {
  terrain: {
    name: 'Home Terrain',
    contributions: [{ stat: 'hpPct', base: 0.05, perDefence: 1 / 4000 }]
  },
  spectacle: {
    name: 'Spectacle',
    contributions: [{ stat: 'atkPct', base: 0.04, perStrength: 1 / 4000 }]
  },
  anthem: {
    name: 'Anthem',
    contributions: [
      { stat: 'atkPct', base: 0.03, perStrength: 1 / 5000 },
      { stat: 'regen', perDefence: 0.03, min: 1 }
    ]
  },
  muse: {
    name: 'Muse',
    contributions: [{ stat: 'atkPct', base: 0.05, perStrength: 1 / 4000 }]
  },
  metagame: {
    name: 'Metagame',
    contributions: [{ stat: 'atkPct', base: 0.04, perStrength: 1 / 4500 }]
  },
  arsenal: {
    name: 'Arsenal',
    contributions: [{ stat: 'atkFlat', perStrength: 0.3 }]
  },
  countermeasures: {
    name: 'Countermeasures',
    contributions: [{ stat: 'reflect', base: 0.1, perStrength: 1 / 6000, max: 0.4 }]
  },
  sponsorship: {
    name: 'Sponsorship',
    contributions: [{ stat: 'regen', perDefence: 0.03, min: 1 }]
  },
  doctrine: {
    name: 'Doctrine',
    contributions: [
      { stat: 'atkPct', base: 0.03 },
      { stat: 'hpPct', base: 0.03 }
    ]
  },
  legacy: {
    name: 'Legacy',
    contributions: [{ stat: 'hpFlat', perDefence: 0.2 }]
  },
  faith: {
    name: 'Faith',
    contributions: [
      { stat: 'regen', perDefence: 0.03, min: 1 },
      { stat: 'hpPct', base: 0.02 }
    ]
  },
  training: {
    name: 'Training',
    contributions: [{ stat: 'atkPct', base: 0.03, perStrength: 1 / 5000 }]
  },
  landmark: {
    name: 'Landmark',
    contributions: [{ stat: 'hpFlat', perDefence: 0.2 }]
  }
} as const satisfies Record<string, EffectDef>;

export type EffectId = keyof typeof EFFECTS;

/**
 * Which effect each thematic tag plants. Every tag must appear. When a card
 * carries several tags, its strongest (first) mapped tag wins — see effects.ts.
 */
export const TAG_EFFECT: Record<Tag, EffectId> = {
  cinema: 'spectacle',
  music: 'anthem',
  sport: 'training',
  politics: 'doctrine',
  war: 'arsenal',
  history: 'legacy',
  science: 'countermeasures',
  geography: 'terrain',
  arts: 'muse',
  games: 'metagame',
  nature: 'landmark', // nature cards usually classify as 'living'; this is the rare fallback
  business: 'sponsorship',
  religion: 'faith'
};

/** Effect for an abstract card whose tags are all unmapped, or which has none. */
export const DEFAULT_EFFECT: EffectId = 'landmark';
