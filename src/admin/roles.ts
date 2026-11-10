// Staff roles and permissions (framework-free). Staff are members who sign in with Google like everyone else.

export const ROLES = ["super_admin", "secretary", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "超級管理員",
  secretary: "秘書",
  reviewer: "審核員",
};

export type Permission =
  | "review" // approve / reject review requests, view the queue
  | "adjust" // adjust the six reviewed fields for a member (treated as approved)
  | "members.read" // look up members
  | "options.manage" // maintain Amway option lists (ranks, systems, centers, uplines)
  | "uplines.merge" // merge page: fold custom upline names into options, adjust the three upline fields
  | "audit.read"
  | "staff.manage" // grant / revoke roles (needs recent sign-in)
  | "deletion.execute"; // carry out members' data deletion requests

const MATRIX: Record<Role, Permission[]> = {
  super_admin: ["review", "adjust", "members.read", "options.manage", "uplines.merge", "audit.read", "staff.manage", "deletion.execute"],
  secretary: ["review", "adjust", "members.read", "options.manage", "uplines.merge", "audit.read", "deletion.execute"],
  reviewer: ["review", "adjust", "members.read"],
};

export function can(roles: Iterable<string>, p: Permission): boolean {
  for (const r of roles) if ((MATRIX as Record<string, Permission[]>)[r]?.includes(p)) return true;
  return false;
}

export function permissionsOf(roles: Iterable<string>): Permission[] {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of (MATRIX as Record<string, Permission[]>)[r] ?? []) out.add(p);
  return [...out];
}

/** Sensitive operations need a Google sign-in within this many seconds. */
export const REAUTH_MAX_AGE = 10 * 60;

export const UPLINE_FIELDS = ["upline_crown_ambassador", "upline_diamond", "upline_platinum"] as const;
