// The members of one regional center, for an App that lets a center's staff pick a person (ADR 0028). Read only; the caller is
// always a signed-in member (never a service token). Returns the least that picking needs: id, name, picture, and whether the
// person has used the calling App.
import { readAmwayFields } from "./amway";
import { loadMemberEligibility } from "./eligibility";
import { normTerm } from "../vocab/terms";

export interface CenterMember {
  member_id: string;
  display_name: string;
  avatar_url: string | null;
  signed_in_app: boolean;
}

export interface Cursor {
  name: string;
  id: string;
}

export const encodeCursor = (c: Cursor): string => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([c.name, c.id])))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function decodeCursor(s: string): Cursor | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const [name, id] = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))) as unknown[];
    return typeof name === "string" && typeof id === "string" ? { name, id } : null;
  } catch {
    return null;
  }
}

/** The caller's own approved regional center (same rule as GET /v1/eligibility/context): 寰宇 verified, Amway on, center approved. */
export async function approvedCenterOf(db: D1Database, memberId: string): Promise<{ active: boolean; center: { key: string; label: string } | null }> {
  const [m, fields] = await Promise.all([loadMemberEligibility(db, memberId), readAmwayFields(db, memberId)]);
  if (!m) return { active: false, center: null };
  const row = fields.get("education_center");
  const label = m.amwayActive && m.hglobalVerified && row && row.value_approved && typeof row.value === "string" ? row.value.trim() : "";
  return { active: true, center: label ? { key: normTerm(label), label } : null };
}

// D1 allows at most 100 bound parameters per statement.
const CHUNK = 90;

export async function listCenterMembers(
  db: D1Database,
  o: { key: string; callerId: string; appId: string; q: string; limit: number; cursor: Cursor | null; withAvatar: boolean },
): Promise<{ members: CenterMember[]; next: Cursor | null }> {
  // Everyone whose approved center is this one (compared in the normalized form, like center.key), active, Amway on.
  const rows = await db
    .prepare(
      `SELECT f.member_id AS id, f.value AS value FROM amway_field_values f JOIN members m ON m.id = f.member_id
       WHERE f.field_key = 'education_center' AND f.value_approved = 1 AND f.value IS NOT NULL AND m.status = 'active' AND m.amway_enabled = 1 AND f.member_id != ?`,
    )
    .bind(o.callerId)
    .all<{ id: string; value: string }>();
  const ids: string[] = [];
  for (const r of rows.results ?? []) {
    try {
      const v = JSON.parse(r.value) as unknown;
      if (typeof v === "string" && normTerm(v.trim()) === o.key) ids.push(r.id);
    } catch {
      /* unreadable value: not listed */
    }
  }
  const all: CenterMember[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const q = part.map(() => "?").join(",");
    const [members, names, used] = await db.batch([
      db.prepare(`SELECT id, display_name, avatar_url FROM members WHERE id IN (${q})`).bind(...part),
      db.prepare(`SELECT member_id, value FROM profile_field_values WHERE field_key = 'display_name' AND member_id IN (${q})`).bind(...part),
      db.prepare(`SELECT member_id FROM member_apps WHERE app_id = ? AND member_id IN (${q})`).bind(o.appId, ...part),
    ]);
    const own = new Map<string, string>();
    for (const n of (names?.results ?? []) as { member_id: string; value: string }[]) {
      try {
        const v = JSON.parse(n.value) as unknown;
        if (typeof v === "string" && v.trim()) own.set(n.member_id, v.trim());
      } catch {
        /* the Google name below */
      }
    }
    const signedIn = new Set(((used?.results ?? []) as { member_id: string }[]).map((x) => x.member_id));
    for (const m of (members?.results ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
      all.push({ member_id: m.id, display_name: own.get(m.id) ?? m.display_name?.trim() ?? "會員", avatar_url: o.withAvatar ? m.avatar_url : null, signed_in_app: signedIn.has(m.id) });
    }
  }
  // Search by display name only (the legal name is for payments, never for finding people).
  const needle = normTerm(o.q);
  const hits = needle ? all.filter((m) => normTerm(m.display_name).includes(needle)) : all;
  hits.sort((a, b) => (a.display_name < b.display_name ? -1 : a.display_name > b.display_name ? 1 : a.member_id < b.member_id ? -1 : 1));
  const after = o.cursor ? hits.filter((m) => m.display_name > o.cursor!.name || (m.display_name === o.cursor!.name && m.member_id > o.cursor!.id)) : hits;
  const page = after.slice(0, o.limit);
  const last = page[page.length - 1];
  return { members: page, next: after.length > o.limit && last ? { name: last.display_name, id: last.member_id } : null };
}
