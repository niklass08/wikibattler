/**
 * Applies mythic signatures to an assembled team. Reads the numbers from
 * signatures.config.ts and folds each signature into the team's field mods, its
 * round plan, and a small bag of per-round `hooks` the simulation reads.
 *
 * N (the scale factor) is the number of team cards sharing the signature's
 * theme — the mythic that carries it always counts, whatever its own tags.
 */
import type { Card } from '../types';

import { SIGNATURES, type SignatureTheme } from './signatures.config';
import type { FieldMods, RoundPlan } from './effects';

/** What the engine hands applySignatures for each team member. */
export interface SigInput {
  card: Card;
  /** the member's static field-effect mods, if any — for Patronage to copy */
  effectMods: FieldMods | null;
  effectName: string | null;
}

/** Per-round levers the signatures can pull; the simulation reads these. */
export interface SignatureHooks {
  /** multiply the enemy's attack (1 = unchanged) */
  enemyAtkMult: number;
  /** negate the first N enemy hits of the fight */
  negateEnemyHits: number;
  /** the team strikes twice on rounds ≤ this */
  blitzRounds: number;
  /** every Nth team swing deals a bonus; 0 = off */
  comboEvery: number;
  /** bonus fraction of the combo hit */
  comboBonus: number;
  /** + team attack while the team is above half HP */
  apexAtkPct: number;
  /** + team attack for every 4 full rounds elapsed */
  longGamePer4: number;
  /** blooms heal the team this fraction of their damage */
  bloomHealFrac: number;
}

export const zeroHooks = (): SignatureHooks => ({
  enemyAtkMult: 1,
  negateEnemyHits: 0,
  blitzRounds: 0,
  comboEvery: 0,
  comboBonus: 0,
  apexAtkPct: 0,
  longGamePer4: 0,
  bloomHealFrac: 0
});

/** A signature resolved against the team, for the team sheet / card detail. */
export interface ResolvedSignature {
  theme: SignatureTheme;
  name: string;
  icon: string;
  count: number;
  detail: string;
  from: string;
}

export interface SignatureResult {
  applied: ResolvedSignature[];
  hooks: SignatureHooks;
}

const modKeys: (keyof FieldMods)[] = [
  'hpFlat',
  'hpPct',
  'atkFlat',
  'atkPct',
  'regen',
  'reflect'
];
const absMods = (m: FieldMods) => modKeys.reduce((s, k) => s + Math.abs(m[k]), 0);
const asTheme = (s: string | null): SignatureTheme | null =>
  s && s in SIGNATURES ? (s as SignatureTheme) : null;

