/**
 * Firestore read/write for the Arena ladder. Battles are resolved entirely on
 * the client (deterministic `simulate`); this module only stores serialized
 * teams and moves Elo ratings.
 *
 * Data model (see firestore.rules):
 *   defences/{uid}                     — a published defending team
 *   defences/{uid}/attacks/{attacker}  — one record per (attacker → defender) pair
 *   profiles/{uid}                     — handle + Elo rating + W/L/D
 *
 * Only the FIRST resolved attack of a pair is `rated`; re-attacks update the
 * stored record for audit but never move ratings (kills rematch farming).
 */
import { get } from 'svelte/store';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot
} from 'firebase/firestore/lite';
import type { Card } from '../types';
import { assembleTeam, type BattleResult } from '../battle/engine';
import { encodeDefence, previewOf, type DefencePreview } from '../battle/defence';
import { getArena } from '../firebase';
import { profile } from './profile';
import { isStale } from './cache';
import {
  applyResult,
  ELO_START,
  isRanked,
  scoreFromOutcome,
  type Rated,
  type Score
} from './elo';

export const PAGE = 25;

export interface DefenceRow {
  uid: string;
  handle: string;
  code: string;
  preview: DefencePreview[];
  hp: number;
  attack: number;
  updatedAt: number;
}

export interface LadderRow {
  uid: string;
  handle: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  peakRating: number;
}

export interface Page<Row> {
  rows: Row[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
}

const ms = (v: unknown): number =>
  v && typeof v === 'object' && 'toMillis' in v ? (v as { toMillis(): number }).toMillis() : 0;

// ── profiles ────────────────────────────────────────────────────────────────
async function ensureProfile(db: Firestore, uid: string, handle: string): Promise<void> {
  const ref = doc(db, 'profiles', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      handle,
      rating: ELO_START,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      provisional: !isRanked(0),
      ranked: isRanked(0),
      peakRating: ELO_START,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return;
  }
  // rules branch (a): the owner may move handle and/or the board-visibility flags
  const d = snap.data();
  const ranked = isRanked(d.games ?? 0);
  const patch: DocumentData = {};
  if (d.handle !== handle) patch.handle = handle;
  if (d.ranked !== ranked) {
    patch.ranked = ranked;
    patch.provisional = !ranked;
  }
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = serverTimestamp();
    await setDoc(ref, patch, { merge: true });
  }
}

const asRated = (d: DocumentData | undefined): Rated => ({
  rating: typeof d?.rating === 'number' ? d.rating : ELO_START,
  games: typeof d?.games === 'number' ? d.games : 0
});

function ratedWrite(
  prev: DocumentData | undefined,
  step: Rated & { delta: number },
  score: Score,
  lastRatedDef?: string
) {
  const base: DocumentData = {
    rating: step.rating,
    games: step.games,
    wins: (prev?.wins ?? 0) + (score === 1 ? 1 : 0),
    losses: (prev?.losses ?? 0) + (score === 0 ? 1 : 0),
    draws: (prev?.draws ?? 0) + (score === 0.5 ? 1 : 0),
    provisional: !isRanked(step.games),
    ranked: isRanked(step.games),
    peakRating: Math.max(prev?.peakRating ?? ELO_START, step.rating),
    updatedAt: serverTimestamp()
  };
  // the attacker's own write points at the defender just fought — rules use this
  // to stop a player farming rating off one opponent (see firestore.rules)
  if (lastRatedDef) base.lastRatedDef = lastRatedDef;
  return base;
}

