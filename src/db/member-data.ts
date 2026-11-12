// Members' data for Apps registered in the Hglobal ecosystem (ADR 0022). The member's 公開／隱藏 switch decides what the
// public page shows; it does not limit the Apps of the ecosystem: an App reads any field the owner allowed it, for
// members who signed in to that App. Every call is audited (App, count, field NAMES, use; never values).
import { getAmwayField } from "../amway/fields";
import { readAmwayFields } from "./amway";
import { auditStatement } from "./audit";
import { MEMBER_DATA_KEYS } from "../apps/data-fields";
import { publicId } from "../profile/member-number";

export const MEMBER_LOOKUP_MAX = 50;

export type MemberData = { member_id: string; fields: Record<string, unknown> };

const parse = (s: string | null): unknown => {
  try {
    return s === null ? null : JSON.parse(s);
  } catch {
    return null;
  }
};

export async function lookupMemberData(db: D1Database, appId: string, use: string, ids: string[], fields: string[], requestId: string, now: Date): Promise<{ members: MemberData[]; not_found: string[] }> {
  const unique = [...new Set(ids)];
  const marks = unique.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT m.id AS id, m.display_name AS dn, m.avatar_url AS av, m.amway_enabled AS amway FROM members m
       JOIN member_apps ma ON ma.member_id = m.id AND ma.app_id = ? WHERE m.status = 'active' AND m.id IN (${marks})`,
    )
    .bind(appId, ...unique)
    .all<{ id: string; dn: string | null; av: string | null; amway: number }>();
  const profileKeys = fields.filter((k) => k !== "avatar" && k !== "member_number" && !getAmwayField(k));
  const members: MemberData[] = [];
  for (const m of rows.results ?? []) {
    const out: Record<string, unknown> = {};
    if (profileKeys.length) {
      const pm = profileKeys.map(() => "?").join(",");
      const vals = await db.prepare(`SELECT field_key, value FROM profile_field_values WHERE member_id = ? AND field_key IN (${pm})`).bind(m.id, ...profileKeys).all<{ field_key: string; value: string }>();
      const byKey = new Map((vals.results ?? []).map((v) => [v.field_key, parse(v.value)]));
      for (const k of profileKeys) out[k] = byKey.get(k) ?? (k === "display_name" ? m.dn : null);
    }
    if (fields.includes("avatar")) out.avatar = m.av;
    if (fields.includes("member_number")) {
      const n = await db.prepare("SELECT country, number FROM member_numbers WHERE member_id = ? ORDER BY position LIMIT 1").bind(m.id).first<{ country: string; number: string }>();
      out.member_number = n ? publicId({ country: n.country, number: n.number }) : null;
    }
    const amwayKeys = fields.filter((k) => getAmwayField(k));
    if (amwayKeys.length) {
      const a = m.amway === 1 ? await readAmwayFields(db, m.id) : new Map();
      for (const k of amwayKeys) {
        const row = a.get(k);
        // A field that needs review counts only once approved (fail closed); the others are returned as they are.
        out[k] = row && (getAmwayField(k)?.review === "never" || row.value_approved) ? row.value : null;
      }
    }
    members.push({ member_id: m.id, fields: out });
  }
  const found = new Set(members.map((x) => x.member_id));
  await auditStatement(db, { actorType: "app", actorId: appId, action: "members.lookup", result: "success", appId, requestId, detail: { count: unique.length, returned: members.length, use, fields: fields.join(",") } }, now).run();
  return { members, not_found: unique.filter((i) => !found.has(i)) };
}

export const isDataKey = (k: string): boolean => MEMBER_DATA_KEYS.includes(k);
