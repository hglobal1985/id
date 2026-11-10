// Daily housekeeping (cron). Removes expired short-lived records, and Amway data kept for 1 year after a
// member turned the Amway area off (privacy notice v2, section 4: kept until 1 year after unticking).
import { uuidv7 } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";
import { auditStatement } from "../db/audit";
import { CONSENT_DOCUMENT, CONSENT_VERSION } from "../amway/consent";

export const RETENTION_DAYS = 365;

export async function runCleanup(db: D1Database, now: Date): Promise<{ purgedMembers: number }> {
  const day = 86400;
  const t = epochSeconds(now);
  await db.batch([
    db.prepare("DELETE FROM login_flows WHERE expires_epoch < ?").bind(t - day),
    db.prepare("DELETE FROM oauth_authorization_codes WHERE expires_epoch < ?").bind(t - day),
    db.prepare("DELETE FROM spouse_candidates WHERE expires_epoch < ?").bind(t),
  ]);

  // Members whose Amway area has been off for over a year and who still have Amway data.
  const cutoff = taipeiIso(new Date(now.getTime() - RETENTION_DAYS * day * 1000));
  const r = await db
    .prepare(
      `SELECT m.id FROM members m
       WHERE m.amway_enabled = 0
         AND EXISTS (SELECT 1 FROM amway_field_values v WHERE v.member_id = m.id)
         AND (SELECT MAX(a.occurred_at) FROM audit_log a WHERE a.target_id = m.id AND a.action = 'amway.disable') < ?
         AND NOT EXISTS (SELECT 1 FROM audit_log a2 WHERE a2.target_id = m.id AND a2.action = 'amway.enable'
                          AND a2.occurred_at > (SELECT MAX(a3.occurred_at) FROM audit_log a3 WHERE a3.target_id = m.id AND a3.action = 'amway.disable'))
       LIMIT 200`,
    )
    .bind(cutoff)
    .all<{ id: string }>();
  const ids = (r.results ?? []).map((x) => x.id);
  const ts = taipeiIso(now);
  for (const id of ids) {
    await db.batch([
      db.prepare("DELETE FROM amway_field_values WHERE member_id = ?").bind(id),
      db.prepare("DELETE FROM amway_review_requests WHERE member_id = ?").bind(id),
      db
        .prepare("INSERT INTO consent_records (id, member_id, document, version, action, occurred_at) VALUES (?, ?, ?, ?, 'withdraw', ?)")
        .bind(uuidv7(now.getTime()), id, CONSENT_DOCUMENT, CONSENT_VERSION, ts),
      auditStatement(db, { actorType: "system", action: "amway.retention.purge", targetType: "member", targetId: id, result: "success", detail: { retention_days: RETENTION_DAYS } }, now),
    ]);
  }
  return { purgedMembers: ids.length };
}