/** Fold every mythic signature on the team into `mods` / `roundPlan` (mutated) + hooks. */
export function applySignatures(
  team: SigInput[],
  mods: FieldMods,
  roundPlan: RoundPlan
): SignatureResult {
  const hooks = zeroHooks();
  const applied: ResolvedSignature[] = [];

  const carriers = team.filter((t) => asTheme(t.card.signature) !== null);
  if (carriers.length === 0) return { applied, hooks };

  // Peer Review multiplies everything else, so it runs last.
  carriers.sort(
    (a, b) => (a.card.signature === 'science' ? 1 : 0) - (b.card.signature === 'science' ? 1 : 0)
  );

  for (const carrier of carriers) {
    const theme = asTheme(carrier.card.signature)!;
    const def = SIGNATURES[theme];
    const n = def.n;
    const count = team.filter(
      (t) => t.card.id === carrier.card.id || (t.card.tags ?? []).includes(theme)
    ).length;
    let detail: string;

    switch (theme) {
      case 'cinema':
        mods.atkPct += n.atkPctPer * count;
        detail = `+${pct(n.atkPctPer * count)} team attack`;
        break;
      case 'music':
        roundPlan.atkRampPct += n.rampPer * count;
        detail = `+${pct(n.rampPer * count)} attack every round`;
        break;
      case 'sport':
        mods.atkPct += n.atkPctPer * count;
        mods.hpPct += n.hpPctPer * count;
        detail = `+${pct(n.atkPctPer * count)} attack & HP`;
        break;
      case 'politics':
        hooks.enemyAtkMult = Math.max(n.floor, hooks.enemyAtkMult * (1 - n.enemyAtkCutPer * count));
        detail = `enemy attack ${pct(1 - hooks.enemyAtkMult)} weaker`;
        break;
      case 'war':
        hooks.blitzRounds = Math.max(hooks.blitzRounds, n.blitzBase + count - 1);
        detail = `double strike, rounds 1–${hooks.blitzRounds}`;
        break;
      case 'history':
        hooks.longGamePer4 += n.per4 * (1 + n.scalePer * count);
        detail = `+${pct(n.per4 * (1 + n.scalePer * count))} attack per 4 rounds elapsed`;
        break;
      case 'geography':
        mods.hpPct += n.hpPctPer * count;
        mods.regen += n.regenPer * count;
        detail = `+${pct(n.hpPctPer * count)} HP, +${n.regenPer * count} regen/round`;
        break;
      case 'arts': {
        const copies = count >= n.twoAt ? 2 : 1;
        const pool = team
          .filter((t) => t.card.id !== carrier.card.id && t.effectMods)
          .sort((a, b) => absMods(b.effectMods!) - absMods(a.effectMods!))
          .slice(0, copies);
        for (const src of pool) for (const k of modKeys) mods[k] += src.effectMods![k];
        detail = pool.length
          ? `copies ${pool.map((p) => p.effectName).join(' & ')}`
          : 'nothing to copy yet';
        break;
      }
      case 'games':
        hooks.comboEvery = Math.max(n.min, n.base - count);
        hooks.comboBonus = n.bonus;
        detail = `every ${hooks.comboEvery}${ord(hooks.comboEvery)} swing hits +${pct(n.bonus)}`;
        break;
      case 'nature': {
        // the umbrella theme pays for a *broad* team rather than a stacked one
        const spread = new Set(team.flatMap((t) => t.card.tags ?? [])).size || 1;
        mods.atkPct += n.perTheme * spread;
        mods.hpPct += n.perTheme * spread;
        detail = `+${pct(n.perTheme * spread)} attack & HP (${spread} themes)`;
        break;
      }
      case 'animals':
        hooks.apexAtkPct += n.base + n.per * count;
        detail = `+${pct(n.base + n.per * count)} attack above half HP`;
        break;
      case 'business':
        roundPlan.atkRampPct += n.ramp * (1 + count);
        detail = `+${pct(n.ramp * (1 + count))} permanent attack per round`;
        break;
      case 'religion':
        hooks.negateEnemyHits = Math.max(hooks.negateEnemyHits, count >= n.twoAt ? 2 : 1);
        detail = `negate the first ${hooks.negateEnemyHits} enemy hit${hooks.negateEnemyHits === 1 ? '' : 's'}`;
        break;
      case 'plants':
        roundPlan.blooms = roundPlan.blooms.map((b) => ({
          ...b,
          delay: Math.max(n.minDelay, b.delay - n.delayCutPer * count)
        }));
        hooks.bloomHealFrac = Math.max(hooks.bloomHealFrac, n.healFrac);
        detail = `blooms sooner and heal ${pct(n.healFrac)} of their damage`;
        break;
      case 'scientists':
        roundPlan.atkRampPct += n.rampPer * count;
        mods.regen += n.regen;
        detail = `+${pct(n.rampPer * count)} attack ramp, +${n.regen} regen/round`;
        break;
      case 'disease':
        roundPlan.dotRamp = Math.round(roundPlan.dotRamp * (1 + count));
        detail = roundPlan.dotRamp > 0 ? `contagion growth ×${1 + count}` : 'needs a disease card';
        break;
      case 'vehicles':
        roundPlan.overdrives = roundPlan.overdrives.map((d) =>
          Math.max(n.minDelay, d - n.delayCutPer * count)
        );
        detail = roundPlan.overdrives.length ? `overdrive every ${Math.min(...roundPlan.overdrives)} rounds` : 'needs a vehicle card';
        break;
      case 'science': {
        const f = 1 + n.boostPer * count;
        for (const k of modKeys) mods[k] *= f;
        roundPlan.dotStart = Math.round(roundPlan.dotStart * f);
        roundPlan.dotRamp = Math.round(roundPlan.dotRamp * f);
        roundPlan.atkRampPct *= f;
        roundPlan.blooms = roundPlan.blooms.map((b) => ({ ...b, damage: Math.round(b.damage * f) }));
        hooks.apexAtkPct *= f;
        hooks.longGamePer4 *= f;
        hooks.enemyAtkMult = Math.max(0.1, 1 - (1 - hooks.enemyAtkMult) * f);
        detail = `every other effect ×${f.toFixed(2)}`;
        break;
      }
    }

    applied.push({ theme, name: def.name, icon: def.icon, count, detail, from: carrier.card.title });
  }

  return { applied, hooks };
}

/* helpers */
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ord = (k: number) => (k === 1 ? 'st' : k === 2 ? 'nd' : k === 3 ? 'rd' : 'th');

/** The signature a card carries, for the card face / detail (out of battle). */
export function cardSignature(card: Card): { name: string; icon: string; blurb: string } | null {
  const t = asTheme(card.signature);
  if (!t) return null;
  const def = SIGNATURES[t];
  return { name: def.name, icon: def.icon, blurb: def.blurb };
}
