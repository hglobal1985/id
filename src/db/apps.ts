// Data access for the App registry, App status switch, sign-in nonces and App sessions (ADR 0011).
import { hashSecret, randomToken, timingSafeEqual, uuidv7 } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";
import { appDefinition, parseApp, type AppEntry, type AppStatus } from "../apps/registry";
import { auditStatement } from "./audit";

// ---------- registry (memory cache, 30 seconds per isolate) ----------

/** A registration or status change reaches every location within this time. Memory only (never a table). */
export const REGISTRY_CACHE_MS = 30 * 1000;
/** After a failed read the database is left alone this long. */
const RETRY_MS = 10 * 1000;

interface Snapshot {
  db: D1Database;
  loadedAt: number;
  retryAt: number;
  apps: Map<string, AppEntry>;
  invalid: string[];
  ok: boolean;
}

let snapshot: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

export function clearAppCache(): void {
  snapshot = null;
  inflight = null;
}

async function read(db: D1Database, now: Date): Promise<Snapshot> {
  const rows = await db.prepare("SELECT app_id, definition FROM registered_apps ORDER BY app_id").all<{ app_id: string; definition: string }>();
  const overrides = await db.prepare("SELECT app_id, status FROM app_status_overrides").all<{ app_id: string; status: AppStatus }>();
  const status = new Map((overrides.results ?? []).map((r) => [r.app_id, r.status]));
  const apps = new Map<string, AppEntry>();
  const invalid: string[] = [];
  for (const row of rows.results ?? []) {
    let app: AppEntry | undefined;
    try {
      app = parseApp(JSON.parse(row.definition));
      if (app.app_id !== row.app_id) app = undefined;
    } catch {
      app = undefined;
    }
    if (!app) {
      // A broken row is never used. Without a definition the App is unknown, which refuses sign-in (fail closed).
      invalid.push(row.app_id);
      console.error(JSON.stringify({ event: "registered_app.invalid", app_id: row.app_id }));
      continue;
    }
    const effective = status.get(app.app_id);
    apps.set(app.app_id, effective && effective !== app.status ? { ...app, status: effective } : app);
  }
  return { db, loadedAt: now.getTime(), retryAt: 0, apps, invalid, ok: true };
}

