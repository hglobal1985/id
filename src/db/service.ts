// App-to-App restricted access (ADR 0021): each App gets one service credential (client credentials) that can only
// call the endpoints it is allowed to; the contact lookup replaces Apps keeping their own copy of members' e-mail.
import type { Env } from "../env";
import type { Deps } from "../deps";
import { hashSecret, randomToken, timingSafeEqual } from "../lib/crypto";
import { JwtError, signJwt, verifyJwt } from "../lib/jwt";
import { epochSeconds, taipeiIso } from "../lib/time";
import { getSigningKeys } from "../oidc/config";
import { getApp } from "./apps";
import { auditStatement } from "./audit";

export const SERVICE_TOKEN_LIFETIME = 600;
export const SERVICE_SCOPE = "service.lookup";
export const LOOKUP_MAX = 50;

/** New credential (replaces the old one). The secret is returned once; only its hash is stored. */
export async function rotateServiceSecret(db: D1Database, appId: string, by: string, requestId: string, now: Date): Promise<string> {
  const secret = `hgs_${randomToken(32)}`;
  const ts = taipeiIso(now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO app_service_credentials (app_id, secret_hash, created_at, created_by) VALUES (?, ?, ?, ?)
         ON CONFLICT (app_id) DO UPDATE SET secret_hash = excluded.secret_hash, created_at = excluded.created_at, created_by = excluded.created_by, last_used_at = NULL`,
      )
      .bind(appId, await hashSecret(secret), ts, by),
    auditStatement(db, { actorType: "staff", actorId: by, action: "app.service_secret.rotate", targetType: "app", targetId: appId, appId, result: "success", requestId }, now),
  ]);
  return secret;
}

export async function revokeServiceSecret(db: D1Database, appId: string, by: string, requestId: string, now: Date): Promise<boolean> {
  const r = await db.prepare("DELETE FROM app_service_credentials WHERE app_id = ?").bind(appId).run();
  if (!(r.meta?.changes ?? 0)) return false;
  await auditStatement(db, { actorType: "staff", actorId: by, action: "app.service_secret.revoke", targetType: "app", targetId: appId, appId, result: "success", requestId }, now).run();
  return true;
}

export async function hasServiceCredential(db: D1Database, appId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS x FROM app_service_credentials WHERE app_id = ?").bind(appId).first());
}

/** Client credentials: a short service token (typ svc+jwt, never accepted as a member access token). Any doubt = null. */
export async function issueServiceToken(env: Env, deps: Deps, issuer: string, appId: string, secret: string, requestId: string): Promise<{ token: string; expires_in: number } | null> {
  const now = deps.now();
  const app = await getApp(env.DB, appId, now);
  const row = await env.DB.prepare("SELECT secret_hash FROM app_service_credentials WHERE app_id = ?").bind(appId).first<{ secret_hash: string }>();
  const ok = !!app && app.status === "active" && !!row && timingSafeEqual(row.secret_hash, await hashSecret(secret));
  await auditStatement(env.DB, { actorType: "app", actorId: appId, action: "service.token", result: ok ? "success" : "denied", appId, requestId }, now).run();
  if (!ok) return null;
  await env.DB.prepare("UPDATE app_service_credentials SET last_used_at = ? WHERE app_id = ?").bind(taipeiIso(now), appId).run();
  const iat = epochSeconds(now);
  const { current } = await getSigningKeys(env);
  const token = await signJwt({ iss: issuer, sub: `app:${appId}`, aud: issuer, app_id: appId, scope: SERVICE_SCOPE, iat, exp: iat + SERVICE_TOKEN_LIFETIME }, current, "svc+jwt");
  return { token, expires_in: SERVICE_TOKEN_LIFETIME };
}

/** The App a service token belongs to, or null (wrong type, expired, App no longer active). */
export async function checkServiceToken(env: Env, deps: Deps, issuer: string, authorization: string | undefined): Promise<string | null> {
  const m = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization ?? "");
  if (!m) return null;
  const now = deps.now();
  try {
    const { publicKeys } = await getSigningKeys(env);
    const claims = (await verifyJwt(m[1] as string, publicKeys, { issuer, audience: issuer, now: epochSeconds(now), typ: "svc+jwt", clockSkew: 30 })) as Record<string, unknown>;
    if (typeof claims.app_id !== "string" || claims.scope !== SERVICE_SCOPE) return null;
    return (await getApp(env.DB, claims.app_id, now))?.status === "active" ? claims.app_id : null;
  } catch (e) {
    if (e instanceof JwtError) return null;
    throw e;
  }
}

export interface Contact {
  member_id: string;
  email: string;
  email_verified: boolean;
}

/**
 * Contact e-mail for members who signed in to this App: the contact e-mail the member set (not verified), otherwise
 * the verified Google e-mail. Deleted, unknown or never-seen-here members come back as `not_found`. One audit entry
 * records who, which App, how many and why; never the addresses.
 */
export async function lookupContacts(db: D1Database, appId: string, purpose: string, ids: string[], requestId: string, now: Date): Promise<{ contacts: Contact[]; not_found: string[] }> {
  const unique = [...new Set(ids)];
  const marks = unique.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT m.id AS id, m.google_email AS g, m.google_email_verified AS gv,
              (SELECT value FROM profile_field_values p WHERE p.member_id = m.id AND p.field_key = 'contact_email') AS ce
       FROM members m JOIN member_apps ma ON ma.member_id = m.id AND ma.app_id = ?
       WHERE m.status = 'active' AND m.id IN (${marks})`,
    )
    .bind(appId, ...unique)
    .all<{ id: string; g: string | null; gv: number; ce: string | null }>();
  const contacts: Contact[] = [];
  for (const r of rows.results ?? []) {
    let own: string | null = null;
    try {
      const v = r.ce ? (JSON.parse(r.ce) as unknown) : null;
      own = typeof v === "string" && v.trim() ? v.trim() : null;
    } catch {
      own = null;
    }
    if (own) contacts.push({ member_id: r.id, email: own, email_verified: false });
    else if (r.g) contacts.push({ member_id: r.id, email: r.g, email_verified: r.gv === 1 });
  }
  const found = new Set(contacts.map((c) => c.member_id));
  await auditStatement(db, { actorType: "app", actorId: appId, action: "contacts.lookup", result: "success", appId, requestId, detail: { count: unique.length, returned: contacts.length, purpose } }, now).run();
  return { contacts, not_found: unique.filter((i) => !found.has(i)) };
}
