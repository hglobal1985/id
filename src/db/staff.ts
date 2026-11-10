import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import type { Role } from "../admin/roles";

export async function rolesOf(db: D1Database, memberId: string): Promise<Role[]> {
  const r = await db.prepare("SELECT role FROM staff_roles WHERE member_id = ? ORDER BY role").bind(memberId).all<{ role: Role }>();
  return (r.results ?? []).map((x) => x.role);
}

export async function listStaff(db: D1Database): Promise<{ member_id: string; roles: Role[] }[]> {
  const r = await db.prepare("SELECT member_id, role FROM staff_roles ORDER BY member_id, role").all<{ member_id: string; role: Role }>();
  const map = new Map<string, Role[]>();
  for (const x of r.results ?? []) map.set(x.member_id, [...(map.get(x.member_id) ?? []), x.role]);
  return [...map].map(([member_id, roles]) => ({ member_id, roles }));
}

/** Replaces a member's roles. Returns false if this would leave no super admin. */
export async function setRoles(db: D1Database, memberId: string, roles: Role[], by: string, requestId: string, now: Date): Promise<boolean> {
  const before = await rolesOf(db, memberId);
  if (before.includes("super_admin") && !roles.includes("super_admin")) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM staff_roles WHERE role = 'super_admin'").first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) return false;
  }
  const ts = taipeiIso(now);
  await db.batch([
    db.prepare("DELETE FROM staff_roles WHERE member_id = ?").bind(memberId),
    ...roles.map((r) => db.prepare("INSERT INTO staff_roles (member_id, role, granted_at, granted_by) VALUES (?, ?, ?, ?)").bind(memberId, r, ts, by)),
    auditStatement(db, { actorType: "staff", actorId: by, action: "staff.roles.set", targetType: "member", targetId: memberId, result: "success", requestId, detail: { before: before.join(","), after: roles.join(",") } }, now),
  ]);
  return true;
}

/** Notifies every reviewer-capable staff member that a review request is waiting. */
export function notifyReviewersStatement(db: D1Database, requestId: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO notifications (id, member_id, kind, payload, created_at)
       SELECT lower(hex(randomblob(16))), member_id, 'staff.review.requested', ?, ? FROM (SELECT DISTINCT member_id FROM staff_roles)`,
    )
    .bind(JSON.stringify({ request_id: requestId }), taipeiIso(now));
}
