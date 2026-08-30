/**
 * Per-theme presentation metadata: display label, icon and the accent colour
 * that colour-codes the theme.
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
  /** hex — the theme's accent colour */
  color: string;
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

export const THEMES: Record<Tag, ThemeDef> = Object.fromEntries(
  TAGS.map((t) => [t, { label: TAG_LABEL[t], icon: ICON[t], color: COLOR[t] }])
) as Record<Tag, ThemeDef>;

export const isTag = (v: string): v is Tag => (TAGS as readonly string[]).includes(v);
