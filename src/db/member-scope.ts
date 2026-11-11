// Which members a staff member may look up (read only), and the member search for the back office.
// Every position may look up the members of its own regional center; 會長 also the 寰宇 members; a staff member whose own
// approved rank is 鑽石 or higher, and the head office (總部秘書, 超級管理員), may look up everyone. Union of what applies.
// Fail closed: no center and no other scope means nobody.
import { DIAMOND_RANK_LABEL, type Role } from "../admin/roles";
import { normTerm } from "../vocab/terms";
import { hglobalNorms } from "./vocab";
import { centerNormOfMember } from "./staff";

export interface MemberScope {
  all: boolean;
  /** 會長: members whose training system is 寰宇 (a term marked as H-Global1985). */
  hglobal: boolean;
  /** The staff member's own regional center (normalized); members of that center. */
  center: string | null;
  /** The reason shown to the staff member, e.g. 「全部會員」 / 「自己中心：新竹 122」. */
  labels: string[];
}

/** The staff member's own approved rank is 鑽石 or higher (ladder order). Self-declared, unreviewed ranks do not count. */
export async function hasDiamondRank(db: D1Database, memberId: string): Promise<boolean> {
  const own = await db
    .prepare("SELECT json_extract(v.value, '$') AS code FROM amway_field_values v WHERE v.member_id = ? AND v.field_key = 'rank' AND v.value_approved = 1")
    .bind(memberId)
    .first<{ code: string | null }>();
  if (!own?.code) return false;
  const rows = await db.prepare("SELECT value, label, sort_order FROM amway_options WHERE field_key = 'rank' AND active = 1").all<{ value: string; label: string; sort_order: number }>();
  const list = rows.results ?? [];
  const threshold = list.find((r) => r.label === DIAMOND_RANK_LABEL)?.sort_order;
  const mine = list.find((r) => r.value === own.code)?.sort_order;
  return threshold !== undefined && mine !== undefined && mine >= threshold;
}

export async function memberScopeOf(db: D1Database, memberId: string, roles: readonly Role[]): Promise<MemberScope> {
  const head = roles.includes("super_admin") || roles.includes("secretary");
  const labels: string[] = [];
  const all = head || (await hasDiamondRank(db, memberId));
  if (all) labels.push("全部會員");
  const hglobal = roles.includes("president");
  if (hglobal) labels.push("系統＝寰宇的會員");
  const center = roles.length ? await centerNormOfMember(db, memberId) : null;
  if (center) labels.push("自己中心的會員");
  return { all, hglobal, center, labels };
}

export interface MemberFilter {
  q?: string;
  system?: string;
  center?: string;
  rank?: string;
  status?: "active" | "disabled";
  amway?: "yes" | "no";
  country?: string;
  offset?: number;
  limit?: number;
}

const norm = (s: string) => normTerm(s);

/** SQL pieces: which members a scope sees, and the member filter. `sys`, `ctr`, `rk` are the joined Amway rows. */
async function whereOf(db: D1Database, scope: MemberScope, f: MemberFilter): Promise<{ sql: string; args: unknown[] }> {
  const parts: string[] = ["m.status != 'deleted'"];
  const args: unknown[] = [];
  if (!scope.all) {
    const ors: string[] = [];
    if (scope.hglobal) {
      const norms = [...(await hglobalNorms(db))];
      if (norms.length) {
        ors.push(`lower(trim(json_extract(sys.value, '$'))) IN (${norms.map(() => "?").join(",")})`);
        args.push(...norms);
      }
    }
    if (scope.center) {
      ors.push("lower(trim(json_extract(ctr.value, '$'))) = ?");
      args.push(scope.center);
    }
    parts.push(ors.length ? `(${ors.join(" OR ")})` : "0 = 1");
  }
  const q = (f.q ?? "").trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    parts.push(
      `(m.id = ? OR EXISTS (SELECT 1 FROM member_numbers n WHERE n.member_id = m.id AND (n.number = ? OR n.country || n.number = ?))
        OR m.display_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM profile_field_values v WHERE v.member_id = m.id AND v.field_key = 'display_name' AND v.value LIKE ? ESCAPE '\\'))`,
    );
    args.push(q, q.toUpperCase(), q.toUpperCase(), like, like);
  }
  if (f.system) {
    parts.push("lower(trim(json_extract(sys.value, '$'))) = ?");
    args.push(norm(f.system));
  }
  if (f.center) {
    parts.push("lower(trim(json_extract(ctr.value, '$'))) = ?");
    args.push(norm(f.center));
  }
  if (f.rank) {
    parts.push("json_extract(rk.value, '$') = ?");
    args.push(f.rank);
  }
  if (f.status) {
    parts.push("m.status = ?");
    args.push(f.status);
  }
  if (f.amway) parts.push(f.amway === "yes" ? "m.amway_enabled = 1" : "m.amway_enabled = 0");
  if (f.country) {
    parts.push("m.registration_country = ?");
    args.push(f.country.toUpperCase());
  }
  return { sql: parts.join(" AND "), args };
}

const FROM = `FROM members m
  LEFT JOIN amway_field_values sys ON sys.member_id = m.id AND sys.field_key = 'education_system'
  LEFT JOIN amway_field_values ctr ON ctr.member_id = m.id AND ctr.field_key = 'education_center'
  LEFT JOIN amway_field_values rk ON rk.member_id = m.id AND rk.field_key = 'rank'`;

export async function searchMemberIds(db: D1Database, scope: MemberScope, f: MemberFilter): Promise<{ ids: string[]; total: number }> {
  const w = await whereOf(db, scope, f);
  const limit = Math.min(Math.max(f.limit ?? 30, 1), 100);
  const offset = Math.max(f.offset ?? 0, 0);
  const total = await db.prepare(`SELECT COUNT(*) AS n ${FROM} WHERE ${w.sql}`).bind(...w.args).first<{ n: number }>();
  const r = await db
    .prepare(`SELECT m.id AS id ${FROM} WHERE ${w.sql} ORDER BY m.created_at DESC, m.id LIMIT ? OFFSET ?`)
    .bind(...w.args, limit, offset)
    .all<{ id: string }>();
  return { ids: (r.results ?? []).map((x) => x.id), total: total?.n ?? 0 };
}

/** Whether one member is inside the scope. */
export async function memberInScope(db: D1Database, scope: MemberScope, memberId: string): Promise<boolean> {
  const w = await whereOf(db, scope, {});
  const r = await db.prepare(`SELECT 1 AS x ${FROM} WHERE ${w.sql} AND m.id = ?`).bind(...w.args, memberId).first<{ x: number }>();
  return !!r;
}
