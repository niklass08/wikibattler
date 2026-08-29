/**
 * Every tunable that shapes pack luck — rarity odds and special-finish odds —
 * gathered in one place so the whole drop economy can be reviewed and adjusted
 * without hunting through the draw code.
 *
 * Nothing here has behaviour: the algorithms that consume these live in
 * `pack.ts` (rarity composition + upgrade rolls), `rarity.ts` (view → rarity)
 * and `foil.ts` (foil + negated finishes). Each constant notes where it is used.
 *
 * Rough target rarity mix of a live pack: ~55 / 30 / 12 / 3 % common / uncommon
 * / rare / mythic.
 */
import type { Rarity } from './types';

// ── Pack composition (pack.ts) ───────────────────────────────────────────────

/** Cards per pack. */
export const PACK_SIZE = 7;

/**
 * Base rarity of each slot, in reveal order, before upgrade rolls. The last slot
 * is a guaranteed rare-or-better; the rest form the modal 4-common / 2-uncommon
 * pack. Every slot then rolls to climb the ladder — nothing here is a hard floor
 * except that guaranteed rare. Length must stay in sync with PACK_SIZE.
 */
export const PACK_BASE: Rarity[] = [
  'common',
  'common',
  'common',
  'common',
  'uncommon',
  'uncommon',
  'rare'
];

// ── Rarity upgrade rolls (pack.ts) ───────────────────────────────────────────

/**
 * Per-roll chance that a slot climbs one tier, as a function of its 0-based
 * depth: `chance(depth) = UPGRADE_MIN + UPGRADE_STEP * depth`. A slot keeps
 * rolling up at this chance until a roll fails or it reaches mythic, so a lucky
 * shallow common can still chain all the way up — just very rarely.
 *
 * With the current values the per-roll chance runs 3% (slot 1) → 13.2% (slot 7).
 */
export const UPGRADE_MIN = 0.03;
export const UPGRADE_STEP = 0.017;

// ── View → rarity thresholds (rarity.ts) ─────────────────────────────────────

/**
 * Monthly-pageview cutoffs that assign a candidate its rarity. Rare and mythic
 * candidates are sourced from the pageviews "top" lists, so raising `mythic`
 * makes mythics genuinely scarce. Nudge until the live rarity mix feels right.
 */
export const RARITY_THRESHOLDS = {
  /** >= this and < rare  => uncommon */
  uncommon: 10_000,
  /** >= this and < mythic => rare */
  rare: 150_000,
  /** >= this              => mythic */
  mythic: 400_000
} as const;

// ── Special finishes (foil.ts) ───────────────────────────────────────────────

/** Chance that a given pack contains a single foil card. */
export const FOIL_PACK_CHANCE = 1 / 7;

/** Chance that a given pack is a god pack — every card foiled. */
export const GOD_PACK_CHANCE = 1 / 25;

/**
 * Per-card chance of the negated (colours-inverted) finish. Rolled independently
 * of foil, at a tenth of the foil pack chance, so a card can come out foil,
 * negated, both, or neither.
 */
export const NEGATE_CHANCE = FOIL_PACK_CHANCE / 10;

/** Relative weights for foil tiers 1 / 2 / 3 whenever a foil is rolled. */
export const FOIL_TIER_WEIGHTS: [number, number, number] = [0.62, 0.28, 0.1];
