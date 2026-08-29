/**
 * Mythic signatures. Every mythic card rolls one signature ability the moment
 * it's pulled and keeps it for good. The roll leans toward the card's own
 * themes (SIGNATURE_LEAN of the time) and is otherwise uniform across all 17.
 *
 * `rng` is injectable so tests and the daily-pack style features stay
 * deterministic.
 */
import type { Card } from './types';
import type { Rng } from './pack';
import { TAGS, type Tag } from './tags';
import { SIGNATURE_LEAN } from './odds';

const isTag = (s: string): s is Tag => (TAGS as readonly string[]).includes(s);

/** Roll a signature theme for one card. */
export function rollSignature(card: Card, rng: Rng = Math.random): Tag {
  const own = (card.tags ?? []).filter(isTag);
  if (own.length > 0 && rng() < SIGNATURE_LEAN) {
    return own[Math.floor(rng() * own.length)];
  }
  return TAGS[Math.floor(rng() * TAGS.length)];
}

/** Give every un-signed mythic in a freshly opened pack its signature. */
export function applyMythicSignatures(cards: Card[], rng: Rng = Math.random): Card[] {
  return cards.map((c) =>
    c.rarity === 'mythic' && !c.signature ? { ...c, signature: rollSignature(c, rng) } : c
  );
}
