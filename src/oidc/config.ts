import type { Env } from "../env";
import { importSigningKey, type PublicJwk, type SigningKey } from "../lib/jwt";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Issuer for this deployment. Production must set ISSUER explicitly; other environments may fall back
 * to the request origin (e.g. a workers.dev staging URL or local dev).
 */
export function resolveIssuer(env: Env, requestUrl: string): string {
  if (env.ISSUER) return env.ISSUER.replace(/\/+$/, "");
  if (env.ENVIRONMENT === "production") throw new ConfigError("ISSUER is not set");
  return new URL(requestUrl).origin;
}

let cache: { raw: string; prev: string; keys: { current: SigningKey; publicKeys: PublicJwk[] } } | null = null;

/** Current signing key plus every public key to publish (current first, then previous during rotation). */
export async function getSigningKeys(env: Env): Promise<{ current: SigningKey; publicKeys: PublicJwk[] }> {
  const raw = env.OIDC_SIGNING_JWK;
  if (!raw) throw new ConfigError("OIDC_SIGNING_JWK is not set");
  const prev = env.OIDC_SIGNING_JWK_PREVIOUS ?? "";
  if (cache && cache.raw === raw && cache.prev === prev) return cache.keys;
  const current = await importSigningKey(raw);
  const publicKeys = [current.publicJwk];
  if (prev) {
    const p = await importSigningKey(prev);
    if (p.kid !== current.kid) publicKeys.push(p.publicJwk);
  }
  const keys = { current, publicKeys };
  cache = { raw, prev, keys };
  return keys;
}

/** Google client settings. Values pasted into secret stores often carry a trailing newline or spaces; trim them. */
export function requireGoogleConfig(env: Env): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new ConfigError("Google sign-in is not configured");
  return { clientId, clientSecret };
}
