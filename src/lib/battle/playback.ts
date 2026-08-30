/**
 * Turns a finished `BattleResult` into a per-round timeline the arena UI can
 * animate: who hit whom, for how much, and which theme/effect fired. Pure and
 * derived from the combat log — the engine stays untouched.
 *
 * The log text is a stable, single-codebase format (see `engine.ts`), so a
 * handful of anchored matchers is enough; `tests/playback.test.ts` guards it.
 */
import type { BattleResult, LogLine, Round, TeamStats } from './engine';

export type Side = 'a' | 'b';

export type BeatKind =
  | 'swing'
  | 'overdrive'
  | 'blitz'
  | 'combo'
  | 'dot'
  | 'bloom'
  | 'reflect'
  | 'shield'
  | 'heal'
  | 'regen'
  | 'ramp'
  | 'info';

export interface Beat {
  kind: BeatKind;
  /** the side that caused it */
  by: Side | null;
  /** the side whose pool moved (null for pure flavour) */
  at: Side | null;
  /** magnitude — damage, or heal amount when `heal` is true */
  amount: number;
  heal: boolean;
  text: string;
  logKind: LogLine['kind'];
}

export interface RoundBeats {
  n: number;
  beats: Beat[];
  /** hp at the start / end of the round (clamped, ≥ 0) */
  aStart: number;
  bStart: number;
  aEnd: number;
  bEnd: number;
  /** total damage each side dealt to the other this round */
  aDealt: number;
  bDealt: number;
  /** total healing each side did on itself this round */
  aHealed: number;
  bHealed: number;
  /** distinctive effects that fired, for pulsing the right bonus / a callout */
  fx: BeatKind[];
}

export interface Timeline {
  rounds: RoundBeats[];
  outcome: BattleResult['outcome'];
  damageDealt: number;
  damageTaken: number;
  aMaxHp: number;
  bMaxHp: number;
}

const num = (s: string, re: RegExp): number => {
  const m = s.match(re);
  return m ? Number(m[1]) : 0;
};

/** Which side a "… <name> <hp> → <hp>." tail refers to. */
function tailSide(text: string, bName: string): Side | null {
  if (/\bTeam \d+ → \d+\.\s*$/.test(text)) return 'a';
  if (bName && new RegExp(`${escapeRe(bName)} \\d+ → \\d+\\.\\s*$`).test(text)) return 'b';
  return null;
}

