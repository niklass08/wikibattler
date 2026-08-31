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
    expect: 'plants'
  },
  // a bot-written species stub — the shape most plants and animals actually take
  'Iberodorcadion aries': {
    cats: ['Beetles described in 1999', 'Cerambycidae stubs', 'Lamiini'],
    expect: 'animals'
  },
  'Phacelia hubbyi': {
    cats: ['Flora of California', 'Hydrophyllaceae stubs', 'Phacelia', 'Plants described in 1917'],
    expect: 'plants'
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
  },
  Ebola: {
    cats: [
      'Ebola',
      'Biological weapons',
      'Hemorrhagic fevers',
      'Viral diseases',
      'Zoonoses',
      'Tropical diseases'
    ],
    expect: 'disease'
  },
  'Boeing 747': {
    cats: [
      'Boeing 747',
      '1960s United States airliners',
      'Quadjets',
      'Wide-body aircraft',
      'Low-wing aircraft',
      'Aircraft first flown in 1969'
    ],
    expect: 'vehicles'
  },
  'Marie Curie': {
    cats: [
      '1867 births',
      'French physicists',
      'French chemists',
      'Nobel laureates in Physics',
      'Nobel laureates in Chemistry',
      'Women physicists'
    ],
    expect: 'scientists'
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

  it('keeps a taxonomic stub category, drops every other kind', () => {
    // on a species stub the stub category is often the most specific one there
    // is, and the page only has three or four to begin with
    expect(deriveTags(['Cerambycidae stubs'])).toContain('animals');
    expect(deriveTags(['Lamiaceae stubs'])).toContain('plants');
    expect(deriveTags(['Spanish football club stubs'])).toEqual([]);
  });

  it('gives a species article both the umbrella theme and its kingdom', () => {
    const moth = deriveTags([
      'Animal taxa named by Carl Linnaeus',
      'Moths described in 1758',
      'Olethreutini',
      'Tortricidae of Europe'
    ]);
    expect(moth).toContain('animals');
    expect(moth).toContain('nature');
    expect(moth).not.toContain('plants');

    const plant = deriveTags([
      'Botanical taxa named by Carl Linnaeus',
      'Caryophyllaceae stubs',
      'Flora of Siberia',
      'Plants described in 1753'
    ]);
    expect(plant).toContain('plants');
    expect(plant).not.toContain('animals');
  });

  it('lets plants ride along as a secondary theme', () => {
    // it used to be gated as a "specialist", which needed three category hits —
    // more than a species stub carries, so the theme never landed on one
    const tags = deriveTags(['Flora of California', 'Phacelia', 'Plants described in 1917']);
    expect(tags).toContain('plants');
  });

  it('will not hang a secondary theme on the extract alone', () => {
    // "adapted for life in tropical forests … among tree tops" — a monkey is not
    // a plant, and the extract is only a tie-breaker for the leading theme
    const tags = deriveTags(
      ['Animal taxa named by Carl Linnaeus', 'Primates'],
      'Primates arose from small terrestrial mammals which adapted to life among tree tops.'
    );
    expect(tags).toContain('animals');
    expect(tags).not.toContain('plants');
  });

  it('leaves a zoologist with the scientists theme, not the animals one', () => {
    const tags = deriveTags([
      '20th-century German zoologists',
      'German zoologist stubs',
      'University of Freiburg faculty'
    ]);
    expect(tags).toContain('scientists');
    expect(tags).not.toContain('animals');
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

  it('does not give a film a specialist theme from one stray category', () => {
    // Avatar: Fire and Ash — a film with two production-history covid categories
    const tags = deriveTags([
      '2025 science fiction films',
      '2025 American films',
      'American epic films',
      'Films directed by James Cameron',
      'American sequel films',
      'Film productions suspended due to the COVID-19 pandemic',
      'Films postponed due to the COVID-19 pandemic'
    ]);
    expect(tags[0]).toBe('cinema');
    expect(tags).not.toContain('disease');
  });

  it('a disease that is also historic still leads or co-leads with disease', () => {
    const tags = deriveTags([
      'Black Death',
      '14th-century disease outbreaks',
      'Plague (disease)',
      'Pandemics',
      'Medieval health disasters',
      'Second plague pandemic'
    ]);
    expect(tags).toContain('disease');
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
