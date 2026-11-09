// Data access for profile field values, visibility and avatar.
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import type { FieldValue, Visibility } from "../profile/definitions";

export interface StoredField {
  value: FieldValue;
  updated_at: string;
}

export async function readProfile(
  db: D1Database,
  memberId: string,
): Promise<{ values: Map<string, StoredField>; visibility: Map<string, Visibility> }> {
  const [vals, vis] = await db.batch([
    db.prepare("SELECT field_key, value, updated_at FROM profile_field_values WHERE member_id = ?").bind(memberId),
    db.prepare("SELECT field_key, visibility FROM profile_visibility WHERE member_id = ?").bind(memberId),
  ]);
  const values = new Map<string, StoredField>();
  for (const r of (vals?.results ?? []) as { field_key: string; value: string; updated_at: string }[]) {
    try {
      values.set(r.field_key, { value: JSON.parse(r.value) as FieldValue, updated_at: r.updated_at });
    } catch {
      // Unreadable value: treat as empty rather than failing the whole profile.
    }
  }
  const visibility = new Map<string, Visibility>();
  for (const r of (vis?.results ?? []) as { field_key: string; visibility: Visibility }[]) visibility.set(r.field_key, r.visibility);
  return { values, visibility };
}

export interface WriteContext {
  memberId: string;
  appId: string | null;
  requestId: string;
  now: Date;
}

/**
 * Writes one field (null clears it). Idempotent: writing the current value changes nothing and is not audited.
 * The audit entry records which app changed which field and when — never the value.
 */
export async function writeField(db: D1Database, key: string, value: FieldValue, w: WriteContext): Promise<{ changed: boolean; updated_at: string | null }> {
  const current = await db
    .prepare("SELECT value, updated_at FROM profile_field_values WHERE member_id = ? AND field_key = ?")
    .bind(w.memberId, key)
    .first<{ value: string; updated_at: string }>();
  const next = value === null ? null : JSON.stringify(value);
  if ((current?.value ?? null) === next) return { changed: false, updated_at: current?.updated_at ?? null };
  const ts = taipeiIso(w.now);
  const write =
    next === null
      ? db.prepare("DELETE FROM profile_field_values WHERE member_id = ? AND field_key = ?").bind(w.memberId, key)
      : db
          .prepare(
            `INSERT INTO profile_field_values (member_id, field_key, value, updated_at, updated_by_app) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (member_id, field_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_app = excluded.updated_by_app`,
          )
          .bind(w.memberId, key, next, ts, w.appId);
  await db.batch([
    write,
    db.prepare("UPDATE members SET updated_at = ? WHERE id = ?").bind(ts, w.memberId),
    auditStatement(
      db,
      {
        actorType: "member",
        actorId: w.memberId,
        action: next === null ? "profile.field.clear" : "profile.field.update",
        targetType: "member",
        targetId: w.memberId,
        result: "success",
        appId: w.appId,
        requestId: w.requestId,
        detail: { field_key: key },
      },
      w.now,
    ),
  ]);
  return { changed: true, updated_at: next === null ? null : ts };
}

export async function writeVisibility(db: D1Database, changes: [string, Visibility][], w: WriteContext): Promise<void> {
  if (!changes.length) return;
  const ts = taipeiIso(w.now);
  await db.batch([
    ...changes.map(([key, vis]) =>
      db
        .prepare(
          `INSERT INTO profile_visibility (member_id, field_key, visibility, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (member_id, field_key) DO UPDATE SET visibility = excluded.visibility, updated_at = excluded.updated_at`,
        )
        .bind(w.memberId, key, vis, ts),
    ),
    auditStatement(
      db,
      {
        actorType: "member",
        actorId: w.memberId,
        action: "profile.visibility.update",
        targetType: "member",
        targetId: w.memberId,
        result: "success",
        appId: w.appId,
        requestId: w.requestId,
        detail: { fields: changes.map(([k, v]) => `${k}:${v}`).join(",") },
      },
      w.now,
    ),
  ]);
}

export async function removeAvatar(db: D1Database, w: WriteContext): Promise<boolean> {
  const ts = taipeiIso(w.now);
  const res = await db
    .prepare("UPDATE members SET avatar_url = NULL, avatar_source = 'none', updated_at = ? WHERE id = ? AND avatar_source != 'none'")
    .bind(ts, w.memberId)
    .run();
  if (!res.meta.changes) return false;
  await auditStatement(
    db,
    { actorType: "member", actorId: w.memberId, action: "profile.avatar.remove", targetType: "member", targetId: w.memberId, result: "success", appId: w.appId, requestId: w.requestId },
    w.now,
  ).run();
  return true;
}
