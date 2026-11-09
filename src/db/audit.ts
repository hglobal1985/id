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
