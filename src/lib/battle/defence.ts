/**
 * DefenceCode — a compact, self-contained serialization of a battle team, used
 * as the payload an Arena defender publishes and an attacker fights against.
 *
 * It carries only what `assembleTeam` and the browse UI actually read: identity,
 * the two stats, rarity, the battle role (so the ~200-char extract can be
 * dropped), the mythic signature theme, and the ordered tag list. Everything
 * else on a `Card` (`extract`, `url`, `image`, `foil`, `negated`, `raw`) is
 * reconstructed with neutral defaults on decode.
 *
 * Wire format:  "1." + base64url( deflate-raw( utf8( JSON ) ) )
 * where JSON is { v:1, c:[ [id,title,str,def,rarIdx,roleBit,sigIdx, ...tagIdx], … ] }
 *
 * `decodeDefence` never throws — like `collection.ts`'s loader it coerces or
 * drops anything malformed and returns a tagged result.
 */
import type { Card, Rarity } from '../types';
import { RARITIES } from '../types';
import { TAGS, type Tag } from '../tags';
import { SIGNATURES } from './signatures.config';
import { classifyCard, type Role } from './classify';
import { TEAM_SIZE } from './engine';

export const DEFENCE_CODE_VERSION = 1;

/** Compact per-card summary for the browse list — no decode needed to render it. */
export interface DefencePreview {
  t: string;
  r: number;
  role: 0 | 1;
  sig: number;
}

type DecodeResult =
  | { ok: true; cards: (Card & { battleRole: Role })[] }
  | { ok: false; error: string };

const clampStat = (n: number): number =>
  Math.min(1000, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

const isSignatureTheme = (s: string): s is Tag => s in SIGNATURES;

// ── base64url (no padding), portable across browser + node ───────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REV = /* @__PURE__ */ (() => {
  const m = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

function bytesToBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

function base64urlToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9\-_]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_REV[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

// ── deflate-raw via the platform streams (no dependency) ─────────────────────
async function pump(data: Uint8Array, ts: { writable: WritableStream; readable: ReadableStream }): Promise<Uint8Array> {
  const writer = ts.writable.getWriter();
  // on malformed input the stream errors; swallow the writer-side rejection so it
  // doesn't surface as unhandled — the reader below rejects too and that IS caught
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});
  const reader = ts.readable.getReader();
  const parts: Uint8Array[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value as Uint8Array);
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const deflate = (b: Uint8Array) => pump(b, new CompressionStream('deflate-raw'));
const inflate = (b: Uint8Array) => pump(b, new DecompressionStream('deflate-raw'));

// ── encode ──────────────────────────────────────────────────────────────────
function tupleOf(card: Card): (string | number)[] {
  const rarIdx = Math.max(0, RARITIES.indexOf(card.rarity));
  const roleBit = classifyCard(card) === 'living' ? 1 : 0;
  const sigIdx =
    card.signature && isSignatureTheme(card.signature) ? TAGS.indexOf(card.signature) : -1;
  const tagIdx = (card.tags ?? [])
    .map((t) => TAGS.indexOf(t as Tag))
    .filter((i) => i >= 0)
    .slice(0, 6);
  return [card.id, card.title, card.strength, card.defence, rarIdx, roleBit, sigIdx, ...tagIdx];
}

export async function encodeDefence(cards: Card[]): Promise<string> {
  const payload = { v: DEFENCE_CODE_VERSION, c: cards.slice(0, TEAM_SIZE).map(tupleOf) };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await deflate(json);
  return `${DEFENCE_CODE_VERSION}.${bytesToBase64url(packed)}`;
}

export function previewOf(cards: Card[]): DefencePreview[] {
  return cards.slice(0, TEAM_SIZE).map((c) => ({
    t: c.title,
    r: Math.max(0, RARITIES.indexOf(c.rarity)),
    role: classifyCard(c) === 'living' ? 1 : 0,
    sig: c.signature && isSignatureTheme(c.signature) ? TAGS.indexOf(c.signature) : -1
  }));
}

// ── decode ──────────────────────────────────────────────────────────────────
const BAD = 'That doesn’t look like a valid defence code.';
const NEWER = 'This challenge is from a newer version of WikiTCG.';

/** Pull the bare code out of a pasted URL / `#arena=` link / raw string. */
function unwrap(input: string): string {
  const s = input.trim();
  const m = s.match(/arena=([^&\s]+)/);
  return (m ? m[1] : s).trim();
}

export async function decodeDefence(input: string): Promise<DecodeResult> {
  const code = unwrap(input ?? '');
  const dot = code.indexOf('.');
  if (dot <= 0) return { ok: false, error: BAD };

  const version = Number(code.slice(0, dot));
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: BAD };
  if (version > DEFENCE_CODE_VERSION) return { ok: false, error: NEWER };

  let raw: unknown;
  try {
    const bytes = base64urlToBytes(code.slice(dot + 1));
    const json = new TextDecoder().decode(await inflate(bytes));
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: BAD };
  }

  const list = (raw as { c?: unknown })?.c;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: BAD };

  let mythicSeen = false;
  const cards = list
    .slice(0, TEAM_SIZE)
    .map((row, i): (Card & { battleRole: Role }) | null => {
      if (!Array.isArray(row) || row.length < 7) return null;
      const [id, title, str, def, rarIdx, roleBit, sigIdx, ...tagIdx] = row;

      const rarity: Rarity = RARITIES[Number(rarIdx)] ?? 'common';
      const sigTag = TAGS[Number(sigIdx)] as Tag | undefined;
      let signature: Tag | null = sigTag && isSignatureTheme(sigTag) ? sigTag : null;
      // one mythic signature per team — array order wins, mirrors the builder cap
      if (rarity === 'mythic') {
        if (mythicSeen) signature = null;
        mythicSeen = true;
      } else {
        signature = null;
      }

      const tags = (tagIdx as unknown[])
        .map((t) => TAGS[Number(t)])
        .filter((t): t is Tag => typeof t === 'string')
        .slice(0, 6);

      return {
        id: Number.isFinite(Number(id)) ? Number(id) : -(i + 1),
        title: typeof title === 'string' && title.trim() ? title : 'Unknown card',
        url: '',
        extract: '',
        image: null,
        rarity,
        strength: clampStat(Number(str)),
        defence: clampStat(Number(def)),
        foil: 0,
        negated: false,
        tags,
        signature,
        raw: { links: 0, bytes: 0, monthlyViews: 0 },
        battleRole: Number(roleBit) === 1 ? 'living' : 'abstract'
      };
    })
    .filter((c): c is Card & { battleRole: Role } => c !== null);

  if (cards.length === 0) return { ok: false, error: BAD };
  return { ok: true, cards };
}
