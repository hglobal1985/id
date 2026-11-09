// Google sign-in (OpenID Connect, authorization code + PKCE). Members are bound only by Google `sub`.
import type { Deps } from "../deps";
import type { GoogleIdentity } from "../db/identity";
import { verifyJwt, type PublicJwk } from "../lib/jwt";
import { epochSeconds } from "../lib/time";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export class GoogleSignInError extends Error {}

export function googleAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

let jwksCache: { keys: PublicJwk[]; until: number } | null = null;

async function googleKeys(deps: Deps, forceRefresh = false): Promise<PublicJwk[]> {
  const now = epochSeconds(deps.now());
  if (!forceRefresh && jwksCache && jwksCache.until > now) return jwksCache.keys;
  const res = await deps.fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new GoogleSignInError("jwks fetch failed");
  const body = (await res.json()) as { keys?: PublicJwk[] };
  const keys = (body.keys ?? []).filter((k) => k.kty === "RSA" && typeof k.kid === "string");
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  jwksCache = { keys, until: now + Math.min(Math.max(maxAge, 60), 24 * 3600) };
  return keys;
}

/** Test hook. */
export function resetGoogleKeyCache(): void {
  jwksCache = null;
}

/** Exchanges the Google code and returns the verified identity. Throws GoogleSignInError on any problem. */
export async function completeGoogleSignIn(
  deps: Deps,
  p: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string; nonce: string },
): Promise<GoogleIdentity> {
  const res = await deps.fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code_verifier: p.codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new GoogleSignInError("token exchange failed");
  const tokens = (await res.json()) as { id_token?: string };
  if (typeof tokens.id_token !== "string") throw new GoogleSignInError("no id_token");

  const now = epochSeconds(deps.now());
  const verify = async (keys: PublicJwk[]) =>
    verifyJwt(tokens.id_token as string, keys, { issuer: GOOGLE_ISSUERS, audience: p.clientId, now });
  let claims;
  try {
    claims = await verify(await googleKeys(deps));
  } catch (e) {
    // Google rotates keys; retry once with fresh keys when the kid is unknown.
    if ((e as Error).message !== "kid") throw new GoogleSignInError("id_token invalid");
    try {
      claims = await verify(await googleKeys(deps, true));
    } catch {
      throw new GoogleSignInError("id_token invalid");
    }
  }
  if (claims.nonce !== p.nonce) throw new GoogleSignInError("nonce mismatch");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new GoogleSignInError("no sub");
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture : undefined,
  };
}
