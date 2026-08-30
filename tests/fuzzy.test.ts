import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyIncludes } from '../src/lib/fuzzy';

describe('fuzzyMatch', () => {
  it('matches an empty query against anything', () => {
    expect(fuzzyMatch('', 'Quentin Tarantino').hit).toBe(true);
    expect(fuzzyMatch('   ', 'Quentin Tarantino').hit).toBe(true);
  });

  it('matches contiguous substrings case-insensitively', () => {
    expect(fuzzyIncludes('taran', 'Quentin Tarantino')).toBe(true);
    expect(fuzzyIncludes('TARAN', 'Quentin Tarantino')).toBe(true);
  });

  it('matches out-of-order subsequences like initials', () => {
    expect(fuzzyIncludes('qt', 'Quentin Tarantino')).toBe(true);
    expect(fuzzyIncludes('star wars', 'Star Wars: The Last Jedi')).toBe(true);
  });

  it('rejects characters that are not present in order', () => {
    expect(fuzzyIncludes('xyz', 'Quentin Tarantino')).toBe(false);
    expect(fuzzyIncludes('tarq', 'Quentin Tarantino')).toBe(false);
  });

  it('ranks a prefix / word-start hit above a scattered one', () => {
    const strong = fuzzyMatch('star', 'Star Wars').score;
    const weak = fuzzyMatch('star', 'Sebastian Tarrant').score;
    expect(strong).toBeGreaterThan(weak);
  });

  it('ranks an exact contiguous hit above a gapped subsequence', () => {
    const contiguous = fuzzyMatch('back', 'Backdraft').score;
    const gapped = fuzzyMatch('back', 'Blackbeard the Pirate').score;
    expect(contiguous).toBeGreaterThan(gapped);
  });
});
