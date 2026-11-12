// Several members' display data in ONE database round trip.
//
// The Worker often runs far from the database (a visitor in Taiwan can be served from Los Angeles while D1 is in Singapore),
// so every query costs a trans-Pacific round trip. Looking members up one by one inside a loop therefore turns a short list
// into many seconds. Lists must load what they need for all rows at once with this module (one db.batch = one round trip).
import { AMWAY_ROW_COLUMNS, toFieldRow, type FieldRow, type FieldRowRaw } from "./amway";
import type { MemberRow } from "./identity";
import type { MemberNumberEntry } from "../profile/member-number";

export interface MemberBrief {
  member: MemberRow | null;
  /** The name shown to staff: the member's own display_name field, else the Google name. */
  display_name: string | null;
  numbers: MemberNumberEntry[];
  amway: Map<string, FieldRow>;
}

// D1 allows at most 100 bound parameters per statement.
const CHUNK = 90;

export async function memberBriefs(db: D1Database, ids: string[]): Promise<Map<string, MemberBrief>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, MemberBrief>();
  for (const id of unique) out.set(id, { member: null, display_name: null, numbers: [], amway: new Map() });
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const q = part.map(() => "?").join(",");
    const [members, names, numbers, amway] = await db.batch([
      db.prepare(`SELECT * FROM members WHERE id IN (${q})`).bind(...part),
      db.prepare(`SELECT member_id, value FROM profile_field_values WHERE field_key = 'display_name' AND member_id IN (${q})`).bind(...part),
      db.prepare(`SELECT member_id, country, number FROM member_numbers WHERE member_id IN (${q}) ORDER BY member_id, position`).bind(...part),
      db.prepare(`SELECT member_id, ${AMWAY_ROW_COLUMNS} FROM amway_field_values WHERE member_id IN (${q})`).bind(...part),
    ]);
    for (const m of (members?.results ?? []) as unknown as MemberRow[]) {
      const b = out.get(m.id);
      if (b) {
        b.member = m;
        b.display_name = m.display_name ?? null;
      }
    }
    for (const n of (names?.results ?? []) as unknown as { member_id: string; value: string }[]) {
      const b = out.get(n.member_id);
      if (!b) continue;
      try {
        b.display_name = JSON.parse(n.value) as string;
      } catch {
        /* keep the Google name */
      }
    }
    for (const n of (numbers?.results ?? []) as unknown as { member_id: string; country: string; number: string }[]) {
      out.get(n.member_id)?.numbers.push({ country: n.country, number: n.number });
    }
    for (const a of (amway?.results ?? []) as unknown as (FieldRowRaw & { member_id: string })[]) {
      out.get(a.member_id)?.amway.set(a.field_key, toFieldRow(a));
    }
  }
  return out;
}
