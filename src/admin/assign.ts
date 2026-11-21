// Which positions an App may hand out (ADR 0033), framework-free. The owner decided (2026-11-21) that Apps only assign the
// general positions; 超級管理員 and 總部秘書 stay in the back office, so nobody can climb to the top from inside an App.
import { ROLE_GRANTS, grantsOf, hasGrant, type Grant, type Role } from "./roles";

export const APP_ASSIGNABLE_ROLES = ["reviewer", "president", "course", "sound", "ticket", "activity"] as const satisfies readonly Role[];
export type AppAssignableRole = (typeof APP_ASSIGNABLE_ROLES)[number];
export const isAppAssignable = (r: string): r is AppAssignableRole => (APP_ASSIGNABLE_ROLES as readonly string[]).includes(r);

export type Plan =
  | { ok: true; roles: Role[]; added: Role[]; removed: Role[]; changed: boolean }
  | { ok: false; reason: "cannot_grant"; role: Role };

/**
 * The positions a member ends up with: the ones an App may not touch stay exactly as they are, the assignable ones become
 * `wanted`. The caller can only hand out positions whose permissions the caller holds (nobody gives more than they have).
 */
export function planAssignment(current: readonly Role[], wanted: readonly AppAssignableRole[], callerGrants: readonly Grant[]): Plan {
  const kept = current.filter((r) => !isAppAssignable(r));
  const want = [...new Set(wanted)];
  const had = new Set(current);
  const added = want.filter((r) => !had.has(r));
  for (const r of added) {
    for (const g of ROLE_GRANTS[r]) if (!hasGrant(callerGrants, g.permission, g.scope)) return { ok: false, reason: "cannot_grant", role: r };
  }
  const roles = [...kept, ...want];
  const removed = current.filter((r) => isAppAssignable(r) && !want.includes(r));
  return { ok: true, roles, added, removed, changed: added.length > 0 || removed.length > 0 };
}

export { grantsOf };
