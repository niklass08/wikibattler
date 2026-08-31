/**
 * Split a card into one of two battle roles from its article prose:
 *
 *   'living'   — a person or an organism: it can throw a punch, so it adds its
 *                Strength to the team's attack.
 *   'abstract' — a work, place, organisation, event or concept: it never
 *                attacks, but it sits on the field as terrain and contributes a
 *                passive environmental effect (see effects.ts).
 *
 * Every card still adds its Defence to the shared HP pool whichever way it lands.
 *
 * The signal is the opening of the Wikipedia extract ("X is a species of…", "X
 * (born 1975) is a footballer…"), with the thematic tags as a weak backstop.
 * It is a heuristic — an experimental-mode nicety, not a load-bearing rule.
 */
import type { Card } from '../types';
import type { Tag } from '../tags';

export type Role = 'living' | 'abstract';

/** Pictogram + label per role, for the card strip and the arena. */
export const ROLE_META: Record<Role, { icon: string; label: string }> = {
  living: { icon: '⚔️', label: 'Fighter' },
  abstract: { icon: '✦', label: 'Field' }
};

/** A person: birth/death parenthetical, or "is/was a <occupation>". */
const PERSON =
  /\(born\s|\(\d{3,4}\s*[–-]\s*\d{3,4}\)|\b(?:is|was)\s+(?:a|an|the)\s+[^.]{0,48}\b(player|footballer|actor|actress|singer|songwriter|rapper|musician|guitarist|drummer|pianist|composer|conductor|politician|statesman|president|senator|governor|mayor|minister|king|queen|emperor|empress|monarch|prince|princess|pope|bishop|saint|writer|author|poet|novelist|playwright|journalist|philosopher|historian|scientist|physicist|chemist|biologist|mathematician|astronomer|economist|engineer|inventor|architect|painter|sculptor|artist|photographer|filmmaker|director|producer|screenwriter|dancer|choreographer|model|chef|athlete|sprinter|runner|cyclist|swimmer|boxer|wrestler|gymnast|skater|golfer|driver|pilot|astronaut|soldier|general|admiral|officer|commander|activist|revolutionary|entrepreneur|businessman|businesswoman|magnate|explorer|nurse|physician|doctor|lawyer|judge)s?\b/i;

/** An organism: "is a species of…", "a genus of…", or a plain animal/plant noun. */
const ORGANISM =
  /\b(?:is|was|are)\s+(?:a|an)\s+[^.]{0,32}\b(species|genus|subspecies|breed|family|order|clade|taxon)\s+of\b|\b(?:is|was)\s+(?:a|an)\s+[^.]{0,24}\b(mammal|bird|fish|reptile|amphibian|insect|arachnid|mollusc|crustacean|arthropod|animal|carnivore|herbivore|omnivore|predator|rodent|primate|marsupial|cetacean|felid|canid|ungulate|plant|tree|shrub|herb|flower|grass|fern|moss|fungus|alga|bacterium)\b/i;

/** Tags that lean animate when the prose is inconclusive. */
const LIVING_TAGS = new Set<Tag>(['nature', 'animals', 'plants']);
/** Tags that are almost always a work / place / institution / event. */
const ABSTRACT_TAGS = new Set<Tag>(['cinema', 'music', 'geography', 'business', 'games']);

export function classifyCard(
  card: Pick<Card, 'extract' | 'tags'> & { battleRole?: Role }
): Role {
  // A decoded arena defence ships the role directly — the extract it was derived
  // from isn't transmitted. Pack-opened cards never set this, so nothing changes
  // for the normal path.
  if (card.battleRole === 'living' || card.battleRole === 'abstract') return card.battleRole;

  const text = card.extract ?? '';

  if (PERSON.test(text) || ORGANISM.test(text)) return 'living';

  const tags = (card.tags ?? []) as Tag[];
  if (tags.some((t) => ABSTRACT_TAGS.has(t))) return 'abstract';
  if (tags.some((t) => LIVING_TAGS.has(t))) return 'living';

  // Anything left — most "X is a …" leads are works, places or concepts.
  return 'abstract';
}
