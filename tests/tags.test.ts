import { describe, it, expect } from 'vitest';
import { deriveTags, TAGS } from '../src/lib/tags';

// real (truncated) category sets from en.wikipedia
const FIXTURES: Record<string, { cats: string[]; expect: string; extract?: string }> = {
  'Quentin Tarantino': {
    cats: [
      '1963 births',
      '20th-century American male actors',
      '20th-century American screenwriters',
      'American male screenwriters',
      'Film directors from Tennessee',
      'American film producers',
      'Living people'
    ],
    expect: 'cinema'
  },
  'Angela Merkel': {
    cats: [
      '1954 births',
      '20th-century German politicians',
      '20th-century German chemists',
      '21st-century German women politicians',
      'Chancellors of Germany',
      'Female heads of government',
      'Leaders of the Christian Democratic Union of Germany'
    ],
    expect: 'politics'
  },
  'Mount Kilimanjaro': {
    cats: [
      'Dormant volcanoes',
      'Geography of Kilimanjaro Region',
      'Five-thousanders of Africa',
      'Highest points of countries',
      'Mountains of Tanzania',
      'Volcanoes of Tanzania'
    ],
    expect: 'geography'
  },
  'Battle of Hastings': {
    cats: [
      '1066 conflicts',
      'Battles involving the Anglo-Saxons',
      'Battles involving the Kingdom of England',
      'Battles involving the Normans',
      'History of East Sussex',
      'Norman conquest of England'
    ],
    expect: 'war'
  },
  'The Dark Side of the Moon': {
    cats: [
      '1970s concept albums',
      '1973 albums',
      'Albums produced by David Gilmour',
      'Pink Floyd albums',
      'Harvest Records albums',
      'Capitol Records albums'
    ],
    expect: 'music'
  },
  'The Legend of Zelda: Tears of the Kingdom': {
    cats: [
      '2023 video games',
      'Action-adventure games',
      'Fantasy video games',
      'Nintendo Switch games',
      'The Legend of Zelda video games',
      'Single-player video games'
    ],
    expect: 'games'
  },
  'Eintracht Frankfurt': {
    cats: [
      '1899 establishments in Germany',
      'Association football clubs established in 1899',
      'Bundesliga clubs',
      'Football clubs in Frankfurt',
      'Sports clubs in Germany'
    ],
    expect: 'sport'
  },
  'Pablo Picasso': {
    cats: [
      '1881 births',
      '20th-century Spanish painters',
      '20th-century Spanish sculptors',
      'Cubism',
      'Modern painters',
      'Spanish male painters'
    ],
    expect: 'arts'
  },
  Photosynthesis: {
    cats: ['Biological processes', 'Botany', 'Cellular respiration', 'Metabolism', 'Plant nutrition'],
    expect: 'nature'
  },
  'Apple Inc.': {
    cats: [
      '1976 establishments in California',
      'American brands',
      'Computer companies of the United States',
      'Multinational companies headquartered in the United States',
      'Technology companies of the United States'
    ],
    expect: 'business'
  }
};

describe('deriveTags', () => {
  it('classifies real articles by their dominant theme', () => {
    for (const [title, f] of Object.entries(FIXTURES)) {
      const tags = deriveTags(f.cats, f.extract ?? '');
      expect(tags, `${title} -> ${tags.join(',')}`).toContain(f.expect);
      expect(tags[0], `${title} top tag`).toBe(f.expect);
    }
  });

  it('returns at most 4 tags, all valid', () => {
    const tags = deriveTags(FIXTURES['Angela Merkel'].cats);
    expect(tags.length).toBeLessThanOrEqual(4);
    for (const t of tags) expect(TAGS).toContain(t);
  });

  it('returns nothing for a themeless stub', () => {
    expect(deriveTags(['1998 establishments', 'Organisations based in Belgium'])).toEqual([]);
  });

  it('ignores maintenance / date categories', () => {
    const tags = deriveTags(['1963 births', 'Living people', 'Articles with hCards']);
    expect(tags).toEqual([]);
  });

  it('drops tangential single-hit secondary themes', () => {
    // a baseball player with one Jewish + one military-service category
    const tags = deriveTags([
      'Major League Baseball pitchers',
      'Los Angeles Dodgers players',
      'Brooklyn Dodgers players',
      'National Baseball Hall of Fame inductees',
      'Jewish American baseball players',
      'United States Army soldiers'
    ]);
    expect(tags).toEqual(['sport']);
  });

  it('keeps multiple themes when each is well supported', () => {
    const tags = deriveTags([
      'Battles of the American Civil War',
      'Conflicts in 1863',
      '19th-century military history of the United States',
      'Presidency of Abraham Lincoln',
      'Political history of the United States'
    ]);
    expect(tags).toContain('war');
    expect(tags.length).toBeGreaterThan(1);
  });
});
