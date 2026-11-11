// Account deletion takes effect at once (owner decision 2026-11-11): the member confirms after a fresh sign-in and
// the account is anonymized and closed on the spot. No physical row deletion (needs owner approval) and the audit log
// is kept. There is no request queue and no separate "delete my Amway data" step any more.
import { epochSeconds, taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { getActiveBinding, unbindSpouse } from "./spouse";

export type DeleteResult = "deleted" | "not_found" | "last_super_admin";

export async function deleteAccount(db: D1Database, memberId: string, now: Date, requestId: string): Promise<DeleteResult> {
  const member = await db.prepare("SELECT status FROM members WHERE id = ?").bind(memberId).first<{ status: string }>();
  if (!member || member.status === "deleted") return "not_found";
  // The system must keep one super administrator.
  const isSuper = await db.prepare("SELECT 1 AS x FROM staff_roles WHERE member_id = ? AND role = 'super_admin'").bind(memberId).first<{ x: number }>();
  if (isSuper) {
    const others = await db.prepare("SELECT COUNT(*) AS n FROM staff_roles WHERE role = 'super_admin' AND member_id != ?").bind(memberId).first<{ n: number }>();
    if (!others?.n) return "last_super_admin";
  }
  const binding = await getActiveBinding(db, memberId);
  if (binding) await unbindSpouse(db, { memberId, binding, fallbackCountry: "TW", appId: null, requestId, now });
  const m = memberId;
  const t = epochSeconds(now);
  const ts = taipeiIso(now);
  await db.batch([
    db.prepare("DELETE FROM amway_field_values WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM amway_review_requests WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM profile_field_values WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM profile_visibility WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM member_numbers WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM notifications WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM spouse_candidates WHERE member_id = ? OR candidate_member_id = ?").bind(m, m),
    db.prepare("DELETE FROM staff_roles WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM staff_grants WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM member_apps WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM member_avatars WHERE member_id = ?").bind(m),
    db.prepare("DELETE FROM social_links WHERE member_id = ?").bind(m),
    db.prepare("UPDATE login_sessions SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
    db.prepare("UPDATE oauth_refresh_tokens SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
    db.prepare("UPDATE app_sessions SET revoked_epoch = ?, revoke_reason = 'deleted' WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
    db.prepare("UPDATE device_sso SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, m),
    // Anonymize. The Google link is released so the same Google account could start over as a new member.
    db
      .prepare(
        `UPDATE members SET status = 'deleted', amway_enabled = 0, google_sub = 'deleted:' || id, google_email = NULL, google_email_verified = 0,
           google_picture_url = NULL, display_name = NULL, avatar_url = NULL, avatar_source = 'none', updated_at = ? WHERE id = ?`,
      )
      .bind(ts, m),
    auditStatement(db, { actorType: "member", actorId: m, action: "account.delete", targetType: "member", targetId: m, result: "success", requestId }, now),
  ]);
  return "deleted";
}
