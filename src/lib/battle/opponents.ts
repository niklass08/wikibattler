import type { Opponent } from './engine';

/**
 * The goldfish — a practice dummy. It has a three-second memory, no strategy and
 * barely a bite. Any team with a single fighter beats it; it exists so a new
 * player can watch the pool, the roles and the log do their thing before a real
 * opponent shows up.
 */
export const GOLDFISH: Opponent = {
  id: 'goldfish',
  name: 'Goldfish',
  blurb: 'It circles the bowl, forgets it has circled the bowl, and circles again. It will flop at you, gently.',
  maxHp: 250,
  attack: 12
};

export const OPPONENTS: Opponent[] = [GOLDFISH];
