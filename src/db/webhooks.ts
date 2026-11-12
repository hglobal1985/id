// Webhook outbox and delivery (ADR 0021). Events are written in the same step as the change they describe; delivery
// runs from the cron (every 5 minutes) and, best effort, right after the request. Delivery is at-least-once.
import type { Env } from "../env";
import { uuidv7 } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { DELIVERY_TIMEOUT_MS, EVENT_RETENTION_SECONDS, MAX_ATTEMPTS, WEBHOOK_URL, bodyOf, deriveSecret, nextDelaySeconds, signature, type WebhookEventType } from "../webhooks/events";

/** https only, a real domain name (no IP address, no localhost). */
export function isWebhookUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 300 || !WEBHOOK_URL.test(v)) return false;
  const host = new URL(v).hostname;
  return /\.[a-z]{2,}$/.test(host) && host !== "localhost";
}

export interface WebhookRow {
  app_id: string;
  url: string;
  secret_version: number;
  enabled: number;
  updated_at: string;
}

export async function getWebhook(db: D1Database, appId: string): Promise<WebhookRow | null> {
  return db.prepare("SELECT app_id, url, secret_version, enabled, updated_at FROM app_webhooks WHERE app_id = ?").bind(appId).first<WebhookRow>();
}

/** Super admin: set the endpoint. Setting (or changing) it keeps the secret version; rotate separately. */
export async function setWebhook(db: D1Database, appId: string, url: string | null, enabled: boolean, by: string, requestId: string, now: Date): Promise<void> {
  const ts = taipeiIso(now);
  const stmts: D1PreparedStatement[] = [];
  if (url === null) stmts.push(db.prepare("DELETE FROM app_webhooks WHERE app_id = ?").bind(appId));
  else
    stmts.push(
      db
        .prepare(
          `INSERT INTO app_webhooks (app_id, url, secret_version, enabled, created_at, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT (app_id) DO UPDATE SET url = excluded.url, enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(appId, url, enabled ? 1 : 0, ts, ts, by),
    );
  stmts.push(auditStatement(db, { actorType: "staff", actorId: by, action: "app.webhook.set", targetType: "app", targetId: appId, appId, result: "success", requestId, detail: { enabled, removed: url === null } }, now));
  await db.batch(stmts);
}

/** New signing secret: bumps the version. Returns the secret (shown once) or null when the App has no endpoint. */
export async function rotateWebhookSecret(db: D1Database, env: Env, appId: string, by: string, requestId: string, now: Date): Promise<string | null> {
  if (!env.WEBHOOK_SIGNING_KEY) return null;
  const row = await getWebhook(db, appId);
  if (!row) return null;
  const version = row.secret_version + 1;
  await db.batch([
    db.prepare("UPDATE app_webhooks SET secret_version = ?, updated_at = ?, updated_by = ? WHERE app_id = ?").bind(version, taipeiIso(now), by, appId),
    auditStatement(db, { actorType: "staff", actorId: by, action: "app.webhook.rotate", targetType: "app", targetId: appId, appId, result: "success", requestId, detail: { version } }, now),
  ]);
  return deriveSecret(env.WEBHOOK_SIGNING_KEY, appId, version);
}

/** The secret of the CURRENT version, for the first setup (the owner reads it once and puts it in the App's environment). */
export async function currentWebhookSecret(db: D1Database, env: Env, appId: string): Promise<string | null> {
  if (!env.WEBHOOK_SIGNING_KEY) return null;
  const row = await getWebhook(db, appId);
  return row ? deriveSecret(env.WEBHOOK_SIGNING_KEY, appId, row.secret_version) : null;
}

/**
 * Statements that queue one event for every App the member has signed in to that has an active endpoint.
 * member.profile_changed events of the same member and App that are still waiting (never attempted, under a minute old)
 * are merged into one (the field names are combined).
 */
export async function enqueueStatements(db: D1Database, memberId: string, type: WebhookEventType, fields: string[] | null, now: Date): Promise<D1PreparedStatement[]> {
  const apps = await db
    .prepare("SELECT ma.app_id AS app_id FROM member_apps ma JOIN app_webhooks w ON w.app_id = ma.app_id AND w.enabled = 1 WHERE ma.member_id = ?")
    .bind(memberId)
    .all<{ app_id: string }>();
  const t = epochSeconds(now);
  const ts = taipeiIso(now);
  const out: D1PreparedStatement[] = [];
  let n = 0;
  for (const { app_id } of apps.results ?? []) {
    if (type === "member.profile_changed") {
      const open = await db
        .prepare("SELECT id, fields FROM webhook_events WHERE app_id = ? AND member_id = ? AND type = ? AND status = 'pending' AND attempts = 0 AND next_attempt_epoch >= ? ORDER BY created_at DESC LIMIT 1")
        .bind(app_id, memberId, type, t - 60)
        .first<{ id: string; fields: string | null }>();
      if (open) {
        const merged = [...new Set([...(open.fields ? (JSON.parse(open.fields) as string[]) : []), ...(fields ?? [])])].sort();
        out.push(db.prepare("UPDATE webhook_events SET fields = ? WHERE id = ?").bind(JSON.stringify(merged), open.id));
        continue;
      }
    }
    out.push(
      db
        .prepare(
          "INSERT INTO webhook_events (id, app_id, member_id, type, fields, created_at, status, attempts, next_attempt_epoch, purge_epoch) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
        )
        .bind(`evt_${uuidv7(now.getTime() + n++)}`, app_id, memberId, type, fields ? JSON.stringify([...new Set(fields)].sort()) : null, ts, t, t + EVENT_RETENTION_SECONDS),
    );
  }
  return out;
}

export async function enqueueEvent(db: D1Database, memberId: string, type: WebhookEventType, fields: string[] | null, now: Date): Promise<void> {
  const stmts = await enqueueStatements(db, memberId, type, fields, now);
  if (stmts.length) await db.batch(stmts);
}

interface DueRow {
  id: string;
  app_id: string;
  member_id: string;
  type: string;
  fields: string | null;
  created_at: string;
  attempts: number;
  url: string | null;
  secret_version: number | null;
  enabled: number | null;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Sends every due event once. Without WEBHOOK_SIGNING_KEY nothing is sent (the events wait). Returns how many were delivered. */
export async function deliverDue(db: D1Database, env: Env, now: Date, send: Fetcher = (u, i) => fetch(u, i), limit = 25): Promise<{ delivered: number; retried: number; failed: number; paused: boolean }> {
  const out = { delivered: 0, retried: 0, failed: 0, paused: false };
  if (!env.WEBHOOK_SIGNING_KEY) return { ...out, paused: true };
  const t = epochSeconds(now);
  const due = await db
    .prepare(
      `SELECT e.id, e.app_id, e.member_id, e.type, e.fields, e.created_at, e.attempts, w.url, w.secret_version, w.enabled
       FROM webhook_events e LEFT JOIN app_webhooks w ON w.app_id = e.app_id
       WHERE e.status = 'pending' AND e.next_attempt_epoch <= ? ORDER BY e.next_attempt_epoch LIMIT ?`,
    )
    .bind(t, limit)
    .all<DueRow>();
  for (const e of due.results ?? []) {
    const ts = taipeiIso(now);
    if (!e.url || e.enabled !== 1 || e.secret_version === null) {
      await db.prepare("UPDATE webhook_events SET status = 'failed', last_attempt_at = ?, last_error = 'no_endpoint' WHERE id = ?").bind(ts, e.id).run();
      out.failed++;
      continue;
    }
    const raw = bodyOf(e);
    const secret = await deriveSecret(env.WEBHOOK_SIGNING_KEY, e.app_id, e.secret_version);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await send(e.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "user-agent": "HGlobal-ID-Webhook/1",
          "x-hg-event-id": e.id,
          "x-hg-timestamp": String(t),
          "x-hg-attempt": String(e.attempts + 1),
          "x-hg-signature": await signature(secret, t, raw),
        },
        body: raw,
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `http_${res.status}`;
    } catch (err) {
      error = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network";
    }
    const attempts = e.attempts + 1;
    if (!error) {
      await db.prepare("UPDATE webhook_events SET status = 'delivered', attempts = ?, last_attempt_at = ?, last_http_status = ?, last_error = NULL, delivered_at = ? WHERE id = ?").bind(attempts, ts, status, ts, e.id).run();
      out.delivered++;
      continue;
    }
    const delay = nextDelaySeconds(attempts);
    if (delay === null || attempts >= MAX_ATTEMPTS) {
      await db.prepare("UPDATE webhook_events SET status = 'failed', attempts = ?, last_attempt_at = ?, last_http_status = ?, last_error = ? WHERE id = ?").bind(attempts, ts, status, error, e.id).run();
      out.failed++;
    } else {
      await db.prepare("UPDATE webhook_events SET attempts = ?, next_attempt_epoch = ?, last_attempt_at = ?, last_http_status = ?, last_error = ? WHERE id = ?").bind(attempts, t + delay, ts, status, error, e.id).run();
      out.retried++;
    }
  }
  return out;
}

export async function purgeOldEvents(db: D1Database, now: Date): Promise<number> {
  const r = await db.prepare("DELETE FROM webhook_events WHERE purge_epoch <= ? AND status != 'pending'").bind(epochSeconds(now)).run();
  return r.meta?.changes ?? 0;
}

export interface EventLogRow {
  id: string;
  type: string;
  created_at: string;
  status: string;
  attempts: number;
  last_http_status: number | null;
  last_error: string | null;
  delivered_at: string | null;
}

/** The delivery log of one App (no member ids, no field names). */
export async function recentEvents(db: D1Database, appId: string, limit = 30): Promise<{ events: EventLogRow[]; pending: number; failed: number }> {
  const [rows, counts] = await Promise.all([
    db.prepare("SELECT id, type, created_at, status, attempts, last_http_status, last_error, delivered_at FROM webhook_events WHERE app_id = ? ORDER BY created_at DESC LIMIT ?").bind(appId, limit).all<EventLogRow>(),
    db.prepare("SELECT status, COUNT(*) AS n FROM webhook_events WHERE app_id = ? GROUP BY status").bind(appId).all<{ status: string; n: number }>(),
  ]);
  const n = new Map((counts.results ?? []).map((r) => [r.status, r.n]));
  return { events: rows.results ?? [], pending: n.get("pending") ?? 0, failed: n.get("failed") ?? 0 };
}