/** Which side a "… <name> → <hp>." (heal) tail refers to. */
function healSide(text: string, bName: string): Side | null {
  if (/\bTeam → \d+\.\s*$/.test(text)) return 'a';
  if (bName && new RegExp(`${escapeRe(bName)} → \\d+\\.\\s*$`).test(text)) return 'b';
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

function classify(line: LogLine, bName: string, actor: Side): { beat: Beat; nextActor: Side } {
  const t = line.text;
  const mk = (kind: BeatKind, by: Side | null, at: Side | null, amount: number, heal = false): Beat => ({
    kind,
    by,
    at,
    amount,
    heal,
    text: t,
    logKind: line.kind
  });

  // ── attacks ──────────────────────────────────────────────────────────────
  if (t.startsWith('Your team hits for ')) {
    return { beat: mk('swing', 'a', tailSide(t, bName) ?? 'b', num(t, /for (\d+)/)), nextActor: 'a' };
  }
  if (bName && t.startsWith(`${bName} hits for `)) {
    return { beat: mk('swing', 'b', tailSide(t, bName) ?? 'a', num(t, /for (\d+)/)), nextActor: 'b' };
  }
  if (t.startsWith('🎮 Combo')) {
    const at = tailSide(t, bName) ?? other(actor);
    return { beat: mk('combo', other(at), at, num(t, /for (\d+)/)), nextActor: actor };
  }
  if (t.startsWith('🚗 Overdrive')) {
    const at = tailSide(t, bName) ?? other(actor);
    return { beat: mk('overdrive', other(at), at, num(t, /for (\d+)/)), nextActor: actor };
  }
  if (t.includes('Blitzkrieg')) {
    const at = tailSide(t, bName) ?? other(actor);
    return { beat: mk('blitz', other(at), at, num(t, /for (\d+)/)), nextActor: actor };
  }
  if (t.startsWith('🦠 Contagion')) {
    const at = tailSide(t, bName) ?? other(actor);
    return { beat: mk('dot', other(at), at, num(t, /for (\d+)/)), nextActor: actor };
  }
  if (t.startsWith('🌱 Bloom')) {
    const at = tailSide(t, bName) ?? other(actor);
    return { beat: mk('bloom', other(at), at, num(t, /— (\d+) damage/)), nextActor: actor };
  }

  // ── defensive / support ─────────────────────────────────────────────────
  if (t.startsWith('🌱 Fast Bloom heals ')) {
    const at = healSide(t, bName) ?? actor;
    return { beat: mk('heal', at, at, num(t, /heals (\d+)/), true), nextActor: actor };
  }
  if (t.startsWith('Field heals ')) {
    const at = healSide(t, bName) ?? actor;
    return { beat: mk('regen', at, at, num(t, /heals (\d+)/), true), nextActor: actor };
  }
  if (t.startsWith('Countermeasures reflect ')) {
    // the named party is the one taking the reflected hit — the attacker
    const hit = tailSide(t, bName) ?? actor;
    return { beat: mk('reflect', other(hit), hit, num(t, /reflect (\d+)/)), nextActor: actor };
  }
  if (t.startsWith('✨ Divine Shield')) {
    return { beat: mk('shield', actor, other(actor), 0), nextActor: actor };
  }

  // ── flavour ─────────────────────────────────────────────────────────────
  if (t.startsWith('📈 Attack ramp')) {
    const by: Side = bName && t.includes(`— ${bName} attack`) ? 'b' : 'a';
    return { beat: mk('ramp', by, null, 0), nextActor: by };
  }
  if (t.startsWith('No fighter on the team')) {
    return { beat: mk('info', 'a', null, 0), nextActor: 'a' };
  }
  if (bName && t.startsWith(`${bName} does nothing`)) {
    return { beat: mk('info', 'b', null, 0), nextActor: 'b' };
  }
  return { beat: mk('info', null, null, 0), nextActor: actor };
}

const DISTINCTIVE: BeatKind[] = ['combo', 'blitz', 'overdrive', 'dot', 'bloom', 'reflect', 'shield'];

function roundBeats(round: Round, bName: string, aStart: number, bStart: number): RoundBeats {
  let actor: Side = 'a';
  const beats: Beat[] = [];
  for (const line of round.lines) {
    if (line.kind === 'result') continue;
    const { beat, nextActor } = classify(line, bName, actor);
    actor = nextActor;
    beats.push(beat);
  }

  let aDealt = 0;
  let bDealt = 0;
  let aHealed = 0;
  let bHealed = 0;
  for (const b of beats) {
    if (b.heal) {
      if (b.at === 'a') aHealed += b.amount;
      else if (b.at === 'b') bHealed += b.amount;
    } else if (b.amount > 0) {
      if (b.at === 'b') aDealt += b.amount;
      else if (b.at === 'a') bDealt += b.amount;
    }
  }

  const fx = [...new Set(beats.map((b) => b.kind).filter((k) => DISTINCTIVE.includes(k)))];

  return {
    n: round.n,
    beats,
    aStart,
    bStart,
    aEnd: Math.max(0, round.playerHp),
    bEnd: Math.max(0, round.enemyHp),
    aDealt,
    bDealt,
    aHealed,
    bHealed,
    fx
  };
}

export interface TimelineOpts {
  aMaxHp: number;
  bMaxHp: number;
  bName: string;
}

export function toTimeline(result: BattleResult, opts: TimelineOpts): Timeline {
  const rounds: RoundBeats[] = [];
  let aStart = opts.aMaxHp;
  let bStart = opts.bMaxHp;
  for (const r of result.rounds) {
    const rb = roundBeats(r, opts.bName, aStart, bStart);
    rounds.push(rb);
    aStart = rb.aEnd;
    bStart = rb.bEnd;
  }
  return {
    rounds,
    outcome: result.outcome,
    damageDealt: result.damageDealt,
    damageTaken: result.damageTaken,
    aMaxHp: opts.aMaxHp,
    bMaxHp: opts.bMaxHp
  };
}

// ── side view (teams + bonuses) ─────────────────────────────────────────────
export interface BonusView {
  icon: string;
  name: string;
  detail: string;
  from: string;
  kind: 'field' | 'round' | 'signature';
  /** beat kinds that light this bonus up mid-fight */
  fires: BeatKind[];
}

export interface SideView {
  name: string;
  subtitle: string;
  cards: import('../types').Card[];
  roles: ('living' | 'abstract')[];
  fallbackIcon: string;
  bonuses: BonusView[];
  maxHp: number;
  attack: number;
}

const ROUND_FIRES: Record<string, BeatKind[]> = {
  dot: ['dot'],
  ramp: ['ramp'],
  bloom: ['bloom'],
  overdrive: ['overdrive']
};

const SIG_FIRES: Record<string, BeatKind[]> = {
  war: ['blitz'],
  games: ['combo'],
  religion: ['shield'],
  disease: ['dot'],
  plants: ['bloom'],
  vehicles: ['overdrive'],
  music: ['ramp'],
  scientists: ['ramp']
};

export function sideViewOf(
  name: string,
  team: TeamStats,
  opts: { subtitle?: string; fallbackIcon?: string } = {}
): SideView {
  const bonuses: BonusView[] = [];
  for (const m of team.members) {
    if (m.effect) {
      bonuses.push({
        icon: m.effect.icon,
        name: m.effect.name,
        detail: m.effect.detail,
        from: m.card.title,
        kind: 'field',
        fires: m.effect.mods.reflect > 0 ? ['reflect'] : []
      });
    }
  }
  for (const e of team.roundPlan.effects) {
    bonuses.push({
      icon: e.icon,
      name: e.name,
      detail: e.detail,
      from: e.from,
      kind: 'round',
      fires: ROUND_FIRES[e.kind] ?? []
    });
  }
  for (const s of team.signatures) {
    bonuses.push({
      icon: '★',
      name: s.name,
      detail: s.count > 1 ? `${s.detail} · N=${s.count}` : s.detail,
      from: s.from,
      kind: 'signature',
      fires: SIG_FIRES[s.theme] ?? []
    });
  }
  return {
    name,
    subtitle: opts.subtitle ?? `${team.attack} attack · ${team.maxHp} HP`,
    cards: team.members.map((m) => m.card),
    roles: team.members.map((m) => m.role),
    fallbackIcon: opts.fallbackIcon ?? '',
    bonuses,
    maxHp: team.maxHp,
    attack: team.attack
  };
}
