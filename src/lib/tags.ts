/**
 * Thematic tags for a card, derived from the article's Wikipedia categories
 * (with the plain-text extract as a weak tie-breaker). Pure and unit-tested.
 *
 * Categories are granular ("1994 films", "Films set in Los Angeles", …) but very
 * keyword-able; each theme is a regex, the score is how many categories it hits,
 * and a card keeps its top few.
 */

export const TAGS = [
  'cinema',
  'music',
  'sport',
  'politics',
  'war',
  'history',
  'science',
  'geography',
  'arts',
  'games',
  'nature',
  'business',
  'religion',
  'plants',
  'scientists',
  'disease',
  'vehicles'
] as const;

export type Tag = (typeof TAGS)[number];

/**
 * Bump whenever the theme rules change enough that already-tagged cards should
 * be re-derived. The collection view re-sweeps every card once when it sees a
 * newer rev than it last recorded. (1 = original 13 themes; 2 = + plants,
 * scientists, disease, vehicles.)
 */
export const TAG_REV = 3;

export const TAG_LABEL: Record<Tag, string> = {
  cinema: 'Cinema',
  music: 'Music',
  sport: 'Sport',
  politics: 'Politics',
  war: 'War',
  history: 'History',
  science: 'Science',
  geography: 'Geography',
  arts: 'Arts',
  games: 'Games',
  nature: 'Nature',
  business: 'Business',
  religion: 'Religion',
  plants: 'Plants',
  scientists: 'Scientists',
  disease: 'Disease',
  vehicles: 'Vehicles'
};

/** Categories that say nothing about the topic — dropped before matching. */
const CATEGORY_NOISE =
  /(\d{4}s? (births|deaths|establishments|disestablishments|debuts|introductions)|living people|articles |wikipedia |^cs1|webarchive|use [a-z]+ dates|use [a-z]+ english|coordinates|short description|pages |redirects|stub|commons category|good articles|featured articles|all articles|people from|surnames|given names)/i;

