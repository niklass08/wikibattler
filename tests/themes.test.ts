import { describe, it, expect } from 'vitest';
import { THEMES, isTag } from '../src/lib/themes';
import { TAGS, TAG_LABEL } from '../src/lib/tags';
import { SIGNATURES } from '../src/lib/battle/signatures.config';

describe('THEMES', () => {
  it('has a complete entry for every tag', () => {
    for (const t of TAGS) {
      const d = THEMES[t];
      expect(d, t).toBeTruthy();
      expect(d.label.length, t).toBeGreaterThan(0);
      expect(d.icon.length, t).toBeGreaterThan(0);
      expect(d.color, t).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('has one distinct colour per theme', () => {
    const colors = TAGS.map((t) => THEMES[t].color.toLowerCase());
    expect(new Set(colors).size).toBe(TAGS.length);
  });

  it('keeps label and icon in sync with the canonical sources', () => {
    for (const t of TAGS) {
      expect(THEMES[t].label, t).toBe(TAG_LABEL[t]);
      expect(THEMES[t].icon, t).toBe(SIGNATURES[t].icon);
    }
  });

  it('isTag narrows real tags only', () => {
    expect(isTag('cinema')).toBe(true);
    expect(isTag('random')).toBe(false);
    expect(isTag('')).toBe(false);
  });
});
