/**
 * Passive environmental effects. Every 'abstract' card on the team (a film, a
 * country, a company, a war…) plants one of these on the battlefield. The effect
 * is chosen from the card's primary thematic tag and scaled by the card's own
 * Strength / Defence, so a bigger article bends the field harder.
 *
 * Effects are additive across the team and fold into the assembled TeamStats
 * before the first round — see engine.ts.
 */
import type { Card } from '../types';
import type { Tag } from '../tags';

/** Running totals an effect can nudge while a team is assembled. */
export interface FieldMods {
  /** flat HP added to the pool */
  hpFlat: number;
  /** fractional HP bonus (0.08 = +8%), summed then applied once */
  hpPct: number;
  /** flat attack added per round */
  atkFlat: number;
  /** fractional attack bonus */
  atkPct: number;
  /** HP healed at the end of each round */
  regen: number;
  /** fraction of incoming damage bounced back at the attacker */
  reflect: number;
}

export const ZERO_MODS: FieldMods = {
  hpFlat: 0,
  hpPct: 0,
  atkFlat: 0,
  atkPct: 0,
  regen: 0,
  reflect: 0
};

export interface EnvEffect {
  key: string;
  name: string;
  /** one-line, card-specific description for the team sheet */
  detail: (card: Card) => string;
  /** contribution to the field, given this card */
  mod: (card: Card) => Partial<FieldMods>;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** tag → effect. Tags not listed fall back to LANDMARK. */
const BY_TAG: Partial<Record<Tag, EnvEffect>> = {
  geography: {
    key: 'terrain',
    name: 'Home Terrain',
    detail: (c) => `+${pct(0.05 + c.defence / 4000)} team HP`,
    mod: (c) => ({ hpPct: 0.05 + c.defence / 4000 })
  },
  cinema: {
    key: 'spectacle',
    name: 'Spectacle',
    detail: (c) => `+${pct(0.04 + c.strength / 4000)} team attack`,
    mod: (c) => ({ atkPct: 0.04 + c.strength / 4000 })
  },
  music: {
    key: 'anthem',
    name: 'Anthem',
    detail: (c) => `+${pct(0.03 + c.strength / 5000)} attack, heal ${regen(c)}/round`,
    mod: (c) => ({ atkPct: 0.03 + c.strength / 5000, regen: regen(c) })
  },
  arts: {
    key: 'muse',
    name: 'Muse',
    detail: (c) => `+${pct(0.05 + c.strength / 4000)} team attack`,
    mod: (c) => ({ atkPct: 0.05 + c.strength / 4000 })
  },
  games: {
    key: 'meta',
    name: 'Metagame',
    detail: (c) => `+${pct(0.04 + c.strength / 4500)} attack`,
    mod: (c) => ({ atkPct: 0.04 + c.strength / 4500 })
  },
  war: {
    key: 'arsenal',
    name: 'Arsenal',
    detail: (c) => `+${flatAtk(c)} flat attack`,
    mod: (c) => ({ atkFlat: flatAtk(c) })
  },
  science: {
    key: 'countermeasures',
    name: 'Countermeasures',
    detail: (c) => `reflect ${pct(reflect(c))} of damage taken`,
    mod: (c) => ({ reflect: reflect(c) })
  },
  business: {
    key: 'sponsorship',
    name: 'Sponsorship',
    detail: (c) => `heal ${regen(c)} HP each round`,
    mod: (c) => ({ regen: regen(c) })
  },
  politics: {
    key: 'doctrine',
    name: 'Doctrine',
    detail: () => `+3% attack and +3% team HP`,
    mod: () => ({ atkPct: 0.03, hpPct: 0.03 })
  },
  history: {
    key: 'legacy',
    name: 'Legacy',
    detail: (c) => `+${flatHp(c)} flat HP`,
    mod: (c) => ({ hpFlat: flatHp(c) })
  },
  religion: {
    key: 'faith',
    name: 'Faith',
    detail: (c) => `heal ${regen(c)}/round, +2% team HP`,
    mod: (c) => ({ regen: regen(c), hpPct: 0.02 })
  },
  sport: {
    key: 'training',
    name: 'Training',
    detail: (c) => `+${pct(0.03 + c.strength / 5000)} attack`,
    mod: (c) => ({ atkPct: 0.03 + c.strength / 5000 })
  }
};

const LANDMARK: EnvEffect = {
  key: 'landmark',
  name: 'Landmark',
  detail: (c) => `+${flatHp(c)} flat HP`,
  mod: (c) => ({ hpFlat: flatHp(c) })
};

function flatHp(c: Card) {
  return Math.round(c.defence * 0.2);
}
function flatAtk(c: Card) {
  return Math.round(c.strength * 0.3);
}
function regen(c: Card) {
  return Math.max(1, Math.round(c.defence * 0.03));
}
function reflect(c: Card) {
  return Math.min(0.4, 0.1 + c.strength / 6000);
}

/** The environmental effect an abstract card brings to the field. */
export function effectFor(card: Card): EnvEffect {
  for (const tag of card.tags ?? []) {
    const e = BY_TAG[tag as Tag];
    if (e) return e;
  }
  return LANDMARK;
}

/** Merge a partial mod into a running total. */
export function addMod(into: FieldMods, part: Partial<FieldMods>): FieldMods {
  return {
    hpFlat: into.hpFlat + (part.hpFlat ?? 0),
    hpPct: into.hpPct + (part.hpPct ?? 0),
    atkFlat: into.atkFlat + (part.atkFlat ?? 0),
    atkPct: into.atkPct + (part.atkPct ?? 0),
    regen: into.regen + (part.regen ?? 0),
    reflect: Math.min(0.75, into.reflect + (part.reflect ?? 0))
  };
}
