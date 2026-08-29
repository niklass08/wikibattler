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
  ROUND_EFFECTS,
  TAG_EFFECT,
  type Contribution,
  type EffectId,
  type FieldStat,
  type RoundEffectDef,
  type RoundEffectTag
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

/* ─────────────────────────────────────────────────────────────────────────────
 *  ROUND EFFECTS — resolved against one card, then aggregated into a plan the
 *  simulation walks each round. See effects.config.ts for the numbers.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ResolvedRoundEffect {
  tag: RoundEffectTag;
  kind: RoundEffectDef['kind'];
  name: string;
  icon: string;
  /** one-line summary for the team sheet */
  detail: string;
  /** source card title */
  from: string;
  /** dot: first-round damage and how much more it adds each round */
  dot?: { start: number; ramp: number };
  /** ramp: fractional team-attack gain added every round */
  ramp?: { pct: number };
  /** bloom: every `delay` rounds, deal `damage` */
  bloom?: { delay: number; damage: number };
  /** overdrive: every `delay` rounds, one extra team attack */
  overdrive?: { delay: number };
}

/**
 * The scheduled effect a card brings. It has to be one of the card's two
 * strongest themes (tags are score-sorted) — and deriveTags already refuses to
 * hand a specialist theme like `disease` a *secondary* slot on a single stray
 * category hit — so a film with one "…COVID-19 pandemic" category stays a film.
 */
export function roundEffectFor(card: Card): ResolvedRoundEffect | null {
  for (const tag of (card.tags ?? []).slice(0, 2) as RoundEffectTag[]) {
    const def = ROUND_EFFECTS[tag];
    if (def) return resolveRoundEffect(tag, def, card);
  }
  return null;
}

function resolveRoundEffect(
  tag: RoundEffectTag,
  def: RoundEffectDef,
  card: Card
): ResolvedRoundEffect {
  const base = { tag, kind: def.kind, name: def.name, icon: def.icon, from: card.title };
  switch (def.kind) {
    case 'dot': {
      const start = Math.round(def.damage + def.perStrength * card.strength);
      const ramp = Math.round(def.ramp + def.perStrength * card.strength);
      return { ...base, dot: { start, ramp }, detail: `${start} damage/round, +${ramp} each round` };
    }
    case 'ramp':
      return {
        ...base,
        ramp: { pct: def.atkPctPerRound },
        detail: `+${pct(def.atkPctPerRound)} team attack every round`
      };
    case 'bloom': {
      const damage = Math.round(def.damage + def.perStrength * card.strength);
      return {
        ...base,
        bloom: { delay: def.delay, damage },
        detail: `blooms every ${def.delay} rounds for ${damage} damage`
      };
    }
    case 'overdrive':
      return {
        ...base,
        overdrive: { delay: def.delay },
        detail: `an extra team attack every ${def.delay} rounds`
      };
  }
}

/** Everything the simulation needs to run the round effects, aggregated. */
export interface RoundPlan {
  effects: ResolvedRoundEffect[];
  /** disease: total first-round damage and total per-round ramp */
  dotStart: number;
  dotRamp: number;
  /** scientists: total fractional team-attack gain per round */
  atkRampPct: number;
  /** plants: one entry per bloom source */
  blooms: { delay: number; damage: number }[];
  /** vehicles: one delay per overdrive source */
  overdrives: number[];
}

export function planRounds(effects: ResolvedRoundEffect[]): RoundPlan {
  const plan: RoundPlan = {
    effects,
    dotStart: 0,
    dotRamp: 0,
    atkRampPct: 0,
    blooms: [],
    overdrives: []
  };
  for (const e of effects) {
    if (e.dot) {
      plan.dotStart += e.dot.start;
      plan.dotRamp += e.dot.ramp;
    }
    if (e.ramp) plan.atkRampPct += e.ramp.pct;
    if (e.bloom) plan.blooms.push(e.bloom);
    if (e.overdrive) plan.overdrives.push(e.overdrive.delay);
  }
  return plan;
}
