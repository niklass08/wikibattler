/**
 * Elo rating for the Arena ladder. One rating per player, used whether their
 * team is attacking or defending. Pure — the Firestore transaction in
 * `ladder.ts` feeds it both sides' current numbers and writes back the results.
 *
 * Small-sample safeguards live around this, not in it: only the first resolved
 * attack of an (attacker → defender) pair is rated (see `ladder.ts`), a new
 * rating converges fast for its first `PROVISIONAL_K_GAMES`, players below
 * `RANKED_MIN_GAMES` are hidden from the board, and every rating step is clamped
 * to `MAX_DELTA` so one lucky result can't spike a rating.
 */

export const ELO_START = 1200;
/** Rated games a player needs before they appear on the leaderboard. */
export const RANKED_MIN_GAMES = 0;
/** Rated games of fast (high-K) convergence for a new rating. */
export const PROVISIONAL_K_GAMES = 10;
/** Hard cap on a single result's rating swing. Must equal the Firestore rules bound. */
export const MAX_DELTA = 48;

export type Score = 0 | 0.5 | 1;

/** Fast while a rating is still finding its level, steady afterwards. */
export function kFactor(games: number): number {
  return games < PROVISIONAL_K_GAMES ? 64 : 32;
}

/** Probability `self` beats `opp` under Elo. */
export function expectedScore(rSelf: number, rOpp: number): number {
  return 1 / (1 + 10 ** ((rOpp - rSelf) / 400));
}

export interface Rated {
  rating: number;
  games: number;
}

export interface RatedStep extends Rated {
  /** signed rating change actually applied (post-clamp) */
  delta: number;
}

/**
 * One side's rating after a resolved game. `scoreSelf` is 1 for a win, 0.5 for a
 * draw, 0 for a loss. The opponent's mirror call passes `1 - scoreSelf`.
 */
export function applyResult(self: Rated, opp: Rated, scoreSelf: Score): RatedStep {
  const raw = kFactor(self.games) * (scoreSelf - expectedScore(self.rating, opp.rating));
  const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(raw)));
  return {
    rating: self.rating + delta,
    games: self.games + 1,
    delta
  };
}

/** The attacker's score from a battle outcome (from the attacker's perspective). */
export function scoreFromOutcome(outcome: 'win' | 'loss' | 'draw'): Score {
  return outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
}

export const isRanked = (games: number): boolean => games >= RANKED_MIN_GAMES;
