// WebAuthn（passkey）的伺服器端驗證，只用 WebCrypto、不用 CBOR：
// 瀏覽器端用 getPublicKey()／getAuthenticatorData() 直接給 SPKI 公鑰與 authenticatorData，伺服器核對挑戰碼、來源、rpId 雜湊、
// 使用者在場與驗證旗標（指紋／臉部／PIN），再用公鑰驗簽章。不要求 attestation（none）。
import { base64url, base64urlDecode } from "../lib/crypto";

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;
export const SUPPORTED_ALGS = [ALG_ES256, ALG_RS256] as const;

const te = new TextEncoder();
const sha256 = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", b));

export interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  userPresent: boolean;
  userVerified: boolean;
  /** 只有註冊時（AT 旗標）才有。 */
  credentialId?: Uint8Array;
}

export function parseAuthData(data: Uint8Array): AuthData | null {
  if (data.length < 37) return null;
  const flags = data[32]!;
  const out: AuthData = { rpIdHash: data.slice(0, 32), flags, signCount: ((data[33]! << 24) | (data[34]! << 16) | (data[35]! << 8) | data[36]!) >>> 0, userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04) };
  if (flags & 0x40) {
    if (data.length < 55) return null;
    const len = (data[53]! << 8) | data[54]!;
    if (data.length < 55 + len) return null;
    out.credentialId = data.slice(55, 55 + len);
  }
  return out;
}

export interface ClientData { type: string; challenge: string; origin: string }
export function parseClientData(raw: Uint8Array): ClientData | null {
  try {
    const j = JSON.parse(new TextDecoder().decode(raw)) as Partial<ClientData>;
    return typeof j.type === "string" && typeof j.challenge === "string" && typeof j.origin === "string" ? { type: j.type, challenge: j.challenge, origin: j.origin } : null;
  } catch {
    return null;
  }
}

/** 共同檢查：clientDataJSON 的種類、挑戰碼、來源，以及 authenticatorData 的 rpId 雜湊、在場與驗證旗標。 */
export async function checkCeremony(o: { type: "webauthn.create" | "webauthn.get"; clientDataJSON: Uint8Array; authenticatorData: Uint8Array; challenge: string; origin: string; rpId: string }): Promise<AuthData | null> {
  const cd = parseClientData(o.clientDataJSON);
  if (!cd || cd.type !== o.type || cd.challenge !== o.challenge || cd.origin !== o.origin) return null;
  const ad = parseAuthData(o.authenticatorData);
  if (!ad) return null;
  const want = await sha256(te.encode(o.rpId));
  if (want.length !== ad.rpIdHash.length || !want.every((b, i) => b === ad.rpIdHash[i])) return null;
  if (!ad.userPresent || !ad.userVerified) return null; // 一定要有指紋／臉部／PIN 的使用者驗證
  return ad;
}

function derToRaw(der: Uint8Array): Uint8Array | null {
  // ECDSA 簽章 DER：30 len 02 rlen r 02 slen s → 64 bytes r||s
  let i = 0;
  if (der[i++] !== 0x30) return null;
  let len = der[i++]!;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | der[i++]!; }
  const read = (): Uint8Array | null => {
    if (der[i++] !== 0x02) return null;
    const l = der[i++]!;
    let v = der.slice(i, i + l); i += l;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) return null;
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = read(); const s = read();
  if (!r || !s) return null;
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

/** 公鑰（SPKI）＋演算法是否可用。 */
export async function importPublicKey(spki: Uint8Array, alg: number): Promise<CryptoKey | null> {
  try {
    if (alg === ALG_ES256) return await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (alg === ALG_RS256) return await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  } catch {
    /* 公鑰格式不對 */
  }
  return null;
}

/** 驗簽：簽章範圍＝authenticatorData ‖ SHA-256(clientDataJSON)。 */
export async function verifySignature(o: { publicKey: CryptoKey; alg: number; authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array }): Promise<boolean> {
  const signed = new Uint8Array([...o.authenticatorData, ...(await sha256(o.clientDataJSON))]);
  try {
    if (o.alg === ALG_ES256) {
      const raw = o.signature.length === 64 ? o.signature : derToRaw(o.signature);
      return !!raw && (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, o.publicKey, raw, signed));
    }
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", o.publicKey, o.signature, signed);
  } catch {
    return false;
  }
}

export const randomChallenge = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const decode = (s: string): Uint8Array | null => { try { return base64urlDecode(s); } catch { return null; } };
