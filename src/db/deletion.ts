// Data deletion. The member asks (after a fresh sign-in); an administrator carries it out within 15 days.
// Account deletion anonymizes and closes the account (no physical row deletion, which needs owner approval);
// the audit log is kept. Amway deletion removes the Amway area data only.
import { uuidv7 } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { getActiveBinding, unbindSpouse } from "./spouse";
import { CONSENT_DOCUMENT, CONSENT_VERSION } from "../amway/consent";

export const PROCESSING_DAYS = 15;
export type DeletionScope = "amway" | "account";

export interface DeletionRow {
  id: string;
  member_id: string;
  scope: DeletionScope;
  status: "requested" | "completed" | "cancelled";
  requested_at: string;
  due_at: string;
  completed_at: string | null;
}

export async function listMemberRequests(db: D1Database, memberId: string): Promise<DeletionRow[]> {
  const r = await db.prepare("SELECT * FROM deletion_requests WHERE member_id = ? ORDER BY requested_at DESC").bind(memberId).all<DeletionRow>();
  return r.results ?? [];
}

export async function requestDeletion(db: D1Database, memberId: string, scope: DeletionScope, now: Date, requestId: string): Promise<DeletionRow> {
  const open = await db.prepare("SELECT * FROM deletion_requests WHERE member_id = ? AND scope = ? AND status = 'requested'").bind(memberId, scope).first<DeletionRow>();
  if (open) return open;
  const row: DeletionRow = {
    id: uuidv7(now.getTime()),
    member_id: memberId,
    scope,
    status: "requested",
    requested_at: taipeiIso(now),
    due_at: taipeiIso(new Date(now.getTime() + PROCESSING_DAYS * 86400 * 1000)),
    completed_at: null,
  };
  await db.batch([
    db.prepare("INSERT INTO deletion_requests (id, member_id, scope, status, requested_at, due_at) VALUES (?, ?, ?, 'requested', ?, ?)").bind(row.id, memberId, scope, row.requested_at, row.due_at),
    auditStatement(db, { actorType: "member", actorId: memberId, action: "deletion.request", targetType: "member", targetId: memberId, result: "success", requestId, detail: { scope, request_id: row.id } }, now),
  ]);
  return row;
}

export async function cancelDeletion(db: D1Database, memberId: string, id: string, now: Date, requestId: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE deletion_requests SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND member_id = ? AND status = 'requested'")
    .bind(taipeiIso(now), id, memberId)
    .run();
  if (!res.meta.changes) return false;
  await auditStatement(db, { actorType: "member", actorId: memberId, action: "deletion.cancel", targetType: "member", targetId: memberId, result: "success", requestId, detail: { request_id: id } }, now).run();
  return true;
}

export async function openRequests(db: D1Database): Promise<DeletionRow[]> {
  const r = await db.prepare("SELECT * FROM deletion_requests WHERE status = 'requested' ORDER BY due_at").all<DeletionRow>();
  return r.results ?? [];
}

function amwayDeletionStatements(db: D1Database, memberId: string, now: Date): D1PreparedStatement[] {
  const ts = taipeiIso(now);
  return [
    db.prepare("DELETE FROM amway_field_values WHERE member_id = ?").bind(memberId),
    db.prepare("DELETE FROM amway_review_requests WHERE member_id = ?").bind(memberId),
    db.prepare("UPDATE members SET amway_enabled = 0, updated_at = ? WHERE id = ?").bind(ts, memberId),
    db
      .prepare("INSERT INTO consent_records (id, member_id, document, version, action, occurred_at) VALUES (?, ?, ?, ?, 'withdraw', ?)")
      .bind(uuidv7(now.getTime()), memberId, CONSENT_DOCUMENT, CONSENT_VERSION, ts),
  ];
}

/** Carries out a request. Returns false if it is not open. */
export async function completeDeletion(db: D1Database, id: string, staffId: string, now: Date, requestId: string): Promise<boolean> {
  const req = await db.prepare("SELECT * FROM deletion_requests WHERE id = ? AND status = 'requested'").bind(id).first<DeletionRow>();
  if (!req) return false;
  const m = req.member_id;
  const ts = taipeiIso(now);
  const stmts: D1PreparedStatement[] = [...amwayDeletionStatements(db, m, now)];
  if (req.scope === "account") {
    const binding = await getActiveBinding(db, m);
    if (binding) await unbindSpouse(db, { memberId: m, binding, fallbackCountry: "TW", appId: null, requestId, now });
    const t = epochSeconds(now);
    stmts.push(
      db.prepare("DELETE FROM profile_field_values WHERE member_id = ?").bind(m),
      db.prepare("DELETE FROM profile_visibility WHERE member_id = ?").bind(m),
      db.prepare("DELETE FROM member_numbers WHERE member_id = ?").bind(m),
      db.prepare("DELETE FROM notifications WHERE member_id = ?").bind(m),
      db.prepare("DELETE FROM spouse_candidates WHERE member_id = ? OR candidate_member_id = ?").bind(m, m),
      db.prepare("DELETE FROM staff_roles WHERE member_id = ?").bind(m),
      db.prepare("DELETE FROM member_apps WHERE member_id = ?").bind(m),
      db.prepare("UPDATE login_sessions SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
      db.prepare("UPDATE oauth_refresh_tokens SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
      db.prepare("UPDATE app_sessions SET revoked_epoch = ?, revoke_reason = 'deleted' WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
      db.prepare("UPDATE device_sso SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
      db.prepare("DELETE FROM member_avatars WHERE member_id = ?").bind(m),
      // Anonymize. The Google link is released so the same Google account could start over as a new member.
      db
        .prepare(
          `UPDATE members SET status = 'deleted', google_sub = 'deleted:' || id, google_email = NULL, google_email_verified = 0,
             google_picture_url = NULL, display_name = NULL, avatar_url = NULL, avatar_source = 'none', updated_at = ? WHERE id = ?`,
        )
        .bind(ts, m),
    );
  }
  stmts.push(
    db.prepare("UPDATE deletion_requests SET status = 'completed', completed_at = ?, completed_by = ? WHERE id = ?").bind(ts, staffId, id),
    auditStatement(db, { actorType: "staff", actorId: staffId, action: "deletion.complete", targetType: "member", targetId: m, result: "success", requestId, detail: { scope: req.scope, request_id: id } }, now),
  );
  await db.batch(stmts);
  return true;
}
