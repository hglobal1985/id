// Members' data for Apps registered in the Hglobal ecosystem (ADR 0022). The member's 公開／隱藏 switch decides what the
// public page shows; it does not limit the Apps of the ecosystem: an App reads any field the owner allowed it, for
// members who signed in to that App. Every call is audited (App, count, field NAMES, use; never values).
import { getAmwayField } from "../amway/fields";
import { getFieldDefinition } from "../profile/definitions";
import { AMWAY_ROW_COLUMNS, toFieldRow, type FieldRow, type FieldRowRaw } from "./amway";
import { auditStatement } from "./audit";
import { MEMBER_DATA_KEYS } from "../apps/data-fields";
import { publicId } from "../profile/member-number";

export const MEMBER_LOOKUP_MAX = 100;

export type MemberData = { member_id: string; fields: Record<string, unknown> };

const parse = (s: string | null): unknown => {
  try {
    return s === null ? null : JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * Up to MEMBER_LOOKUP_MAX members in a handful of database round trips (never one query per member: ADR 0025, ADR 0032).
 * D1 allows 100 bound parameters per statement, so the members are taken in parts sized to leave room for the field keys.
 * `members` follow the order of the request; ids that are not found (not signed in to the App, disabled, deleted) are in `not_found`.
 */
export async function lookupMemberData(db: D1Database, appId: string, use: string, ids: string[], fields: string[], requestId: string, now: Date): Promise<{ members: MemberData[]; not_found: string[] }> {
  const unique = [...new Set(ids)];
  const profileKeys = fields.filter((k) => k !== "avatar" && k !== "member_number" && !getAmwayField(k));
  const amwayKeys = fields.filter((k) => getAmwayField(k));
  const part = Math.max(1, 95 - profileKeys.length);
  const byId = new Map<string, MemberData>();
  for (let i = 0; i < unique.length; i += part) {
    const chunk = unique.slice(i, i + part);
    const q = chunk.map(() => "?").join(",");
    const pk = profileKeys.map(() => "?").join(",");
    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `SELECT m.id AS id, m.display_name AS dn, m.avatar_url AS av, m.amway_enabled AS amway FROM members m
           JOIN member_apps ma ON ma.member_id = m.id AND ma.app_id = ? WHERE m.status = 'active' AND m.id IN (${q})`,
        )
        .bind(appId, ...chunk),
    ];
    const at = { profile: -1, number: -1, amway: -1 };
    if (profileKeys.length) {
      at.profile = stmts.length;
      stmts.push(db.prepare(`SELECT member_id, field_key, value FROM profile_field_values WHERE field_key IN (${pk}) AND member_id IN (${q})`).bind(...profileKeys, ...chunk));
    }
    if (fields.includes("member_number")) {
      at.number = stmts.length;
      stmts.push(db.prepare(`SELECT member_id, country, number FROM member_numbers WHERE member_id IN (${q}) ORDER BY member_id, position`).bind(...chunk));
    }
    if (amwayKeys.length) {
      at.amway = stmts.length;
      stmts.push(db.prepare(`SELECT member_id, ${AMWAY_ROW_COLUMNS} FROM amway_field_values WHERE member_id IN (${q})`).bind(...chunk));
    }
    const res = await db.batch(stmts);
    const rows = (res[0]?.results ?? []) as unknown as { id: string; dn: string | null; av: string | null; amway: number }[];
    const profile = new Map<string, Map<string, unknown>>();
    for (const v of (at.profile >= 0 ? (res[at.profile]?.results ?? []) : []) as unknown as { member_id: string; field_key: string; value: string }[]) {
      if (!profile.has(v.member_id)) profile.set(v.member_id, new Map());
      profile.get(v.member_id)!.set(v.field_key, parse(v.value));
    }
    const firstNumber = new Map<string, { country: string; number: string }>();
    for (const n of (at.number >= 0 ? (res[at.number]?.results ?? []) : []) as unknown as { member_id: string; country: string; number: string }[]) {
      if (!firstNumber.has(n.member_id)) firstNumber.set(n.member_id, n);
    }
    const amwayRows = new Map<string, Map<string, FieldRow>>();
    for (const a of (at.amway >= 0 ? (res[at.amway]?.results ?? []) : []) as unknown as (FieldRowRaw & { member_id: string })[]) {
      if (!amwayRows.has(a.member_id)) amwayRows.set(a.member_id, new Map());
      amwayRows.get(a.member_id)!.set(a.field_key, toFieldRow(a));
    }
    for (const m of rows) {
      const out: Record<string, unknown> = {};
      const mine = profile.get(m.id);
      for (const k of profileKeys) out[k] = mine?.get(k) ?? (k === "display_name" ? m.dn : (getFieldDefinition(k)?.default_value ?? null));
      if (fields.includes("avatar")) out.avatar = m.av;
      if (fields.includes("member_number")) {
        const n = firstNumber.get(m.id);
        out.member_number = n ? publicId({ country: n.country, number: n.number }) : null;
      }
      // Members who are not Amway members get null for Amway fields.
      const a = m.amway === 1 ? (amwayRows.get(m.id) ?? new Map<string, FieldRow>()) : new Map<string, FieldRow>();
      for (const k of amwayKeys) {
        const row = a.get(k);
        // A field that needs review counts only once approved (fail closed); the others are returned as they are.
        out[k] = row && (getAmwayField(k)?.review === "never" || row.value_approved) ? row.value : null;
      }
      byId.set(m.id, { member_id: m.id, fields: out });
    }
  }
  const members = unique.flatMap((id) => byId.get(id) ?? []);
  await auditStatement(db, { actorType: "app", actorId: appId, action: "members.lookup", result: "success", appId, requestId, detail: { count: unique.length, returned: members.length, use, fields: fields.join(",") } }, now).run();
  return { members, not_found: unique.filter((i) => !byId.has(i)) };
}

export const isDataKey = (k: string): boolean => MEMBER_DATA_KEYS.includes(k);