// ── publish / remove my defence ─────────────────────────────────────────────
export async function publishDefence(cards: Card[]): Promise<void> {
  const { db, uid } = await getArena();
  const handle = get(profile).handle;
  const team = assembleTeam(cards);
  const code = await encodeDefence(cards);
  const ref = doc(db, 'defences', uid);
  const existing = await getDoc(ref);
  await setDoc(ref, {
    uid,
    handle,
    code,
    preview: previewOf(cards),
    hp: team.maxHp,
    attack: team.attack,
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await ensureProfile(db, uid, handle);
}

export async function removeDefence(): Promise<void> {
  const { db, uid } = await getArena();
  await deleteDoc(doc(db, 'defences', uid));
}

export async function myDefence(): Promise<DefenceRow | null> {
  const { db, uid } = await getArena();
  const snap = await getDoc(doc(db, 'defences', uid));
  return snap.exists() ? toDefenceRow(snap) : null;
}

// ── lists ───────────────────────────────────────────────────────────────────
function toDefenceRow(d: QueryDocumentSnapshot<DocumentData>): DefenceRow {
  const x = d.data();
  return {
    uid: d.id,
    handle: x.handle ?? 'Someone',
    code: x.code ?? '',
    preview: Array.isArray(x.preview) ? x.preview : [],
    hp: x.hp ?? 0,
    attack: x.attack ?? 0,
    updatedAt: ms(x.updatedAt)
  };
}

function toLadderRow(d: QueryDocumentSnapshot<DocumentData>): LadderRow {
  const x = d.data();
  return {
    uid: d.id,
    handle: x.handle ?? 'Someone',
    rating: x.rating ?? ELO_START,
    games: x.games ?? 0,
    wins: x.wins ?? 0,
    losses: x.losses ?? 0,
    draws: x.draws ?? 0,
    peakRating: x.peakRating ?? ELO_START
  };
}

export async function topPlayers(after?: QueryDocumentSnapshot<DocumentData> | null): Promise<Page<LadderRow>> {
  const { db } = await getArena();
  const base = [where('ranked', '==', true), orderBy('rating', 'desc'), limit(PAGE)];
  const q = after
    ? query(collection(db, 'profiles'), ...base, startAfter(after))
    : query(collection(db, 'profiles'), ...base);
  const snap = await getDocs(q);
  return { rows: snap.docs.map(toLadderRow), cursor: snap.docs.at(-1) ?? null };
}

export async function browseDefences(
  after?: QueryDocumentSnapshot<DocumentData> | null,
  myUid?: string
): Promise<Page<DefenceRow>> {
  const { db, uid } = await getArena();
  const mine = myUid ?? uid;
  // over-fetch so the staleness / self filters don't leave a short page
  const base = [orderBy('updatedAt', 'desc'), limit(PAGE + 15)];
  const q = after
    ? query(collection(db, 'defences'), ...base, startAfter(after))
    : query(collection(db, 'defences'), ...base);
  const snap = await getDocs(q);
  const rows = snap.docs
    .map(toDefenceRow)
    .filter((r) => r.uid !== mine && !isStale(r.updatedAt))
    .slice(0, PAGE);
  return { rows, cursor: snap.docs.at(-1) ?? null };
}

// ── attack ──────────────────────────────────────────────────────────────────
export interface PriorAttack {
  outcome: 'defend' | 'fall';
  rated: boolean;
}

export async function myPriorAttack(defUid: string): Promise<PriorAttack | null> {
  const { db, uid } = await getArena();
  const snap = await getDoc(doc(db, 'defences', defUid, 'attacks', uid));
  if (!snap.exists()) return null;
  const x = snap.data();
  return { outcome: x.outcome === 'fall' ? 'fall' : 'defend', rated: !!x.rated };
}

export interface AttackSubmission {
  defUid: string;
  defHandle: string;
  defenderCode: string;
  attackerCode: string;
  result: BattleResult;
}

/**
 * Record a resolved attack and, if it is the first of this pair, move both
 * ratings. Runs as a Firestore transaction so the security rules' `getAfter`
 * check on the attacks doc holds.
 */
export async function submitAttack(sub: AttackSubmission): Promise<{ rated: boolean; myDelta: number }> {
  const { db, uid } = await getArena();
  const handle = get(profile).handle;
  await ensureProfile(db, uid, handle);

  const scoreA = scoreFromOutcome(sub.result.outcome);
  const defenderOutcome: 'defend' | 'fall' = sub.result.outcome === 'win' ? 'fall' : 'defend';
  const rounds = sub.result.rounds.length;

  return runTransaction(db, async (tx) => {
    const meRef = doc(db, 'profiles', uid);
    const defRef = doc(db, 'profiles', sub.defUid);
    const atkRef = doc(db, 'defences', sub.defUid, 'attacks', uid);

    const meSnap = await tx.get(meRef);
    const defSnap = await tx.get(defRef);
    const priorSnap = await tx.get(atkRef);
    const priorRated = priorSnap.exists() && !!priorSnap.data().rated;

    const attackRecord: DocumentData = {
      attackerUid: uid,
      attackerHandle: handle,
      defenderHandle: sub.defHandle,
      attackerCode: sub.attackerCode,
      defenderCode: sub.defenderCode,
      outcome: defenderOutcome,
      rounds,
      rated: !priorRated,
      ts: serverTimestamp()
    };

    if (priorRated) {
      tx.set(atkRef, attackRecord);
      return { rated: false, myDelta: 0 };
    }
    attackRecord.ratedAt = serverTimestamp();

    const me = asRated(meSnap.data());
    const def = asRated(defSnap.data());
    const meStep = applyResult(me, def, scoreA);
    const defStep = applyResult(def, me, (1 - scoreA) as Score);

    tx.set(atkRef, attackRecord);
    tx.set(meRef, ratedWrite(meSnap.data(), meStep, scoreA, sub.defUid), { merge: true });
    tx.set(defRef, ratedWrite(defSnap.data(), defStep, (1 - scoreA) as Score), { merge: true });

    return { rated: true, myDelta: meStep.delta };
  });
}
