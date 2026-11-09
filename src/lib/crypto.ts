// Framework-free crypto helpers (Web Crypto only, so they run in Workers and Node tests).

const enc = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invalid base64url");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(text: string): Uint8Array {
  return enc.encode(text);
}

/** Cryptographically random token, base64url (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(text)));
}

/** Hash used to store secrets (session tokens, codes, refresh tokens, client secrets) at rest. */
export async function hashSecret(text: string): Promise<string> {
  return base64url(await sha256(text));
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = utf8(a);
  const y = utf8(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** RFC 7636 code_verifier: 43–128 chars of [A-Z a-z 0-9 - . _ ~]. */
export function isValidCodeVerifier(v: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

/** RFC 7636 S256 code_challenge: base64url(SHA-256(verifier)), 43 chars. */
export function isValidCodeChallenge(c: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(c);
}

export async function s256Challenge(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (!isValidCodeVerifier(verifier)) return false;
  return timingSafeEqual(await s256Challenge(verifier), challenge);
}

/** UUIDv7 (time-ordered) for primary keys. */
export function uuidv7(nowMs = Date.now()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ts = BigInt(nowMs);
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
