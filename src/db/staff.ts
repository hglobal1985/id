import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import type { Role } from "../admin/roles";
import { normTerm } from "../vocab/terms";

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

/** The regional center (normalized) a staff member works for: the one saved in the member's own Amway area. */
export async function centerNormOfMember(db: D1Database, memberId: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM amway_field_values WHERE member_id = ? AND field_key = 'education_center'").bind(memberId).first<{ value: string | null }>();
  if (!r?.value) return null;
  try {
    const v = JSON.parse(r.value) as unknown;
    return typeof v === "string" && v.trim() ? normTerm(v) : null;
  } catch {
    return null;
  }
}

/**
 * Who is told about a review request: every reviewer (審核員) of the SAME center, however many there are. When no reviewer
 * works for that center the request goes to the head-office secretaries and super admins instead, so it never waits unseen.
 */
export async function reviewRecipients(db: D1Database, centerNorm: string | null): Promise<string[]> {
  const rows = await db.prepare("SELECT member_id, role FROM staff_roles WHERE role IN ('reviewer', 'secretary', 'super_admin')").all<{ member_id: string; role: string }>();
  const reviewers = [...new Set((rows.results ?? []).filter((r) => r.role === "reviewer").map((r) => r.member_id))];
  const same: string[] = [];
  if (centerNorm) for (const id of reviewers) if ((await centerNormOfMember(db, id)) === centerNorm) same.push(id);
  if (same.length) return same;
  return [...new Set((rows.results ?? []).filter((r) => r.role !== "reviewer").map((r) => r.member_id))];
}

/** One "waiting for review" notice per recipient (see reviewRecipients). */
export async function notifyReviewersStatements(db: D1Database, requestId: string, fieldKey: string, centerNorm: string | null, now: Date): Promise<D1PreparedStatement[]> {
  const ts = taipeiIso(now);
  const payload = JSON.stringify({ request_id: requestId, field_key: fieldKey });
  return (await reviewRecipients(db, centerNorm)).map((id) =>
    db.prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES (lower(hex(randomblob(16))), ?, 'staff.review.requested', ?, ?)").bind(id, payload, ts),
  );
}
