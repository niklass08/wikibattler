import type { Opponent } from './engine';

/**
 * The goldfish — a practice dummy. No strategy, only a feeble flop for a hit,
 * but a deceptive amount of HP: a goldfish is mostly water and takes a great
 * deal of convincing to fall over. It exists so a new player can watch the
 * pool, the roles and the combat log do their thing across a real handful of
 * rounds before a proper opponent shows up.
 */
export const GOLDFISH: Opponent = {
  id: 'goldfish',
  name: 'Goldfish',
  blurb: 'It looks flimsy. It is not — 90% water, no vital organs it seems willing to admit to, and all the time in the world.',
  maxHp: 6000,
  attack: 45
};

export const OPPONENTS: Opponent[] = [GOLDFISH];
