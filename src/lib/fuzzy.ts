// Small fuzzy matcher for the card search box. Scores how well a query's
// characters appear, in order, inside a target string — a subsequence match
// with bonuses for consecutive runs and for hits at word boundaries, so
// "qt" finds "Quentin Tarantino" and "star wars" beats "starfish war".

export interface FuzzyMatch {
  /** higher is better; only meaningful when `hit` is true */
  score: number;
  hit: boolean;
}

const isBoundary = (ch: string | undefined): boolean =>
  ch === undefined || ch === ' ' || ch === '-' || ch === '_' || ch === ':' || ch === '(';

/**
 * Match `query` against `target`. Both are compared case-insensitively.
 * An empty query always matches with score 0.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, hit: true };

  const t = target.toLowerCase();

  // Fast path: a contiguous substring is the best possible match.
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const boundary = isBoundary(t[idx - 1]);
    return { score: 1000 - idx + (boundary ? 30 : 0) + (idx === 0 ? 20 : 0), hit: true };
  }

  let score = 0;
  let ti = 0;
  let run = 0;
  let matched = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const qc = q[qi];
    let found = -1;
    for (let k = ti; k < t.length; k++) {
      if (t[k] === qc) {
        found = k;
        break;
      }
    }
    if (found === -1) return { score: 0, hit: false };

    matched++;
    score += 10;
    if (found === ti) {
      run++;
      score += run * 5; // reward consecutive characters
    } else {
      run = 0;
      score -= Math.min(found - ti, 10); // penalise gaps, but not unboundedly
    }
    if (isBoundary(t[found - 1])) score += 15; // hit at a word start
    ti = found + 1;
  }

  // prefer shorter targets when the score is otherwise close
  score -= Math.floor(t.length / 20);
  return { score, hit: matched === q.length };
}

/** Convenience for `Array.filter` — true when `query` fuzzily matches `target`. */
export const fuzzyIncludes = (query: string, target: string): boolean =>
  fuzzyMatch(query, target).hit;
