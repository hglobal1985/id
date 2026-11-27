import { uuidv7 } from "../lib/crypto";
import { taipeiIso } from "../lib/time";

export interface AuditEntry {
  actorType: "member" | "staff" | "system" | "app";
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  result: "success" | "denied" | "error";
  appId?: string | null;
  requestId?: string | null;
  /** Small, non-sensitive context only. Never tokens, secrets, names, emails or Amway values. */
  detail?: Record<string, string | number | boolean> | null;
}

export function auditStatement(db: D1Database, e: AuditEntry, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (id, occurred_at, actor_type, actor_id, action, target_type, target_id, result, app_id, request_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uuidv7(now.getTime()),
      taipeiIso(now),
      e.actorType,
      e.actorId ?? null,
      e.action,
      e.targetType ?? null,
      e.targetId ?? null,
      e.result,
      e.appId ?? null,
      e.requestId ?? null,
      e.detail ? JSON.stringify(e.detail) : null,
    );
}

export async function writeAudit(db: D1Database, e: AuditEntry, now: Date): Promise<void> {
  await auditStatement(db, e, now).run();
}

/**
 * 單純「查看清單」的稽核瘦身（杜杜龍 2026-11-27）：同一人、同一款 App、同一個動作，一小時內已經記過就不再記。
 * App 每開一次畫面就查一次清單，以前一天記上千筆，把真正重要的操作（改資料、停權）淹沒了。
 */
export async function auditedRecently(db: D1Database, actorId: string, action: string, appId: string | null, now: Date, seconds = 3600): Promise<boolean> {
  const since = taipeiIso(new Date(now.getTime() - seconds * 1000));
  const row = await db
    .prepare("SELECT 1 AS x FROM audit_log WHERE actor_id = ? AND action = ? AND (app_id = ? OR (app_id IS NULL AND ? IS NULL)) AND occurred_at > ? LIMIT 1")
    .bind(actorId, action, appId, appId, since)
    .first<{ x: number }>();
  return !!row;
}
