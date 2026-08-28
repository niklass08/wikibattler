export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic';

export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'mythic'];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic'
};

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
  raw: CardRaw;
}

export interface PoolsFile {
  generatedAt: string;
  project: string;
  thresholds: { uncommon: number; rare: number; mythic: number };
  cards: Card[];
}

/** A card as it sits in the player's collection. */
export interface OwnedEntry {
  count: number;
  firstOpenedAt: string;
}

export type Collection = Record<number, OwnedEntry>;

/** A card plus per-pack presentation flags. */
export interface PulledCard {
  card: Card;
  isNew: boolean;
}
