/**
 * base64url + deflate-raw, on the platform's own streams (no dependency).
 *
 * Extracted from `battle/defence.ts`, which still uses it for DefenceCodes; the
 * cloud sync (`cloud/wire.ts`) uses it to compress a whole collection into a
 * Firestore blob. Kept dependency-free and portable across browser + node so the
 * test suite (which runs in the node environment) can exercise it directly.
 */

// ── base64url (no padding) ───────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REV = /* @__PURE__ */ (() => {
  const m = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

export function bytesToBase64url(bytes: Uint8Array): string {
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

export function base64urlToBytes(s: string): Uint8Array {
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

// ── deflate-raw via the platform streams ─────────────────────────────────────
async function pump(
  data: Uint8Array,
  ts: { writable: WritableStream; readable: ReadableStream }
): Promise<Uint8Array> {
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

export const deflate = (b: Uint8Array) => pump(b, new CompressionStream('deflate-raw'));
export const inflate = (b: Uint8Array) => pump(b, new DecompressionStream('deflate-raw'));
