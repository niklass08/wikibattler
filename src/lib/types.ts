export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic'];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic'
};

/** Compact rarity mark shown in the card corner. */
export const RARITY_GLYPH: Record<Rarity, string> = {
  common: '●', // ●
  uncommon: '◆', // ◆
  rare: '✦', // ✦
  mythic: '✹' // ✹
};

/**
 * Holographic finish, independent of rarity. 0 = plain; 1–3 escalate from a
 * subtle shimmer to a full prismatic treatment. Rolled per pack in foil.ts.
 */
export type FoilTier = 0 | 1 | 2 | 3;

export const FOIL_LABEL: Record<Exclude<FoilTier, 0>, string> = {
  1: 'Shimmer',
  2: 'Radiant',
  3: 'Cosmic'
};

/**
 * Negated finish — a separate rarity axis that completes the foil system.
 * Rolled per card, independently of foil and at a tenth of the foil chance; a
 * card can be both foil and negated. A negated card renders with its colours
 * (and its foil's colours) inverted. See foil.ts.
 */
export const NEGATED_LABEL = 'Negated';

/** Raw, un-normalised measurements taken from the Wikimedia APIs. */
export interface CardRaw {
  /** Count of internal mainspace links in the article. Drives strength. */
  links: number;
  /** Wikitext byte length of the article. Drives defence. */
  bytes: number;
  /** Average monthly pageviews (agent=user). Drives rarity. */
  monthlyViews: number;
}

export interface Card {
  /** Wikipedia pageid — stable primary key. */
  id: number;
  title: string;
  url: string;
  /** Short plain-text intro, used as flavour text on the detail view. */
  extract: string;
  /** Lead-image thumbnail URL, or null for a typographic card. */
  image: string | null;
  rarity: Rarity;
  /** Normalised 1–99. */
  strength: number;
  /** Normalised 1–99. */
  defence: number;
  /** Holographic finish (rarity-independent). 0 for the vast majority of cards. */
  foil: FoilTier;
  /**
   * Negated finish — colours inverted. Rolled per card, independent of foil and
   * far rarer. false for all but a sliver of cards.
   */
  negated: boolean;
  /** Thematic tags (cinema, politics, …) from the article's categories. See tags.ts. */
  tags: string[];
  raw: CardRaw;
}

/** A card as it sits in the player's collection. Card data is stored inline —
 * there is no static pool to look it up in, cards come from the live API. */
export interface OwnedEntry {
  count: number;
  firstOpenedAt: string;
  card: Card;
}

export type Collection = Record<number, OwnedEntry>;

/** A card plus per-pack presentation flags. */
export interface PulledCard {
  card: Card;
  isNew: boolean;
}
