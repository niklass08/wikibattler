/**
 * Per-theme metadata for thematic packs: display label + icon, the accent colour
 * that colour-codes the pack, and the full-text search query that sources
 * on-theme candidates (`wiki.searchEnriched` → `generator=search`).
 *
 * Colour is the single source of truth — components apply it via inline
 * `style:--accent`, so `tokens.css` stays untouched. Icons are declared here
 * (not imported from the battle config) to keep the pack path off battle code;
 * `tests/themes.test.ts` asserts they stay in sync with the signature icons.
 */
import { TAGS, TAG_LABEL, type Tag } from './tags';

export interface ThemeDef {
  label: string;
  icon: string;
  /** hex — the pack's colour code */
  color: string;
  /**
   * Infobox templates that mark an article as belonging to this theme. An
   * infobox is an authoritative topic signal, far cleaner than keyword matching.
   *
   * A LIST, queried **one at a time** — CirrusSearch does not union
   * `hastemplate:A OR hastemplate:B` (it silently returns almost nothing), so
   * `draw.ts` rotates through these across sourcing passes instead. Most
   * representative template first; it is the one used most.
   */
  infobox: string[];
  /**
   * Run the `deriveTags` gate even on infobox hits. For themes whose template is
   * broader than the theme (plants share `Speciesbox` with every other taxon).
   */
  verify?: boolean;
  /** Keyword fallback (`gsrsearch`) for themes with no usable infobox. */
  search: string;
}

const ICON: Record<Tag, string> = {
  cinema: '🎬',
  music: '🎵',
  sport: '🏆',
  politics: '📜',
  war: '🗡️',
  history: '🏛️',
  science: '🔬',
  geography: '⛰️',
  arts: '🎨',
  games: '🎮',
  nature: '🌿',
  business: '💰',
  religion: '✨',
  plants: '🌱',
  scientists: '🧪',
  disease: '🦠',
  vehicles: '🚗'
};

const COLOR: Record<Tag, string> = {
  cinema: '#e5484d', // red
  war: '#b54b32', // rust
  sport: '#f2711c', // orange
  history: '#b08947', // bronze
  business: '#e0b23c', // gold
  disease: '#9db833', // sickly yellow-green
  plants: '#5bb54b', // bright green
  nature: '#3b9e52', // forest green
  geography: '#1fa37d', // emerald
  science: '#19b6ae', // teal
  scientists: '#2aa7d6', // cyan
  games: '#3e88e5', // azure
  politics: '#5a67d8', // indigo
  arts: '#7c5cd6', // violet
  religion: '#a855c4', // amethyst
  music: '#db3b8e', // magenta
  vehicles: '#7d8894' // gunmetal (the one neutral)
};

/**
 * Infobox templates per theme, most representative first. Every name here was
 * checked against the live API for a non-zero `hastemplate:` hit count; if one
 * ever goes stale the keyword `SEARCH` fallback below covers the theme.
 */
const INFOBOX: Record<Tag, string[]> = {
  cinema: ['Infobox film'],
  music: ['Infobox album', 'Infobox song', 'Infobox musical artist'],
  sport: ['Infobox football biography', 'Infobox basketball biography', 'Infobox cricketer'],
  politics: ['Infobox officeholder', 'Infobox political party'],
  war: ['Infobox military conflict', 'Infobox military person', 'Infobox weapon'],
  history: ['Infobox former country', 'Infobox monarch', 'Infobox historical event'],
  science: ['Chembox', 'Infobox element', 'Infobox physical quantity'],
  geography: ['Infobox settlement', 'Infobox river', 'Infobox mountain'],
  arts: ['Infobox book', 'Infobox artwork', 'Infobox writer'],
  games: ['Infobox video game'],
  nature: ['Speciesbox', 'Automatic taxobox'],
  business: ['Infobox company'],
  religion: ['Infobox religion', 'Infobox deity'],
  // Speciesbox covers every taxon, so plant hits are confirmed with deriveTags
  plants: ['Speciesbox'],
  scientists: ['Infobox scientist'],
  disease: ['Infobox medical condition'],
  vehicles: ['Infobox automobile', 'Infobox aircraft', 'Infobox locomotive']
};

/** Themes whose infobox is broader than the theme — gate hits with deriveTags. */
const VERIFY: Partial<Record<Tag, boolean>> = { plants: true };

const SEARCH: Record<Tag, string> = {
  cinema: 'film OR movie OR cinema OR "film director" OR actor OR screenplay',
  music: 'album OR song OR band OR musician OR "record label" OR composer',
  sport: 'football OR basketball OR "Olympic Games" OR championship OR athlete OR tournament',
  politics: 'president OR election OR government OR parliament OR "political party" OR senator',
  war: 'war OR battle OR military OR army OR regiment OR siege OR treaty',
  history: 'history OR ancient OR empire OR dynasty OR medieval OR revolution',
  science: 'physics OR chemistry OR biology OR mathematics OR "scientific theory" OR equation',
  geography: 'city OR river OR mountain OR country OR island OR region OR "national park"',
  arts: 'painting OR novel OR poet OR sculpture OR literature OR author OR "art movement"',
  games: '"video game" OR "board game" OR "game developer" OR esports OR "role-playing game"',
  nature: 'animal OR species OR bird OR mammal OR "endangered species" OR genus',
  business: 'company OR corporation OR business OR economy OR brand OR entrepreneur',
  religion: 'religion OR church OR Christianity OR Islam OR Buddhism OR deity OR temple',
  plants: 'plant OR flower OR tree OR "flowering plant" OR shrub OR fern',
  scientists: 'physicist OR chemist OR biologist OR mathematician OR "Nobel laureate" OR astronomer',
  disease: 'disease OR virus OR infection OR cancer OR epidemic OR pathogen OR syndrome',
  vehicles: 'car OR aircraft OR ship OR locomotive OR "motor vehicle" OR spacecraft'
};

export const THEMES: Record<Tag, ThemeDef> = Object.fromEntries(
  TAGS.map((t) => [
    t,
    {
      label: TAG_LABEL[t],
      icon: ICON[t],
      color: COLOR[t],
      infobox: INFOBOX[t],
      verify: VERIFY[t] ?? false,
      search: SEARCH[t]
    }
  ])
) as Record<Tag, ThemeDef>;

export const isTag = (v: string): v is Tag => (TAGS as readonly string[]).includes(v);
