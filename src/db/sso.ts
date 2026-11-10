// Data access for shared sign-in (ADR 0012): device records, their App sessions and single-use web codes.
import { hashSecret, randomToken, timingSafeEqual, uuidv7 } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";

export const SSO_TTL = 30 * 24 * 3600;
export const SSO_CODE_TTL = 2 * 60;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface SsoRow {
  id: string;
  member_id: string;
  token_hash: string;
  cookie_hash: string | null;
}

function parse(token: unknown): { id: string; secret: string } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const dot = token.indexOf(".");
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return dot > 0 && ID.test(id) && SECRET.test(secret) ? { id, secret } : null;
}

/** The live record for an id: not revoked, not expired, member still active. */
export async function liveSsoById(db: D1Database, id: string, now: Date): Promise<SsoRow | null> {
  return db
    .prepare(
      `SELECT d.id, d.member_id, d.token_hash, d.cookie_hash FROM device_sso d JOIN members m ON m.id = d.member_id
       WHERE d.id = ? AND d.revoked_epoch IS NULL AND d.expires_epoch > ? AND m.status = 'active'`,
    )
    .bind(id, epochSeconds(now))
    .first<SsoRow>();
}

/** The live record for a token held by an App (`via: "token"`) or by the browser cookie (`via: "cookie"`). */
export async function liveSso(db: D1Database, token: unknown, via: "token" | "cookie", now: Date): Promise<SsoRow | null> {
  const p = parse(token);
  if (!p) return null;
  const row = await liveSsoById(db, p.id, now);
  const expected = row ? (via === "token" ? row.token_hash : row.cookie_hash) : null;
  return row && expected && timingSafeEqual(await hashSecret(p.secret), expected) ? row : null;
}

/** Ends a shared sign-in and every App session that belongs to it. */
export function revokeSsoStatements(db: D1Database, id: string, reason: string, now: Date): D1PreparedStatement[] {
  const t = epochSeconds(now);
  return [
    db.prepare("UPDATE device_sso SET revoked_epoch = ? WHERE id = ? AND revoked_epoch IS NULL").bind(t, id),
    db.prepare("UPDATE app_sessions SET revoked_epoch = ?, revoke_reason = ? WHERE sso_id = ? AND revoked_epoch IS NULL").bind(t, reason, id),
  ];
}

/**
 * Creates the shared sign-in for the member of an App session. A previous one on this device is replaced:
 * same member → its sessions move to the new record; another member → that member is signed out of every App.
 */
export async function startSso(db: D1Database, v: { memberId: string; sessionId: string; appId: string; previous: SsoRow | null; requestId: string }, now: Date): Promise<string> {
  const id = uuidv7(now.getTime());
  const secret = randomToken();
  const t = epochSeconds(now);
  const stmts: D1PreparedStatement[] = [];
  if (v.previous && v.previous.member_id !== v.memberId) stmts.push(...revokeSsoStatements(db, v.previous.id, "sso_switch", now));
  else if (v.previous) {
    stmts.push(
      db.prepare("UPDATE device_sso SET revoked_epoch = ? WHERE id = ? AND revoked_epoch IS NULL").bind(t, v.previous.id),
      db.prepare("UPDATE app_sessions SET sso_id = ? WHERE sso_id = ?").bind(id, v.previous.id),
    );
  }
  stmts.push(
    db.prepare("INSERT INTO device_sso (id, member_id, token_hash, last_used_epoch, expires_epoch, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, v.memberId, await hashSecret(secret), t, t + SSO_TTL, taipeiIso(now)),
    db.prepare("UPDATE app_sessions SET sso_id = ? WHERE id = ? AND member_id = ?").bind(id, v.sessionId, v.memberId),
    auditStatement(db, { actorType: "member", actorId: v.memberId, action: "app.sso_start", targetType: "device_sso", targetId: id, appId: v.appId, result: "success", requestId: v.requestId }, now),
  );
  await db.batch(stmts);
  return `${id}.${secret}`;
}

export async function touchSso(db: D1Database, id: string, now: Date): Promise<void> {
  const t = epochSeconds(now);
  await db.prepare("UPDATE device_sso SET last_used_epoch = ?, expires_epoch = ? WHERE id = ?").bind(t, t + SSO_TTL, id).run();
}

export async function logoutSso(db: D1Database, sso: SsoRow, appId: string | null, requestId: string, now: Date): Promise<void> {
  await db.batch([
    ...revokeSsoStatements(db, sso.id, "sso_logout", now),
    auditStatement(db, { actorType: "member", actorId: sso.member_id, action: "app.sso_logout", targetType: "device_sso", targetId: sso.id, appId, result: "success", requestId }, now),
  ]);
}

/** Lets the central site remember this browser: returns the cookie value and stores only its hash. */
export async function adoptBrowser(db: D1Database, id: string): Promise<string> {
  const secret = randomToken();
  await db.prepare("UPDATE device_sso SET cookie_hash = ? WHERE id = ?").bind(await hashSecret(secret), id).run();
  return `${id}.${secret}`;
}

export async function createSsoCode(db: D1Database, v: { kind: "adopt" | "check"; ssoId: string; appId?: string; nonceHash?: string }, now: Date): Promise<string> {
  const code = randomToken();
  await db
    .prepare("INSERT INTO sso_codes (code_hash, kind, sso_id, app_id, nonce_hash, expires_epoch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await hashSecret(code), v.kind, v.ssoId, v.appId ?? null, v.nonceHash ?? null, epochSeconds(now) + SSO_CODE_TTL, taipeiIso(now))
    .run();
  return code;
}

/** Consumes a code exactly once. Returns its record, or null when unknown, expired, used or of another kind. */
export async function useSsoCode(db: D1Database, code: unknown, kind: "adopt" | "check", now: Date): Promise<{ sso_id: string; app_id: string | null; nonce_hash: string | null } | null> {
  if (typeof code !== "string" || !SECRET.test(code)) return null;
  const hash = await hashSecret(code);
  const t = epochSeconds(now);
  const row = await db.prepare("SELECT sso_id, app_id, nonce_hash FROM sso_codes WHERE code_hash = ? AND kind = ? AND used_epoch IS NULL AND expires_epoch > ?").bind(hash, kind, t).first<{ sso_id: string; app_id: string | null; nonce_hash: string | null }>();
  if (!row) return null;
  const res = await db.prepare("UPDATE sso_codes SET used_epoch = ? WHERE code_hash = ? AND used_epoch IS NULL").bind(t, hash).run();
  return res.meta.changes === 1 ? row : null;
}
