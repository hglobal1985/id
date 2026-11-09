// Minimal RS256 JWT sign/verify on Web Crypto. Only RS256 is accepted (no "none", no HS*).
import { base64url, base64urlDecode, utf8 } from "./crypto";

export type JwtPayload = Record<string, unknown> & {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
};

export interface PublicJwk {
  kty: "RSA";
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: PublicJwk;
}

/** Imports the private RSA JWK kept in the OIDC_SIGNING_JWK Worker secret. */
export async function importSigningKey(jwkJson: string): Promise<SigningKey> {
  const jwk = JSON.parse(jwkJson) as JsonWebKey & { kid?: string };
  if (jwk.kty !== "RSA" || !jwk.d || !jwk.n || !jwk.e || !jwk.kid) throw new Error("signing key must be a private RSA JWK with kid");
  const privateKey = await crypto.subtle.importKey("jwk", { ...jwk, alg: "RS256", ext: false }, RS256, false, ["sign"]);
  return {
    kid: jwk.kid,
    privateKey,
    publicJwk: { kty: "RSA", kid: jwk.kid, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig" },
  };
}

export async function signJwt(payload: JwtPayload, key: SigningKey, typ = "JWT"): Promise<string> {
  const header = { alg: "RS256", typ, kid: key.kid };
  const input = `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign(RS256, key.privateKey, utf8(input)));
  return `${input}.${base64url(sig)}`;
}

export interface VerifyOptions {
  issuer: string | string[];
  audience?: string;
  /** Seconds since epoch; defaults to now. */
  now?: number;
  /** Skip the exp check (only for id_token_hint at logout). */
  ignoreExpiry?: boolean;
  clockSkew?: number;
  typ?: string;
}

export class JwtError extends Error {}

/** Verifies an RS256 JWT against a key set and checks iss/aud/exp/nbf. Throws JwtError on any failure. */
export async function verifyJwt(token: string, keys: PublicJwk[], opts: VerifyOptions): Promise<JwtPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string; typ?: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(p)));
  } catch {
    throw new JwtError("malformed");
  }
  if (header.alg !== "RS256") throw new JwtError("alg");
  if (opts.typ && header.typ !== opts.typ) throw new JwtError("typ");
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw new JwtError("kid");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RS256, false, ["verify"]);
  let sig: Uint8Array;
  try {
    sig = base64urlDecode(s);
  } catch {
    throw new JwtError("malformed");
  }
  if (!(await crypto.subtle.verify(RS256, key, sig, utf8(`${h}.${p}`)))) throw new JwtError("signature");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockSkew ?? 60;
  const issuers = Array.isArray(opts.issuer) ? opts.issuer : [opts.issuer];
  if (typeof payload.iss !== "string" || !issuers.includes(payload.iss)) throw new JwtError("iss");
  if (opts.audience !== undefined) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(opts.audience)) throw new JwtError("aud");
  }
  if (!opts.ignoreExpiry && (typeof payload.exp !== "number" || payload.exp + skew < now)) throw new JwtError("exp");
  if (typeof payload.nbf === "number" && payload.nbf - skew > now) throw new JwtError("nbf");
  return payload;
}
