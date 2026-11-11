// Staff roles and permissions (framework-free). Staff are members who sign in with Google like everyone else.

export const ROLES = ["super_admin", "secretary", "reviewer", "president", "course", "sound", "ticket", "activity"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "超級管理員",
  secretary: "總部秘書",
  reviewer: "審核員",
  president: "會長",
  course: "課務",
  sound: "音控",
  ticket: "票務",
  activity: "活動",
};

export type Permission =
  | "review" // approve / reject review requests, view the queue
  | "adjust" // change a member's 系統 / 中心 / 獎銜 (treated as approved)
  | "members.manage" // suspend / reinstate and delete members
  | "members.read" // look up members (read only)
  | "social.manage" // social platforms: names, order, icons
  | "layout.manage" // order of the profile fields on every member page
  | "vocab.manage" // suggestion vocabularies (關聯詞): edit, merge, delete
  | "audit.read"
  | "staff.manage" // give positions and permissions
  | "apps.operate" // App list, statistics, integration instructions, pause / kill switch
  | "apps.manage"; // register a new App, edit a registration

/** How far a permission reaches: the member's own regional center, the 寰宇 members (會長), or everyone. Unscoped permissions use "all". */
export type Scope = "center" | "hglobal" | "all";
export const SCOPE_LABELS: Record<Scope, string> = { center: "自己中心", hglobal: "系統＝寰宇", all: "全部" };

export interface Grant {
  permission: Permission;
  scope: Scope;
}

/** What each permission is called and which scopes it can be given with (the first scope listed is the narrowest). */
export const PERMISSION_INFO: Record<Permission, { label: string; scopes: Scope[] }> = {
  "members.read": { label: "查詢會員（只能查詢）", scopes: ["center", "hglobal", "all"] },
  review: { label: "審核中心／獎銜申請", scopes: ["center", "all"] },
  adjust: { label: "修改會員的系統、中心、獎銜", scopes: ["center", "all"] },
  "members.manage": { label: "停權、解除停權、刪除會員", scopes: ["all"] },
  "audit.read": { label: "查看稽核紀錄", scopes: ["all"] },
  "apps.operate": { label: "App 清單、統計、暫停與停用", scopes: ["all"] },
  "apps.manage": { label: "登記新 App、編輯 App 登記", scopes: ["all"] },
  "vocab.manage": { label: "管理關聯詞", scopes: ["all"] },
  "layout.manage": { label: "基本資料欄位順序與區塊", scopes: ["all"] },
  "social.manage": { label: "管理社群平台", scopes: ["all"] },
  "staff.manage": { label: "指派職務與權限", scopes: ["all"] },
};
export const PERMISSIONS = Object.keys(PERMISSION_INFO) as Permission[];

const g = (permission: Permission, scope: Scope = "all"): Grant => ({ permission, scope });

/** The default permissions of each position (職務). Extra permissions can be given to one person on top (staff_grants). */
export const ROLE_GRANTS: Record<Role, Grant[]> = {
  super_admin: PERMISSIONS.map((p) => g(p)),
  secretary: [g("review"), g("adjust"), g("members.manage"), g("members.read"), g("audit.read"), g("apps.operate")],
  reviewer: [g("review", "center"), g("members.read", "center")],
  // 會長 also reads the 寰宇 member list; 課務、音控、票務、活動 only have the basic lookup of their own center for now.
  president: [g("members.read", "hglobal"), g("members.read", "center")],
  course: [g("members.read", "center")],
  sound: [g("members.read", "center")],
  ticket: [g("members.read", "center")],
  activity: [g("members.read", "center")],
};

