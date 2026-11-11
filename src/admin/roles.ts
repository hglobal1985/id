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
  | "adjust" // change a member's 系統 / 中心 / 獎銜 (treated as approved) — head office only
  | "members.manage" // suspend / reinstate and delete members — head office only
  | "members.read" // look up members (every position; what a position may see is its scope, see db/member-scope.ts)
  | "social.manage" // social platforms: names, order, icons (super admin only)
  | "layout.manage" // order of the profile fields on every member page (super admin only)
  | "vocab.manage" // suggestion vocabularies: edit, merge, delete related words (super admin only)
  | "audit.read"
  | "staff.manage" // grant / revoke roles (needs recent sign-in)
  | "apps.operate" // App list, statistics, integration instructions, pause / kill switch
  | "apps.manage"; // register a new App, edit a registration (super admin only)

const MATRIX: Record<Role, Permission[]> = {
  super_admin: ["review", "adjust", "members.manage", "members.read", "vocab.manage", "layout.manage", "social.manage", "audit.read", "staff.manage", "apps.operate", "apps.manage"],
  secretary: ["review", "adjust", "members.manage", "members.read", "audit.read", "apps.operate"],
  reviewer: ["review", "members.read"],
  // 會長、課務、音控、票務、活動: the positions exist; what each one may do is added when the owner decides it.
  president: ["members.read"],
  course: ["members.read"],
  sound: ["members.read"],
  ticket: ["members.read"],
  activity: ["members.read"],
};

/** 鑽石 and every rank above it (by the ladder order): a staff member holding one may look up all members, read only. */
export const DIAMOND_RANK_LABEL = "鑽石";

/** The permission table shown on the 權限 page (a dot chart): who may do what. Built from the same MATRIX the server enforces. */
export interface FeatureRow {
  label: string;
  /** Roles that have it (from the matrix, or listed here for scope rules the matrix cannot express). */
  roles: Role[];
  /** Also granted to any staff member whose own approved rank is 鑽石 or higher. */
  diamond?: boolean;
}
const rolesWith = (p: Permission): Role[] => (Object.keys(MATRIX) as Role[]).filter((r) => MATRIX[r].includes(p));
export const FEATURES: FeatureRow[] = [
  { label: "查詢會員：自己中心的會員（只能查詢）", roles: [...ROLES] },
  { label: "查詢會員：系統＝寰宇的會員名單（只能查詢）", roles: ["president"] },
  { label: "查詢會員：全部會員，不分系統（只能查詢）", roles: ["super_admin", "secretary"], diamond: true },
  { label: "審核中心／獎銜申請：自己中心的申請", roles: ["reviewer"] },
  { label: "審核中心／獎銜申請：全部中心", roles: ["super_admin", "secretary"] },
  { label: "修改會員的系統、中心、獎銜", roles: rolesWith("adjust") },
  { label: "停權、解除停權會員", roles: rolesWith("members.manage") },
  { label: "刪除會員", roles: rolesWith("members.manage") },
  { label: "查看稽核紀錄", roles: rolesWith("audit.read") },
  { label: "App 清單、統計、暫停與停用", roles: rolesWith("apps.operate") },
  { label: "登記新 App、編輯 App 登記", roles: rolesWith("apps.manage") },
  { label: "管理關聯詞", roles: rolesWith("vocab.manage") },
  { label: "基本資料欄位順序與區塊", roles: rolesWith("layout.manage") },
  { label: "管理社群平台", roles: rolesWith("social.manage") },
  { label: "指派職務（管理人員）", roles: rolesWith("staff.manage") },
];

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

