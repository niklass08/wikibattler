import { describe, it, expect } from 'vitest';
import {
  applyResult,
  expectedScore,
  kFactor,
  scoreFromOutcome,
  isRanked,
  ELO_START,
  MAX_DELTA,
  PROVISIONAL_K_GAMES,
  RANKED_MIN_GAMES
} from '../src/lib/arena/elo';

describe('expectedScore', () => {
  it('is 0.5 for equal ratings', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
  });
  it('rises with a rating lead and the two sides sum to 1', () => {
    const hi = expectedScore(1600, 1200);
    const lo = expectedScore(1200, 1600);
    expect(hi).toBeGreaterThan(0.5);
    expect(hi + lo).toBeCloseTo(1);
  });
});

describe('kFactor', () => {
  it('is provisional below the threshold, steady at or above it', () => {
    expect(kFactor(0)).toBe(64);
    expect(kFactor(PROVISIONAL_K_GAMES - 1)).toBe(64);
    expect(kFactor(PROVISIONAL_K_GAMES)).toBe(32);
    expect(kFactor(500)).toBe(32);
  });
});

describe('applyResult', () => {
  it('equal ratings, a win → +½K, a loss → −½K, and they mirror', () => {
    const win = applyResult({ rating: ELO_START, games: 20 }, { rating: ELO_START, games: 20 }, 1);
    const loss = applyResult({ rating: ELO_START, games: 20 }, { rating: ELO_START, games: 20 }, 0);
    expect(win.delta).toBe(16); // 32 * (1 - 0.5)
    expect(loss.delta).toBe(-16);
    expect(win.games).toBe(21);
  });

  it('a draw between equals is a no-op', () => {
    const r = applyResult({ rating: 1300, games: 30 }, { rating: 1300, games: 30 }, 0.5);
    expect(r.delta).toBe(0);
    expect(r.rating).toBe(1300);
  });

  it('beating a much stronger player is worth close to a full K', () => {
    const r = applyResult({ rating: 1000, games: 40 }, { rating: 2000, games: 40 }, 1);
    expect(r.delta).toBeGreaterThan(28);
    expect(r.delta).toBeLessThanOrEqual(MAX_DELTA);
  });

  it('never moves a rating by more than MAX_DELTA', () => {
    const huge = applyResult({ rating: 100, games: 0 }, { rating: 3000, games: 0 }, 1);
    expect(Math.abs(huge.delta)).toBeLessThanOrEqual(MAX_DELTA);
  });

  it('provisional players swing harder than settled ones', () => {
    const prov = applyResult({ rating: 1200, games: 2 }, { rating: 1200, games: 2 }, 1);
    const settled = applyResult({ rating: 1200, games: 50 }, { rating: 1200, games: 50 }, 1);
    expect(prov.delta).toBeGreaterThan(settled.delta);
  });
});

describe('helpers', () => {
  it('maps outcomes to scores', () => {
    expect(scoreFromOutcome('win')).toBe(1);
    expect(scoreFromOutcome('draw')).toBe(0.5);
    expect(scoreFromOutcome('loss')).toBe(0);
  });
  it('ranks players at or above the minimum games', () => {
    expect(isRanked(RANKED_MIN_GAMES)).toBe(true);
    expect(isRanked(RANKED_MIN_GAMES + 5)).toBe(true);
    if (RANKED_MIN_GAMES > 0) expect(isRanked(RANKED_MIN_GAMES - 1)).toBe(false);
  });
});
