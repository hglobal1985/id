// Data access for members, sign-in sessions, login flows, OIDC clients, codes and refresh tokens.
import { hashSecret, randomToken, uuidv7 } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { ensureMemberNumber } from "./member-numbers";

export const LIFETIME = {
  session: 30 * 24 * 3600,
  loginFlow: 10 * 60,
  authorizationCode: 60,
  accessToken: 15 * 60,
  idToken: 15 * 60,
  refreshToken: 30 * 24 * 3600,
} as const;

export interface MemberRow {
  id: string;
  google_sub: string;
  google_email: string | null;
  google_email_verified: number;
  google_picture_url: string | null;
  display_name: string | null;
  registration_country: string;
  status: "active" | "disabled" | "deleted";
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  avatar_url: string | null;
  avatar_source: "none" | "google" | "upload";
  amway_enabled: number;
  /** 1 once the member has changed the member number themselves. */
  number_customized: number;
}

/** The picture URL when it is an https address (Google serves profile pictures from googleusercontent.com). */
export function httpsOrNull(url: string | undefined | null): string | null {
  return url && /^https:\/\/[^\s]{1,500}$/.test(url) ? url : null;
}

export interface GoogleIdentity {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/**
 * Finds the member bound to this Google `sub`, or creates one. Binding is by `sub` only:
 * a different Google account with the same email is a different member.
 */
export async function upsertMemberByGoogle(
  db: D1Database,
  g: GoogleIdentity,
  country: string,
  now: Date,
  requestId: string,
): Promise<{ member: MemberRow; created: boolean }> {
  const ts = taipeiIso(now);
  const existing = await db.prepare("SELECT * FROM members WHERE google_sub = ?").bind(g.sub).first<MemberRow>();
  if (existing) {
    await db
      .prepare(
        `UPDATE members SET google_email = ?, google_email_verified = ?, google_picture_url = ?,
           avatar_url = CASE WHEN avatar_source = 'google' THEN ? ELSE avatar_url END, last_login_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(g.email ?? null, g.emailVerified ? 1 : 0, g.picture ?? null, httpsOrNull(g.picture), ts, ts, existing.id)
      .run();
    return { member: { ...existing, last_login_at: ts }, created: false };
  }
  const id = uuidv7(now.getTime());
  const cc = /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : "TW";
  const res = await db
    .prepare(
      `INSERT INTO members (id, google_sub, google_email, google_email_verified, google_picture_url, display_name,
         registration_country, status, created_at, updated_at, last_login_at, avatar_url, avatar_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
       ON CONFLICT (google_sub) DO NOTHING`,
    )
    .bind(id, g.sub, g.email ?? null, g.emailVerified ? 1 : 0, g.picture ?? null, g.name?.slice(0, 100) ?? null, cc, ts, ts, ts, httpsOrNull(g.picture), httpsOrNull(g.picture) ? "google" : "none")
    .run();
  if (!res.meta.changes) {
    // Lost a race with a concurrent first sign-in for the same Google account.
    const row = await db.prepare("SELECT * FROM members WHERE google_sub = ?").bind(g.sub).first<MemberRow>();
    if (!row) throw new Error("member upsert failed");
    return { member: row, created: false };
  }
  await auditStatement(
    db,
    { actorType: "member", actorId: id, action: "member.create", targetType: "member", targetId: id, result: "success", requestId },
    now,
  ).run();
  // Every member has a member number from the start (random, from the sign-up country).
  await ensureMemberNumber(db, id, cc, now, requestId);
  const member = await db.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<MemberRow>();
  if (!member) throw new Error("member upsert failed");
  return { member, created: true };
}

export async function getMember(db: D1Database, id: string): Promise<MemberRow | null> {
  return db.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<MemberRow>();
}

// ---------- sessions ----------

export interface SessionRow {
  id: string;
  member_id: string;
  auth_time_epoch: number;
  expires_epoch: number;
  revoked_epoch: number | null;
}

export async function createSession(db: D1Database, memberId: string, now: Date): Promise<{ token: string; session: SessionRow }> {
  const token = randomToken();
  const session: SessionRow = {
    id: uuidv7(now.getTime()),
    member_id: memberId,
    auth_time_epoch: epochSeconds(now),
    expires_epoch: epochSeconds(now) + LIFETIME.session,
    revoked_epoch: null,
  };
  await db
    .prepare(
      `INSERT INTO login_sessions (id, token_hash, member_id, auth_time_epoch, expires_epoch, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(session.id, await hashSecret(token), memberId, session.auth_time_epoch, session.expires_epoch, taipeiIso(now))
    .run();
  return { token, session };
}

/** Active session for a cookie token, or null (expired, revoked, unknown, or member not active). */
export async function findActiveSessionByToken(db: D1Database, token: string, now: Date): Promise<SessionRow | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.member_id, s.auth_time_epoch, s.expires_epoch, s.revoked_epoch
       FROM login_sessions s JOIN members m ON m.id = s.member_id
       WHERE s.token_hash = ? AND s.revoked_epoch IS NULL AND s.expires_epoch > ? AND m.status = 'active'`,
    )
    .bind(await hashSecret(token), epochSeconds(now))
    .first<SessionRow>();
  return row ?? null;
}

/** True when the session exists, is not revoked or expired, and its member is active. Fail closed. */
export async function isSessionActive(db: D1Database, sessionId: string, memberId: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM login_sessions s JOIN members m ON m.id = s.member_id
       WHERE s.id = ? AND s.member_id = ? AND s.revoked_epoch IS NULL AND s.expires_epoch > ? AND m.status = 'active'`,
    )
    .bind(sessionId, memberId, epochSeconds(now))
    .first<{ ok: number }>();
  return row?.ok === 1;
}

/** Revokes a sign-in session and every refresh token issued under it (all apps: linked logout). */
export async function revokeSession(db: D1Database, sessionId: string, now: Date): Promise<void> {
  const t = epochSeconds(now);
  await db.batch([
    db.prepare("UPDATE login_sessions SET revoked_epoch = ? WHERE id = ? AND revoked_epoch IS NULL").bind(t, sessionId),
    db.prepare("UPDATE oauth_refresh_tokens SET revoked_epoch = ? WHERE session_id = ? AND revoked_epoch IS NULL").bind(t, sessionId),
  ]);
}

// ---------- login flows ----------

export interface LoginFlowRow {
  id: string;
  browser_hash: string;
  state_hash: string | null;
  nonce: string | null;
  code_verifier: string | null;
  return_to: string;
  expires_epoch: number;
  used_epoch: number | null;
}

export async function createLoginFlow(db: D1Database, returnTo: string, now: Date): Promise<{ flowId: string; browserToken: string }> {
  const flowId = randomToken(16);
  const browserToken = randomToken();
  await db
    .prepare(`INSERT INTO login_flows (id, browser_hash, return_to, expires_epoch, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(flowId, await hashSecret(browserToken), returnTo, epochSeconds(now) + LIFETIME.loginFlow, taipeiIso(now))
    .run();
  return { flowId, browserToken };
}

export async function getOpenLoginFlow(db: D1Database, flowId: string, now: Date): Promise<LoginFlowRow | null> {
  return db
    .prepare("SELECT * FROM login_flows WHERE id = ? AND used_epoch IS NULL AND expires_epoch > ?")
    .bind(flowId, epochSeconds(now))
    .first<LoginFlowRow>();
}

export async function startLoginFlow(db: D1Database, flowId: string, state: string, nonce: string, codeVerifier: string): Promise<void> {
  await db
    .prepare("UPDATE login_flows SET state_hash = ?, nonce = ?, code_verifier = ? WHERE id = ? AND used_epoch IS NULL")
    .bind(await hashSecret(state), nonce, codeVerifier, flowId)
    .run();
}

/** Atomically consumes the flow for a Google `state`. Returns null if unknown, expired or already used. */
export async function consumeLoginFlowByState(db: D1Database, state: string, now: Date): Promise<LoginFlowRow | null> {
  const t = epochSeconds(now);
  const row = await db
    .prepare("SELECT * FROM login_flows WHERE state_hash = ? AND used_epoch IS NULL AND expires_epoch > ?")
    .bind(await hashSecret(state), t)
    .first<LoginFlowRow>();
  if (!row) return null;
  const res = await db.prepare("UPDATE login_flows SET used_epoch = ? WHERE id = ? AND used_epoch IS NULL").bind(t, row.id).run();
  return res.meta.changes === 1 ? row : null;
}

// ---------- clients ----------

export interface ClientRow {
  client_id: string;
  name: string;
  client_secret_hash: string | null;
  token_endpoint_auth_method: "none" | "client_secret_basic" | "client_secret_post";
  redirect_uris: string;
  post_logout_redirect_uris: string;
  allowed_scopes: string;
  status: "active" | "disabled";
}

export async function getActiveClient(db: D1Database, clientId: string | undefined): Promise<ClientRow | null> {
  if (!clientId || clientId.length > 200) return null;
  return db.prepare("SELECT * FROM oauth_clients WHERE client_id = ? AND status = 'active'").bind(clientId).first<ClientRow>();
}

// ---------- authorization codes ----------

export interface CodeRow {
  code_hash: string;
  client_id: string;
  member_id: string;
  session_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  nonce: string | null;
  auth_time_epoch: number;
  expires_epoch: number;
  used_epoch: number | null;
}

export async function createAuthorizationCode(
  db: D1Database,
  v: Omit<CodeRow, "code_hash" | "expires_epoch" | "used_epoch">,
  now: Date,
): Promise<string> {
  const code = randomToken();
  await db
    .prepare(
      `INSERT INTO oauth_authorization_codes (code_hash, client_id, member_id, session_id, redirect_uri, scope, code_challenge, nonce,
         auth_time_epoch, expires_epoch, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await hashSecret(code),
      v.client_id,
      v.member_id,
      v.session_id,
      v.redirect_uri,
      v.scope,
      v.code_challenge,
      v.nonce,
      v.auth_time_epoch,
      epochSeconds(now) + LIFETIME.authorizationCode,
      taipeiIso(now),
    )
    .run();
  return code;
}

export type CodeRedeem = { kind: "ok"; row: CodeRow } | { kind: "invalid" } | { kind: "replayed"; row: CodeRow };

/** Marks a code used exactly once. A second redemption is reported as `replayed`. */
export async function redeemAuthorizationCode(db: D1Database, code: string, now: Date): Promise<CodeRedeem> {
  const hash = await hashSecret(code);
  const row = await db.prepare("SELECT * FROM oauth_authorization_codes WHERE code_hash = ?").bind(hash).first<CodeRow>();
  if (!row) return { kind: "invalid" };
  if (row.used_epoch !== null) return { kind: "replayed", row };
  if (row.expires_epoch <= epochSeconds(now)) return { kind: "invalid" };
  const res = await db
    .prepare("UPDATE oauth_authorization_codes SET used_epoch = ? WHERE code_hash = ? AND used_epoch IS NULL")
    .bind(epochSeconds(now), hash)
    .run();
  return res.meta.changes === 1 ? { kind: "ok", row } : { kind: "replayed", row };
}

// ---------- refresh tokens ----------

export interface RefreshRow {
  token_hash: string;
  family_id: string;
  client_id: string;
  member_id: string;
  session_id: string;
  scope: string;
  auth_time_epoch: number;
  expires_epoch: number;
  rotated_epoch: number | null;
  revoked_epoch: number | null;
}

export async function createRefreshToken(
  db: D1Database,
  v: { familyId?: string; clientId: string; memberId: string; sessionId: string; scope: string; authTime: number },
  now: Date,
): Promise<string> {
  const token = randomToken();
  await db
    .prepare(
      `INSERT INTO oauth_refresh_tokens (token_hash, family_id, client_id, member_id, session_id, scope, auth_time_epoch, expires_epoch, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await hashSecret(token),
      v.familyId ?? uuidv7(now.getTime()),
      v.clientId,
      v.memberId,
      v.sessionId,
      v.scope,
      v.authTime,
      epochSeconds(now) + LIFETIME.refreshToken,
      taipeiIso(now),
    )
    .run();
  return token;
}

export type RefreshUse = { kind: "ok"; row: RefreshRow } | { kind: "invalid" } | { kind: "reused"; row: RefreshRow };

/** Rotates a refresh token. Presenting an already-rotated token is reported as `reused`. */
export async function useRefreshToken(db: D1Database, token: string, now: Date): Promise<RefreshUse> {
  const hash = await hashSecret(token);
  const t = epochSeconds(now);
  const row = await db.prepare("SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?").bind(hash).first<RefreshRow>();
  if (!row || row.revoked_epoch !== null) return { kind: "invalid" };
  if (row.rotated_epoch !== null) return { kind: "reused", row };
  if (row.expires_epoch <= t) return { kind: "invalid" };
  const res = await db
    .prepare("UPDATE oauth_refresh_tokens SET rotated_epoch = ? WHERE token_hash = ? AND rotated_epoch IS NULL AND revoked_epoch IS NULL")
    .bind(t, hash)
    .run();
  return res.meta.changes === 1 ? { kind: "ok", row } : { kind: "reused", row };
}

export async function revokeRefreshFamily(db: D1Database, familyId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE oauth_refresh_tokens SET revoked_epoch = ? WHERE family_id = ? AND revoked_epoch IS NULL")
    .bind(epochSeconds(now), familyId)
    .run();
}

export async function revokeRefreshForSessionClient(db: D1Database, sessionId: string, clientId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE oauth_refresh_tokens SET revoked_epoch = ? WHERE session_id = ? AND client_id = ? AND revoked_epoch IS NULL")
    .bind(epochSeconds(now), sessionId, clientId)
    .run();
}