/** The permissions in force: the positions' defaults plus the extra ones given to this person. */
export function grantsOf(roles: Iterable<string>, extra: readonly Grant[] = []): Grant[] {
  const out: Grant[] = [];
  const seen = new Set<string>();
  const add = (x: Grant) => {
    const k = `${x.permission}:${x.scope}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  };
  for (const r of roles) for (const x of (ROLE_GRANTS as Record<string, Grant[]>)[r] ?? []) add(x);
  for (const x of extra) add(x);
  return out;
}

/** Does the person hold the permission at that scope (the "all" scope covers every narrower one)? Without a scope: at any scope. */
export function hasGrant(grants: readonly Grant[], p: Permission, scope?: Scope): boolean {
  return grants.some((x) => x.permission === p && (scope === undefined || x.scope === scope || x.scope === "all"));
}

/** Checks extra permissions sent by a client: known permission, a scope that permission allows, no duplicates. */
export function validateGrants(raw: unknown): { ok: true; grants: Grant[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "權限格式不正確" };
  const out: Grant[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const permission = (x as { permission?: unknown })?.permission as Permission;
    const scope = (x as { scope?: unknown })?.scope as Scope;
    const info = PERMISSION_INFO[permission];
    if (!info || !info.scopes.includes(scope)) return { ok: false, message: "沒有這個權限或範圍" };
    const k = `${permission}:${scope}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ permission, scope });
  }
  return { ok: true, grants: out };
}

/** 鑽石 and every rank above it (by the ladder order): a staff member holding one may look up all members, read only. */
export const DIAMOND_RANK_LABEL = "鑽石";

/** The permission table shown on the 權限 page (a dot chart): who may do what, from the same defaults the server enforces. */
export interface FeatureRow {
  label: string;
  /** Roles that have it by default. */
  roles: Role[];
  /** Also granted to any staff member whose own approved rank is 鑽石 or higher. */
  diamond?: boolean;
}
const rolesWithAny = (p: Permission): Role[] => ROLES.filter((r) => hasGrant(ROLE_GRANTS[r], p));
const rolesWithExact = (p: Permission, scope: Scope): Role[] => ROLES.filter((r) => ROLE_GRANTS[r].some((x) => x.permission === p && x.scope === scope));
export const FEATURES: FeatureRow[] = [
  { label: "查詢會員：自己中心的會員（只能查詢）", roles: rolesWithAny("members.read") },
  { label: "查詢會員：系統＝寰宇的會員名單（只能查詢）", roles: rolesWithExact("members.read", "hglobal") },
  { label: "查詢會員：全部會員，不分系統（只能查詢）", roles: rolesWithExact("members.read", "all"), diamond: true },
  { label: "審核中心／獎銜申請：自己中心的申請", roles: rolesWithExact("review", "center") },
  { label: "審核中心／獎銜申請：全部中心", roles: rolesWithExact("review", "all") },
  { label: "修改會員的系統、中心、獎銜", roles: rolesWithAny("adjust") },
  { label: "停權、解除停權會員", roles: rolesWithAny("members.manage") },
  { label: "刪除會員", roles: rolesWithAny("members.manage") },
  { label: "查看稽核紀錄", roles: rolesWithAny("audit.read") },
  { label: "App 清單、統計、暫停與停用", roles: rolesWithAny("apps.operate") },
  { label: "登記新 App、編輯 App 登記", roles: rolesWithAny("apps.manage") },
  { label: "管理關聯詞", roles: rolesWithAny("vocab.manage") },
  { label: "基本資料欄位順序與區塊", roles: rolesWithAny("layout.manage") },
  { label: "管理社群平台", roles: rolesWithAny("social.manage") },
  { label: "指派職務與權限（管理人員）", roles: rolesWithAny("staff.manage") },
];

export function can(roles: Iterable<string>, p: Permission, extra: readonly Grant[] = []): boolean {
  return hasGrant(grantsOf(roles, extra), p);
}

export function permissionsOf(roles: Iterable<string>, extra: readonly Grant[] = []): Permission[] {
  const out = new Set<Permission>();
  for (const x of grantsOf(roles, extra)) out.add(x.permission);
  return [...out];
}

/** Sensitive operations need a Google sign-in within this many seconds. */
export const REAUTH_MAX_AGE = 10 * 60;