async function load(db: D1Database, now: Date): Promise<Snapshot> {
  const t = now.getTime();
  const current = snapshot && snapshot.db === db ? snapshot : null;
  if (current && current.ok && t - current.loadedAt < REGISTRY_CACHE_MS && t >= current.loadedAt) return current;
  if (current && !current.ok && t < current.retryAt) throw new Error("app registry unavailable");
  if (inflight) return inflight;
  const run = read(db, now)
    .then((s) => {
      snapshot = s;
      return s;
    })
    .catch((e: unknown) => {
      // Fail closed: with the registry unreadable no App is known, so nobody signs in on stale data.
      snapshot = { db, loadedAt: 0, retryAt: t + RETRY_MS, apps: new Map(), invalid: [], ok: false };
      throw e;
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

/** The registered App with its effective status (back-office switch applied), or undefined. */
export async function getApp(db: D1Database, appId: unknown, now: Date): Promise<AppEntry | undefined> {
  if (typeof appId !== "string" || appId.length > 32) return undefined;
  return (await load(db, now)).apps.get(appId);
}

export async function listApps(db: D1Database, now: Date): Promise<{ apps: AppEntry[]; invalid: string[] }> {
  const s = await load(db, now);
  return { apps: [...s.apps.values()], invalid: s.invalid };
}

/** True when `origin` is the web version of a registered App that has not been killed (CORS on /v1). */
export async function isAppWebOrigin(db: D1Database, origin: string, now: Date): Promise<boolean> {
  for (const app of (await load(db, now)).apps.values()) if (app.status !== "killed" && app.web_origins.includes(origin)) return true;
  return false;
}

export type SaveResult = "created" | "updated" | "exists" | "not_found";

/** Super admin only (checked by the caller). One batch: the App row and its audit entry. */
export async function saveApp(db: D1Database, app: AppEntry, mode: "create" | "update", actor: { memberId: string; requestId: string }, now: Date): Promise<SaveResult> {
  const existing = await db.prepare("SELECT 1 AS found FROM registered_apps WHERE app_id = ?").bind(app.app_id).first<{ found: number }>();
  if (mode === "create" && existing) return "exists";
  if (mode === "update" && !existing) return "not_found";
  const ts = taipeiIso(now);
  const definition = JSON.stringify(appDefinition(app));
  await db.batch([
    mode === "create"
      ? db.prepare("INSERT INTO registered_apps (app_id, definition, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)").bind(app.app_id, definition, ts, actor.memberId, ts, actor.memberId)
      : db.prepare("UPDATE registered_apps SET definition = ?, updated_at = ?, updated_by = ? WHERE app_id = ?").bind(definition, ts, actor.memberId, app.app_id),
    auditStatement(db, { actorType: "staff", actorId: actor.memberId, action: mode === "create" ? "app.register" : "app.update", targetType: "app", targetId: app.app_id, appId: app.app_id, result: "success", requestId: actor.requestId }, now),
  ]);
  clearAppCache();
  return mode === "create" ? "created" : "updated";
}

/** The stored definition (without the status switch applied), for the edit form. */
export async function readStoredApp(db: D1Database, appId: string): Promise<AppEntry | null> {
  const row = await db.prepare("SELECT definition FROM registered_apps WHERE app_id = ?").bind(appId).first<{ definition: string }>();
  if (!row) return null;
  try {
    return parseApp(JSON.parse(row.definition));
  } catch {
    return null;
  }
}

export async function setAppStatus(db: D1Database, appId: string, status: AppStatus, reason: string | null, actor: { memberId: string; requestId: string }, now: Date): Promise<boolean> {
  const existing = await db.prepare("SELECT 1 AS found FROM registered_apps WHERE app_id = ?").bind(appId).first<{ found: number }>();
  if (!existing) return false;
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_status_overrides (app_id, status, reason, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (app_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
      .bind(appId, status, reason, taipeiIso(now), actor.memberId),
    auditStatement(db, { actorType: "staff", actorId: actor.memberId, action: `app.status.${status}`, targetType: "app", targetId: appId, appId, result: "success", requestId: actor.requestId }, now),
  ]);
  clearAppCache();
  return true;
}

export interface AppStats {
  members: number;
  active_sessions: number;
  last_sign_in_at: string | null;
  status_reason: string | null;
  status_updated_at: string | null;
  integrated_version: string | null;
  integrated_reported_at: string | null;
}

export async function appStats(db: D1Database, now: Date): Promise<Map<string, AppStats>> {
  const out = new Map<string, AppStats>();
  const at = (id: string): AppStats => {
    let s = out.get(id);
    if (!s) {
      s = { members: 0, active_sessions: 0, last_sign_in_at: null, status_reason: null, status_updated_at: null, integrated_version: null, integrated_reported_at: null };
      out.set(id, s);
    }
    return s;
  };
  const [members, sessions, overrides, reports] = await Promise.all([
    db.prepare("SELECT app_id, COUNT(*) AS n, MAX(last_seen_at) AS last FROM member_apps GROUP BY app_id").all<{ app_id: string; n: number; last: string | null }>(),
    db.prepare("SELECT app_id, COUNT(*) AS n FROM app_sessions WHERE revoked_epoch IS NULL AND expires_epoch > ? GROUP BY app_id").bind(epochSeconds(now)).all<{ app_id: string; n: number }>(),
    db.prepare("SELECT app_id, reason, updated_at FROM app_status_overrides").all<{ app_id: string; reason: string | null; updated_at: string }>(),
    db.prepare("SELECT app_id, integrated_version, reported_at FROM app_handoff_reports").all<{ app_id: string; integrated_version: string; reported_at: string }>(),
  ]);
  for (const r of members.results ?? []) Object.assign(at(r.app_id), { members: r.n, last_sign_in_at: r.last });
  for (const r of sessions.results ?? []) at(r.app_id).active_sessions = r.n;
  for (const r of overrides.results ?? []) Object.assign(at(r.app_id), { status_reason: r.reason, status_updated_at: r.updated_at });
  for (const r of reports.results ?? []) Object.assign(at(r.app_id), { integrated_version: r.integrated_version, integrated_reported_at: r.reported_at });
  return out;
}

export async function reportIntegratedVersion(db: D1Database, appId: string, version: string, memberId: string, now: Date): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_handoff_reports (app_id, integrated_version, reported_at, reported_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (app_id) DO UPDATE SET integrated_version = excluded.integrated_version, reported_at = excluded.reported_at, reported_by = excluded.reported_by`,
    )
    .bind(appId, version, taipeiIso(now), memberId)
    .run();
}

// ---------- sign-in nonces ----------

export const NONCE_TTL = 10 * 60;

export async function issueNonce(db: D1Database, appId: string, now: Date): Promise<string> {
  const nonce = randomToken();
  await db
    .prepare("INSERT INTO app_nonces (nonce_hash, app_id, expires_epoch, created_at) VALUES (?, ?, ?, ?)")
    .bind(await hashSecret(nonce), appId, epochSeconds(now) + NONCE_TTL, taipeiIso(now))
    .run();
  return nonce;
}

/** Consumes a nonce exactly once, and only for the App it was issued to. */
export async function consumeNonce(db: D1Database, nonce: string, appId: string, now: Date): Promise<boolean> {
  const t = epochSeconds(now);
  const res = await db
    .prepare("UPDATE app_nonces SET consumed_epoch = ? WHERE nonce_hash = ? AND app_id = ? AND consumed_epoch IS NULL AND expires_epoch > ?")
    .bind(t, await hashSecret(nonce), appId, t)
    .run();
  return res.meta.changes === 1;
}

// ---------- App sessions and refresh tokens ----------

export const APP_REFRESH_TTL = 30 * 24 * 3600;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface AppSessionRow {
  id: string;
  member_id: string;
  app_id: string;
  refresh_hash: string;
  previous_refresh_hash: string | null;
  scope: string;
  auth_time_epoch: number;
  expires_epoch: number;
  revoked_epoch: number | null;
}

async function newRefresh(sessionId: string): Promise<{ token: string; hash: string }> {
  const secret = randomToken();
  return { token: `${sessionId}.${secret}`, hash: await hashSecret(secret) };
}

export async function createAppSession(
  db: D1Database,
  v: { memberId: string; appId: string; scope: string; deviceLabel: string | null; requestId: string; ssoId?: string; method?: "google" | "sso" },
  now: Date,
): Promise<{ session: AppSessionRow; refreshToken: string }> {
  const id = uuidv7(now.getTime());
  const refresh = await newRefresh(id);
  const t = epochSeconds(now);
  const ts = taipeiIso(now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_sessions (id, member_id, app_id, refresh_hash, scope, device_label, auth_time_epoch, last_used_epoch, expires_epoch, created_at, sso_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, v.memberId, v.appId, refresh.hash, v.scope, v.deviceLabel, t, t, t + APP_REFRESH_TTL, ts, v.ssoId ?? null),
    db
      .prepare("INSERT INTO member_apps (member_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (member_id, app_id) DO UPDATE SET last_seen_at = excluded.last_seen_at")
      .bind(v.memberId, v.appId, ts, ts),
    auditStatement(db, { actorType: "member", actorId: v.memberId, action: "app.login", targetType: "app_session", targetId: id, appId: v.appId, result: "success", requestId: v.requestId, detail: { method: v.method ?? "google" } }, now),
  ]);
  return {
    session: { id, member_id: v.memberId, app_id: v.appId, refresh_hash: refresh.hash, previous_refresh_hash: null, scope: v.scope, auth_time_epoch: t, expires_epoch: t + APP_REFRESH_TTL, revoked_epoch: null },
    refreshToken: refresh.token,
  };
}

export type AppRefresh =
  | { kind: "ok"; session: AppSessionRow; refreshToken: string }
  | { kind: "invalid" }
  | { kind: "reused"; session: AppSessionRow }
  | { kind: "disabled" };

/** Rotates a refresh token. Presenting the previous (already rotated) token revokes the whole session. */
export async function rotateAppRefresh(db: D1Database, token: unknown, requestId: string, now: Date): Promise<AppRefresh> {
  if (typeof token !== "string" || token.length > 200) return { kind: "invalid" };
  const dot = token.indexOf(".");
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (dot <= 0 || !SESSION_ID.test(id) || !SECRET.test(secret)) return { kind: "invalid" };
  const t = epochSeconds(now);
  const row = await db
    .prepare(
      `SELECT s.id, s.member_id, s.app_id, s.refresh_hash, s.previous_refresh_hash, s.scope, s.auth_time_epoch, s.expires_epoch, s.revoked_epoch, m.status AS member_status
       FROM app_sessions s JOIN members m ON m.id = s.member_id WHERE s.id = ?`,
    )
    .bind(id)
    .first<AppSessionRow & { member_status: string }>();
  if (!row || row.revoked_epoch !== null || row.expires_epoch <= t) return { kind: "invalid" };
  const hash = await hashSecret(secret);
  if (row.previous_refresh_hash && timingSafeEqual(hash, row.previous_refresh_hash)) {
    await db.batch([
      db.prepare("UPDATE app_sessions SET revoked_epoch = ?, revoke_reason = 'refresh_reuse' WHERE id = ? AND revoked_epoch IS NULL").bind(t, id),
      auditStatement(db, { actorType: "system", actorId: row.member_id, action: "app.refresh_reuse", targetType: "app_session", targetId: id, appId: row.app_id, result: "denied", requestId }, now),
    ]);
    return { kind: "reused", session: row };
  }
  if (!timingSafeEqual(hash, row.refresh_hash)) return { kind: "invalid" };
  if (row.member_status !== "active") return { kind: "disabled" };
  const next = await newRefresh(id);
  const res = await db
    .prepare(
      `UPDATE app_sessions SET previous_refresh_hash = refresh_hash, refresh_hash = ?, last_used_epoch = ?, expires_epoch = ?
       WHERE id = ? AND refresh_hash = ? AND revoked_epoch IS NULL`,
    )
    .bind(next.hash, t, t + APP_REFRESH_TTL, id, row.refresh_hash)
    .run();
  if (res.meta.changes !== 1) return { kind: "invalid" };
  await db.prepare("UPDATE member_apps SET last_seen_at = ? WHERE member_id = ? AND app_id = ?").bind(taipeiIso(now), row.member_id, row.app_id).run();
  return { kind: "ok", session: { ...row, refresh_hash: next.hash, expires_epoch: t + APP_REFRESH_TTL }, refreshToken: next.token };
}

/** True when the App session exists for this member and App, is not revoked or expired, and the member is active. */
export async function isAppSessionActive(db: D1Database, sessionId: string, memberId: string, appId: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM app_sessions s JOIN members m ON m.id = s.member_id
       WHERE s.id = ? AND s.member_id = ? AND s.app_id = ? AND s.revoked_epoch IS NULL AND s.expires_epoch > ? AND m.status = 'active'`,
    )
    .bind(sessionId, memberId, appId, epochSeconds(now))
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export async function revokeAppSession(db: D1Database, v: { sessionId: string; memberId: string; appId: string; requestId: string }, now: Date): Promise<void> {
  await db.batch([
    db.prepare("UPDATE app_sessions SET revoked_epoch = ?, revoke_reason = 'logout' WHERE id = ? AND revoked_epoch IS NULL").bind(epochSeconds(now), v.sessionId),
    auditStatement(db, { actorType: "member", actorId: v.memberId, action: "app.logout", targetType: "app_session", targetId: v.sessionId, appId: v.appId, result: "success", requestId: v.requestId }, now),
  ]);
}

/** "Sign out everywhere": every App session, every central sign-in session and every OIDC refresh token of the member. */
export async function revokeEverything(db: D1Database, v: { memberId: string; appId: string | null; requestId: string }, now: Date): Promise<void> {
  const t = epochSeconds(now);
  await db.batch([
    db.prepare("UPDATE app_sessions SET revoked_epoch = ?, revoke_reason = 'logout_all' WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, v.memberId),
    db.prepare("UPDATE device_sso SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, v.memberId),
    db.prepare("UPDATE login_sessions SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, v.memberId),
    db.prepare("UPDATE oauth_refresh_tokens SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, v.memberId),
    auditStatement(db, { actorType: "member", actorId: v.memberId, action: "app.logout_all", targetType: "member", targetId: v.memberId, appId: v.appId, result: "success", requestId: v.requestId }, now),
  ]);
}
