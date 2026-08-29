/**
 * Environmental-effect evaluator. Reads the declarative rulebook in
 * effects.config.ts and turns it into concrete field modifiers plus a
 * description string for a given card. No effect numbers live here — only the
 * arithmetic that applies them. See effects.config.ts to review or tune.
 */
import type { Card } from '../types';
import type { Tag } from '../tags';
import {
  DEFAULT_EFFECT,
  EFFECTS,
  TAG_EFFECT,
  type Contribution,
  type EffectId,
  type FieldStat
} from './effects.config';

/** Running totals the effects fold into when a team is assembled. */
export interface FieldMods {
  hpFlat: number;
  hpPct: number;
  atkFlat: number;
  atkPct: number;
  regen: number;
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

/** Team reflect never exceeds this however many Countermeasures stack. */
export const REFLECT_CAP = 0.75;

const FLAT: ReadonlySet<FieldStat> = new Set<FieldStat>(['hpFlat', 'atkFlat', 'regen']);
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** One resolved contribution: which field stat, and by how much. */
export interface ResolvedPart {
  stat: FieldStat;
  value: number;
  /** compact magnitude, e.g. "+14%", "+180", "+15/r" */
  compact: string;
}

/** An effect resolved against one specific card — no closures, just values. */
export interface ResolvedEffect {
  id: EffectId;
  name: string;
  /** single pictogram, from the config */
  icon: string;
  /** compact magnitude of the lead contribution, e.g. "+14%", "+180", "+15/r" */
  headline: string;
  /** human-readable summary, e.g. "+7% team attack · heal 12/round" */
  detail: string;
  /** every contribution, in config order */
  parts: ResolvedPart[];
  mods: FieldMods;
}

function valueOf(c: Contribution, card: Card): number {
  let v =
    (c.base ?? 0) +
    (c.perStrength ?? 0) * card.strength +
    (c.perDefence ?? 0) * card.defence;
  if (FLAT.has(c.stat)) v = Math.round(v);
  if (c.min != null) v = Math.max(c.min, v);
  if (c.max != null) v = Math.min(c.max, v);
  return v;
}

function phrase(stat: FieldStat, v: number): string {
  switch (stat) {
    case 'hpFlat':
      return `+${v} flat HP`;
    case 'hpPct':
      return `+${pct(v)} team HP`;
    case 'atkFlat':
      return `+${v} flat attack`;
    case 'atkPct':
      return `+${pct(v)} team attack`;
    case 'regen':
      return `heal ${v}/round`;
    case 'reflect':
      return `reflect ${pct(v)} of damage taken`;
  }
}

/** Compact form of one contribution, for the card face. */
function compact(stat: FieldStat, v: number): string {
  switch (stat) {
    case 'hpFlat':
    case 'atkFlat':
      return `+${v}`;
    case 'hpPct':
    case 'atkPct':
      return `+${pct(v)}`;
    case 'regen':
      return `+${v}/r`;
    case 'reflect':
      return pct(v);
  }
}

/** Build the concrete effect an id produces for this card. */
export function resolveEffect(id: EffectId, card: Card): ResolvedEffect {
  const def = EFFECTS[id];
  const mods: FieldMods = { ...ZERO_MODS };
  const phrases: string[] = [];
  const parts: ResolvedPart[] = [];
  for (const c of def.contributions) {
    const v = valueOf(c, card);
    mods[c.stat] += v;
    phrases.push(phrase(c.stat, v));
    parts.push({ stat: c.stat, value: v, compact: compact(c.stat, v) });
  }
  return {
    id,
    name: def.name,
    icon: def.icon,
    headline: parts[0]?.compact ?? '',
    detail: phrases.join(' · '),
    parts,
    mods
  };
}

/** The effect id an abstract card's tags select. */
export function effectIdFor(card: Card): EffectId {
  for (const tag of card.tags ?? []) {
    const id = TAG_EFFECT[tag as Tag];
    if (id) return id;
  }
  return DEFAULT_EFFECT;
}

/** The environmental effect an abstract card brings to the field. */
export function effectFor(card: Card): ResolvedEffect {
  return resolveEffect(effectIdFor(card), card);
}

/** Fold a list of resolved effects into one field total. */
export function sumMods(effects: ResolvedEffect[]): FieldMods {
  const total: FieldMods = { ...ZERO_MODS };
  for (const e of effects) {
    total.hpFlat += e.mods.hpFlat;
    total.hpPct += e.mods.hpPct;
    total.atkFlat += e.mods.atkFlat;
    total.atkPct += e.mods.atkPct;
    total.regen += e.mods.regen;
    total.reflect += e.mods.reflect;
  }
  total.reflect = Math.min(REFLECT_CAP, total.reflect);
  return total;
}
