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
   * Primary sourcing query — `hastemplate:` clauses matching the theme's infobox
   * template(s). An infobox is an authoritative topic signal, far cleaner than
   * keyword matching.
   */
  infobox: string;
  /** Keyword fallback (`gsrsearch`) if the infobox query comes up short. */
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
 * `hastemplate:` sourcing queries. Template names are the common English
 * Wikipedia infobox templates for each topic; if one is wrong or too narrow the
 * keyword `SEARCH` fallback below kicks in.
 */
const INFOBOX: Record<Tag, string> = {
  cinema: 'hastemplate:"Infobox film"',
  music:
    'hastemplate:"Infobox album" OR hastemplate:"Infobox song" OR hastemplate:"Infobox musical artist"',
  sport:
    'hastemplate:"Infobox football biography" OR hastemplate:"Infobox basketball biography" OR hastemplate:"Infobox NFL biography" OR hastemplate:"Infobox cricketer" OR hastemplate:"Infobox tennis biography"',
  politics: 'hastemplate:"Infobox officeholder" OR hastemplate:"Infobox political party"',
  war:
    'hastemplate:"Infobox military conflict" OR hastemplate:"Infobox military person" OR hastemplate:"Infobox weapon"',
  history:
    'hastemplate:"Infobox historical event" OR hastemplate:"Infobox monarch" OR hastemplate:"Infobox former country"',
  science:
    'hastemplate:"Chembox" OR hastemplate:"Infobox element" OR hastemplate:"Infobox physical quantity" OR hastemplate:"Infobox spaceflight"',
  geography:
    'hastemplate:"Infobox settlement" OR hastemplate:"Infobox country" OR hastemplate:"Infobox river" OR hastemplate:"Infobox mountain" OR hastemplate:"Infobox islands"',
  arts:
    'hastemplate:"Infobox artwork" OR hastemplate:"Infobox book" OR hastemplate:"Infobox writer" OR hastemplate:"Infobox artist"',
  games: 'hastemplate:"Infobox video game" OR hastemplate:"Infobox game"',
  nature: 'hastemplate:"Speciesbox" OR hastemplate:"Taxobox" OR hastemplate:"Automatic taxobox"',
  business: 'hastemplate:"Infobox company"',
  religion:
    'hastemplate:"Infobox religion" OR hastemplate:"Infobox deity" OR hastemplate:"Infobox Christian denomination"',
  plants: 'hastemplate:"Speciesbox" (plant OR flora OR tree OR flower OR shrub OR fern)',
  scientists: 'hastemplate:"Infobox scientist"',
  disease:
    'hastemplate:"Infobox medical condition" OR hastemplate:"Infobox medical condition (new)"',
  // ships use a modular infobox hastemplate: can't see — the keyword fallback covers them
  vehicles:
    'hastemplate:"Infobox automobile" OR hastemplate:"Infobox aircraft" OR hastemplate:"Infobox locomotive" OR hastemplate:"Infobox rocket"'
};

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
    { label: TAG_LABEL[t], icon: ICON[t], color: COLOR[t], infobox: INFOBOX[t], search: SEARCH[t] }
  ])
) as Record<Tag, ThemeDef>;

export const isTag = (v: string): v is Tag => (TAGS as readonly string[]).includes(v);
