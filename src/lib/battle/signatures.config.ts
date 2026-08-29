/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  MYTHIC SIGNATURES — one per theme
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every mythic card rolls one of these when it's pulled (see signature.ts) and
 * keeps it for good. In a battle it pays out scaled by N — the number of team
 * cards sharing the signature's theme, the mythic itself always counted.
 *
 * This file is the rulebook: display copy + the tunable numbers. The arithmetic
 * that turns them into battle modifiers lives in signatures.ts.
 */
import type { Tag } from '../tags';

export interface SignatureDef {
  /** display name */
  name: string;
  /** pictogram (the theme's icon; the ★ is added in the UI) */
  icon: string;
  /** one-liner for the card face tooltip and the help page */
  blurb: string;
  /** tunable numbers, read by signatures.ts */
  n: Record<string, number>;
}

/** Keyed by theme. Exactly one signature per tag. */
export const SIGNATURES: Record<Tag, SignatureDef> = {
  cinema: {
    name: 'Franchise',
    icon: '🎬',
    blurb: "+5% team attack for every cinema card on the team.",
    n: { atkPctPer: 0.05 }
  },
  music: {
    name: 'Crescendo',
    icon: '🎵',
    blurb: "The team's attack ramps +1.5% each round for every music card — it snowballs long fights.",
    n: { rampPer: 0.015 }
  },
  sport: {
    name: 'Home Advantage',
    icon: '🏆',
    blurb: '+4% team attack and +4% team HP for every sport card.',
    n: { atkPctPer: 0.04, hpPctPer: 0.04 }
  },
  politics: {
    name: 'Propaganda',
    icon: '📜',
    blurb: "The enemy's attack is cut by 7% for every politics card.",
    n: { enemyAtkCutPer: 0.07, floor: 0.15 }
  },
  war: {
    name: 'Blitzkrieg',
    icon: '🗡️',
    blurb: 'The team strikes twice on the opening rounds — one more blitz round per extra war card.',
    n: { blitzBase: 2 }
  },
  history: {
    name: 'The Long Game',
    icon: '🏛️',
    blurb: '+3% team attack for every 4 rounds elapsed, scaled up by 30% per history card.',
    n: { per4: 0.03, scalePer: 0.3 }
  },
  science: {
    name: 'Peer Review',
    icon: '🔬',
    blurb: 'Every other effect on the team — field and round — is +8% stronger per science card.',
    n: { boostPer: 0.08 }
  },
  geography: {
    name: 'Homeland',
    icon: '⛰️',
    blurb: '+8% team HP and +2 HP regen a round for every geography card.',
    n: { hpPctPer: 0.08, regenPer: 2 }
  },
  arts: {
    name: 'Patronage',
    icon: '🎨',
    blurb: "Copies the strongest field effect on the rest of the team — a second copy with 3+ arts cards.",
    n: { twoAt: 3 }
  },
  games: {
    name: 'Combo',
    icon: '🎮',
    blurb: 'Every 4th team swing lands +75% — the counter shortens by one per games card (min every 2nd).',
    n: { base: 4, min: 2, bonus: 0.75 }
  },
  nature: {
    name: 'Apex Predator',
    icon: '🌿',
    blurb: '+10% team attack while the team is above half HP, +2% more per nature card.',
    n: { base: 0.1, per: 0.02 }
  },
  business: {
    name: 'Compound Interest',
    icon: '💰',
    blurb: "The team gains permanent attack every round — the rate climbs with each business card.",
    n: { ramp: 0.01 }
  },
  religion: {
    name: 'Divine Shield',
    icon: '✨',
    blurb: "The first enemy hit each fight simply doesn't land — a second is turned aside with 3+ religion cards.",
    n: { twoAt: 3 }
  },
  plants: {
    name: 'Fast Bloom',
    icon: '🌱',
    blurb: 'Bloom charges one round faster per plants card, and every bloom heals the team for half its damage.',
    n: { delayCutPer: 1, minDelay: 1, healFrac: 0.5 }
  },
  scientists: {
    name: 'Grant Funding',
    icon: '🧪',
    blurb: "Breakthrough's attack ramp is +2% steeper per scientists card, and the team heals 3 a round.",
    n: { rampPer: 0.02, regen: 3 }
  },
  disease: {
    name: 'Superspreader',
    icon: '🦠',
    blurb: "Contagion's round-on-round growth is multiplied by the number of disease cards. It becomes unsurvivable.",
    n: {}
  },
  vehicles: {
    name: 'Fleet',
    icon: '🚗',
    blurb: 'Overdrive charges one round faster for every vehicles card (down to every 2 rounds).',
    n: { delayCutPer: 1, minDelay: 2 }
  }
};

export type SignatureTheme = keyof typeof SIGNATURES;