const RULES: Record<Tag, RegExp> = {
  cinema:
    /\b(films?|filmmak|cinema|movies?|screenwrit|film directors?|film producers?|actors?|actress|television series|tv series|sitcoms?|animated (films?|series)|anime|documentar|miniseries|soap operas?)\b/i,
  music:
    /\b(albums?|songs?|singles|singers?|musicians?|bands?|discograph|record labels?|musical groups?|composers?|rappers?|guitarists?|drummers?|pianists?|orchestras?|operas?|hip hop|jazz|rock music|pop music)\b/i,
  sport:
    /\b(sports?|football|soccer|basketball|baseball|ice hockey|olympic|athletes?|footballers?|sportspeople|tennis|cricket|rugby|boxing|championships?|leagues?|racing drivers?|golf|swimmers?|cyclists?|wrestl|f1|formula one|nba|nfl|fifa)\b/i,
  politics:
    /\b(politic|governments?|presidents? of|prime ministers?|senators?|parliament|elections?|political part|monarchs?|kings? of|queens? of|emperors?|diplomats?|heads of (state|government)|legislat|ministers?|mayors?|governors?|ambassadors?|activists?)\b/i,
  war: /\b(wars?|battles?|militar|armies|navies|air forces?|armed conflicts?|sieges?|treaties|weapons?|firearms?|regiments?|generals?|admirals?|soldiers?|warships?|aircraft carriers?|nuclear weapons?|world war)\b/i,
  history:
    /\b(history|historical|ancient|classical antiquity|medieval|middle ages|early modern|centur|empires?|dynast|kingdoms? of|\bBCE?\b|revolutions?|archaeolog|prehistor|colonial|1[0-9]{2}0s\b)\b/i,
  science:
    /\b(physics|chemistry|chemical (elements?|compounds?|reactions?)|biology|biological|mathematics|astronomy|astrophysics|cosmology|geology|technology|engineering|computing|computer science|thermodynamics|quantum|relativity|evolution|genetics|neuroscience|scientific theor|theorems?|equations?|particles?|space missions?|nasa|inventions?)\b/i,
  geography:
    /\b(geography|cities|towns|villages|municipalities|countries|sovereign states?|rivers?|mountains?|volcano|lakes?|seas?|oceans?|islands?|deserts?|regions?|provinces?|states? of|capitals?|populated places|landmarks?|national parks?|world heritage sites?|districts?|counties)\b/i,
  arts:
    /\b(paintings?|painters?|sculpt|visual artists?|art movements?|art museums?|architect|literature|novels?|novelists?|writers?|authors?|poets?|poetry|short stories|books?|plays?|playwrights?|fiction|literary|photographers?|fashion designers?)\b/i,
  games:
    /\b(video games?|board games?|card games?|tabletop games?|video game (developers?|publishers?|companies)|game designers?|esports?|role-playing games?|first-person shooters?|platform games?|nintendo|playstation|xbox)\b/i,
  nature:
    /\b(animals?|plants?|fungi|species|genera|taxa|birds?|mammals?|reptiles?|amphibians?|fish|insects?|arachnids?|molluscs?|moths?|butterflies|beetles?|spiders?|snakes?|orchids?|ferns?|flora|fauna|trees?|flowers?|ecosystems?|botany|zoolog|ornitholog|entomolog|endangered|dinosaurs?|prehistoric life|breeds?|described in \d{4}|\w{4,}(idae|aceae)\b)\b/i,
  business:
    /\b(compan|corporations?|businesses|brands?|economics?|economies|banks?|financial|entrepreneurs?|businesspeople|manufacturers?|industries|multinational|startups?|billionaires?|stock exchanges?|trade)\b/i,
  religion:
    /\b(religio|christian|catholic|protestant|islam|muslim|hindu|buddhis|judais|jewish|churches|temples|mosques|cathedrals?|saints?|popes?|bishops?|clergy|theolog|mytholog|deities|gods?|goddess|monaster)\b/i,
  plants:
    /\b(flowering plants?|\bplants?\b|trees?|shrubs?|ferns?|mosses|orchids?|grasses|vines?|cacti|cactus|wildflowers?|conifers?|angiosperms?|gymnosperms?|edible plants?|medicinal plants?|crops?|\w{3,}aceae\b)\b/i,
  scientists:
    /\b(scientists?|physicists?|chemists?|biologists?|mathematicians?|astronomers?|researchers?|nobel laureates in (physics|chemistry|medicine)|inventors?|naturalists?|geologists?|neuroscientists?|geneticists?|zoologists?|botanists?|microbiologists?|palaeontologists?|paleontologists?)\b/i,
  disease:
    /\b(diseases?|infectious diseases?|viral infections?|bacterial infections?|viruses|virology|pathogens?|cancers?|carcinomas?|tumou?rs?|leukaemias?|leukemias?|epidemics?|pandemics?|plagues?|influenza|malaria|tuberculosis|cholera|smallpox|measles|\bebola\b|hiv\/aids|hepatitis|parasitic diseases?)\b/i,
  vehicles:
    /\b(vehicles?|automobiles?|\bcars?\b|trucks?|motorcycles?|aircraft|airplanes?|airliners?|helicopters?|\bships?\b|\bboats?\b|submarines?|locomotives?|\btrains?\b|spacecraft|rockets?|\btanks?\b|\bjets?\b|sedans?)\b/i
};

/**
 * "Specialist" battle themes — narrow enough that a single stray category hit
 * shouldn't earn them as a secondary tag. See deriveTags below.
 */
const SPECIALIST = new Set<Tag>(['plants', 'scientists', 'disease', 'vehicles']);

/**
 * Up to `max` themes for a card, most-supported first. Empty when nothing
 * matches confidently (a niche stub, say).
 */
export function deriveTags(categories: string[], extract = '', max = 4): Tag[] {
  const cats = categories
    .map((c) => c.replace(/^Category:/, '').trim())
    .filter((c) => c && !CATEGORY_NOISE.test(c));

  const catText = cats.join(' · ').toLowerCase();
  const extraText = extract.toLowerCase();

  const scored = TAGS.map((tag) => {
    const rx = new RegExp(RULES[tag].source, 'gi');
    const catHits = (catText.match(rx) ?? []).length;
    const extractHits = catHits === 0 ? Math.min((extraText.match(rx) ?? []).length, 1) : 0;
    return { tag, score: catHits * 2 + extractHits };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];

  // Keep the top theme; keep further themes only when they're well-supported
  // (≥ 2 category hits) or close to the leader — this drops tangential matches
  // like a baseball player's lone "…Korean War veterans" category.
  const top = scored[0].score;
  return scored
    .filter((s, i) => {
      if (i === 0) return true;
      if (!(s.score >= 4 || s.score >= top * 0.5)) return false;
      // a "specialist" theme as a *secondary* needs real category support — not
      // one stray hit like a film's "…due to the COVID-19 pandemic" category
      if (SPECIALIST.has(s.tag)) return s.score >= 6;
      return true;
    })
    .slice(0, max)
    .map((s) => s.tag);
}
