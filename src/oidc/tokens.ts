// Issuing and checking our own tokens (access token = RS256 JWT, typ at+jwt, RFC 9068).
import type { Env } from "../env";
import type { Deps } from "../deps";
import { LIFETIME, createRefreshToken, getActiveClient, getMember, isSessionActive } from "../db/identity";
import { randomToken } from "../lib/crypto";
import { JwtError, signJwt, verifyJwt, type JwtPayload } from "../lib/jwt";
import { epochSeconds } from "../lib/time";
import { getSigningKeys } from "./config";
import { parseScope } from "./scopes";

export interface Grant {
  clientId: string;
  memberId: string;
  sessionId: string;
  scope: string;
  authTime: number;
  nonce?: string | null;
  familyId?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  id_token: string;
  scope: string;
}

export async function issueTokens(env: Env, deps: Deps, issuer: string, g: Grant): Promise<TokenResponse> {
  const now = deps.now();
  const iat = epochSeconds(now);
  const { current } = await getSigningKeys(env);
  const scopes = parseScope(g.scope);

  const access = await signJwt(
    {
      iss: issuer,
      sub: g.memberId,
      aud: issuer,
      client_id: g.clientId,
      scope: g.scope,
      sid: g.sessionId,
      auth_time: g.authTime,
      iat,
      exp: iat + LIFETIME.accessToken,
      jti: randomToken(16),
    },
    current,
    "at+jwt",
  );

  const idClaims: JwtPayload = {
    iss: issuer,
    sub: g.memberId,
    aud: g.clientId,
    iat,
    exp: iat + LIFETIME.idToken,
    auth_time: g.authTime,
    sid: g.sessionId,
    azp: g.clientId,
  };
  if (g.nonce) idClaims.nonce = g.nonce;
  if (scopes.includes("profile")) Object.assign(idClaims, await profileClaims(env, g.memberId));
  const idToken = await signJwt(idClaims, current);

  const refresh = await createRefreshToken(
    env.DB,
    { familyId: g.familyId, clientId: g.clientId, memberId: g.memberId, sessionId: g.sessionId, scope: g.scope, authTime: g.authTime },
    now,
  );

  return { access_token: access, token_type: "Bearer", expires_in: LIFETIME.accessToken, refresh_token: refresh, id_token: idToken, scope: g.scope };
}

/** Claims for the `profile` scope. Only name and picture; no email, no Amway values. */
export async function profileClaims(env: Env, memberId: string): Promise<{ name?: string; picture?: string; updated_at?: number }> {
  const m = await getMember(env.DB, memberId);
  if (!m) return {};
  const out: { name?: string; picture?: string; updated_at?: number } = {};
  const dn = await env.DB.prepare("SELECT value FROM profile_field_values WHERE member_id = ? AND field_key = 'display_name'")
    .bind(memberId)
    .first<{ value: string }>();
  let name: unknown = m.display_name;
  if (dn) {
    try {
      name = JSON.parse(dn.value);
    } catch {
      name = m.display_name;
    }
  }
  if (typeof name === "string" && name) out.name = name;
  // The avatar is always public; none is set until the member chooses one.
  if (m.avatar_url) out.picture = m.avatar_url;
  const t = Date.parse(m.updated_at);
  if (!Number.isNaN(t)) out.updated_at = Math.floor(t / 1000);
  return out;
}

export interface AccessContext {
  memberId: string;
  clientId: string;
  sessionId: string;
  scope: string;
  authTime: number;
}

export type AccessCheck = { ok: true; ctx: AccessContext } | { ok: false; reason: "missing" | "invalid" };

/**
 * Validates a Bearer access token: signature, issuer, expiry, and that its sign-in session is still
 * active and the member is active. Any doubt means "invalid" (fail closed).
 */
export async function checkAccessToken(env: Env, deps: Deps, issuer: string, authorization: string | undefined): Promise<AccessCheck> {
  const m = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization ?? "");
  if (!m) return { ok: false, reason: "missing" };
  const now = deps.now();
  let claims: JwtPayload;
  try {
    const { publicKeys } = await getSigningKeys(env);
    claims = await verifyJwt(m[1] as string, publicKeys, { issuer, audience: issuer, now: epochSeconds(now), typ: "at+jwt", clockSkew: 30 });
  } catch (e) {
    if (e instanceof JwtError) return { ok: false, reason: "invalid" };
    throw e;
  }
  const { sub, client_id, sid, scope, auth_time } = claims as Record<string, unknown>;
  if (typeof sub !== "string" || typeof client_id !== "string" || typeof sid !== "string" || typeof scope !== "string") {
    return { ok: false, reason: "invalid" };
  }
  if (!(await isSessionActive(env.DB, sid, sub, now))) return { ok: false, reason: "invalid" };
  if (!(await getActiveClient(env.DB, client_id))) return { ok: false, reason: "invalid" };
  return { ok: true, ctx: { memberId: sub, clientId: client_id, sessionId: sid, scope, authTime: typeof auth_time === "number" ? auth_time : 0 } };
}
