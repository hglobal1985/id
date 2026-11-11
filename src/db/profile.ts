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

const AVATAR_MAX_BYTES = 128 * 1024;

/** The image type by its first bytes (never by what the client says), or null. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
export { AVATAR_MAX_BYTES };

/** Stores an uploaded avatar in D1 (small, already resized by the page) and points the member at it. */
export async function saveAvatarUpload(db: D1Database, mime: string, bytes: Uint8Array, issuer: string, w: WriteContext): Promise<string> {
  const ts = taipeiIso(w.now);
  const url = `${issuer}/avatar/${w.memberId}?v=${Math.floor(w.now.getTime() / 1000)}`;
  await db.batch([
    db
      .prepare("INSERT INTO member_avatars (member_id, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (member_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at")
      .bind(w.memberId, mime, bytes, ts),
    db.prepare("UPDATE members SET avatar_url = ?, avatar_source = 'upload', updated_at = ? WHERE id = ?").bind(url, ts, w.memberId),
    auditStatement(db, { actorType: "member", actorId: w.memberId, action: "profile.avatar.upload", targetType: "member", targetId: w.memberId, result: "success", appId: w.appId, requestId: w.requestId }, w.now),
  ]);
  return url;
}

/** Uses the member's Google picture (referenced, not copied). Null when there is none. */
export async function useGoogleAvatar(db: D1Database, w: WriteContext): Promise<string | null> {
  const m = await db.prepare("SELECT google_picture_url FROM members WHERE id = ?").bind(w.memberId).first<{ google_picture_url: string | null }>();
  const url = m?.google_picture_url && /^https:\/\//.test(m.google_picture_url) ? m.google_picture_url : null;
  if (!url) return null;
  const ts = taipeiIso(w.now);
  await db.batch([
    db.prepare("UPDATE members SET avatar_url = ?, avatar_source = 'google', updated_at = ? WHERE id = ?").bind(url, ts, w.memberId),
    db.prepare("DELETE FROM member_avatars WHERE member_id = ?").bind(w.memberId),
    auditStatement(db, { actorType: "member", actorId: w.memberId, action: "profile.avatar.google", targetType: "member", targetId: w.memberId, result: "success", appId: w.appId, requestId: w.requestId }, w.now),
  ]);
  return url;
}

export async function removeAvatar(db: D1Database, w: WriteContext): Promise<boolean> {
  const ts = taipeiIso(w.now);
  await db.prepare("DELETE FROM member_avatars WHERE member_id = ?").bind(w.memberId).run();
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
