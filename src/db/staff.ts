import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import type { Grant, Role } from "../admin/roles";
import { normTerm } from "../vocab/terms";
import { isNone } from "../amway/fields";

export async function rolesOf(db: D1Database, memberId: string): Promise<Role[]> {
  const r = await db.prepare("SELECT role FROM staff_roles WHERE member_id = ? ORDER BY role").bind(memberId).all<{ role: Role }>();
  return (r.results ?? []).map((x) => x.role);
}

/** The extra permissions given to one person on top of the position's defaults. */
export async function grantsOfMember(db: D1Database, memberId: string): Promise<Grant[]> {
  const r = await db.prepare("SELECT permission, scope FROM staff_grants WHERE member_id = ? ORDER BY permission, scope").bind(memberId).all<Grant>();
  return r.results ?? [];
}

/** Anyone with a position or an extra permission is staff. */
export async function isStaffMember(db: D1Database, memberId: string): Promise<boolean> {
  const r = await db.prepare("SELECT (SELECT COUNT(*) FROM staff_roles WHERE member_id = ?) + (SELECT COUNT(*) FROM staff_grants WHERE member_id = ?) AS n").bind(memberId, memberId).first<{ n: number }>();
  return (r?.n ?? 0) > 0;
}

export async function listStaff(db: D1Database): Promise<{ member_id: string; roles: Role[]; grants: Grant[] }[]> {
  const r = await db.prepare("SELECT member_id, role FROM staff_roles ORDER BY member_id, role").all<{ member_id: string; role: Role }>();
  const g = await db.prepare("SELECT member_id, permission, scope FROM staff_grants ORDER BY member_id, permission, scope").all<{ member_id: string; permission: Grant["permission"]; scope: Grant["scope"] }>();
  const map = new Map<string, { roles: Role[]; grants: Grant[] }>();
  const slot = (id: string) => map.get(id) ?? map.set(id, { roles: [], grants: [] }).get(id)!;
  for (const x of r.results ?? []) slot(x.member_id).roles.push(x.role);
  for (const x of g.results ?? []) slot(x.member_id).grants.push({ permission: x.permission, scope: x.scope });
  return [...map].map(([member_id, v]) => ({ member_id, ...v }));
}

/** Replaces a member's positions and extra permissions. Returns false if this would leave no super admin. */
export async function setRoles(db: D1Database, memberId: string, roles: Role[], grants: Grant[], by: string, requestId: string, now: Date): Promise<boolean> {
  const before = await rolesOf(db, memberId);
  const beforeGrants = await grantsOfMember(db, memberId);
  if (before.includes("super_admin") && !roles.includes("super_admin")) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM staff_roles WHERE role = 'super_admin'").first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) return false;
  }
  const ts = taipeiIso(now);
  const key = (gs: Grant[]) => gs.map((x) => `${x.permission}:${x.scope}`).join(",");
  await db.batch([
    db.prepare("DELETE FROM staff_roles WHERE member_id = ?").bind(memberId),
    db.prepare("DELETE FROM staff_grants WHERE member_id = ?").bind(memberId),
    ...roles.map((r) => db.prepare("INSERT INTO staff_roles (member_id, role, granted_at, granted_by) VALUES (?, ?, ?, ?)").bind(memberId, r, ts, by)),
    ...grants.map((x) => db.prepare("INSERT INTO staff_grants (member_id, permission, scope, granted_at, granted_by) VALUES (?, ?, ?, ?, ?)").bind(memberId, x.permission, x.scope, ts, by)),
    auditStatement(db, { actorType: "staff", actorId: by, action: "staff.roles.set", targetType: "member", targetId: memberId, result: "success", requestId, detail: { before: before.join(","), after: roles.join(","), grants_before: key(beforeGrants), grants_after: key(grants) } }, now),
  ]);
  return true;
}

/** The regional center (normalized) a staff member works for: the one saved in the member's own Amway area. */
export async function centerNormOfMember(db: D1Database, memberId: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM amway_field_values WHERE member_id = ? AND field_key = 'education_center'").bind(memberId).first<{ value: string | null }>();
  if (!r?.value) return null;
  try {
    const v = JSON.parse(r.value) as unknown;
    return typeof v === "string" && v.trim() && !isNone(v) ? normTerm(v) : null;
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
