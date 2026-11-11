// Social platforms and members' social links (see migration 0018).
import { uuidv7 } from "../lib/crypto";
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { MAX_LINKS } from "../social/rules";

export interface PlatformRow {
  key: string;
  name: string;
  sort_order: number;
  builtin_icon: string | null;
  has_upload: boolean;
  icon_version: number;
  custom: boolean;
}

interface RawPlatform {
  key: string;
  name: string;
  sort_order: number;
  builtin_icon: string | null;
  uploaded: number;
  icon_version: number;
  custom: number;
}

const toPlatform = (r: RawPlatform): PlatformRow => ({ key: r.key, name: r.name, sort_order: r.sort_order, builtin_icon: r.builtin_icon, has_upload: r.uploaded === 1, icon_version: r.icon_version, custom: r.custom === 1 });

export async function listPlatforms(db: D1Database): Promise<PlatformRow[]> {
  const r = await db
    .prepare("SELECT key, name, sort_order, builtin_icon, (icon_data IS NOT NULL) AS uploaded, icon_version, custom FROM social_platforms ORDER BY sort_order, key")
    .all<RawPlatform>();
  return (r.results ?? []).map(toPlatform);
}

export interface Actor {
  memberId: string;
  requestId: string;
  now: Date;
}

const audit = (db: D1Database, a: Actor, action: string, target: string) =>
  auditStatement(db, { actorType: "staff", actorId: a.memberId, action, targetType: "social_platform", targetId: target, result: "success", requestId: a.requestId }, a.now);

export async function addPlatform(db: D1Database, key: string, name: string, a: Actor): Promise<void> {
  const ts = taipeiIso(a.now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO social_platforms (key, name, sort_order, builtin_icon, custom, created_at, updated_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM social_platforms WHERE custom = 0), NULL, 0, ?, ?)`,
      )
      .bind(key, name, ts, ts),
    // 自定義 stays last unless the administrator moves it.
    db.prepare("UPDATE social_platforms SET sort_order = (SELECT MAX(sort_order) FROM social_platforms WHERE custom = 0) + 10 WHERE custom = 1 AND sort_order <= (SELECT MAX(sort_order) FROM social_platforms WHERE custom = 0)"),
    audit(db, a, "social.platform.add", key),
  ]);
}

export async function renamePlatform(db: D1Database, key: string, name: string, a: Actor): Promise<boolean> {
  const r = await db.prepare("UPDATE social_platforms SET name = ?, updated_at = ? WHERE key = ?").bind(name, taipeiIso(a.now), key).run();
  if (!r.meta.changes) return false;
  await audit(db, a, "social.platform.rename", key).run();
  return true;
}

/** Saves the order of every platform (the whole list, top to bottom). */
export async function reorderPlatforms(db: D1Database, keys: string[], a: Actor): Promise<void> {
  const ts = taipeiIso(a.now);
  await db.batch([...keys.map((k, i) => db.prepare("UPDATE social_platforms SET sort_order = ?, updated_at = ? WHERE key = ?").bind((i + 1) * 10, ts, k)), audit(db, a, "social.platform.reorder", "all")]);
}

export async function setPlatformIcon(db: D1Database, key: string, mime: string | null, data: Uint8Array | null, a: Actor): Promise<boolean> {
  const r = await db
    .prepare("UPDATE social_platforms SET icon_mime = ?, icon_data = ?, icon_version = icon_version + 1, updated_at = ? WHERE key = ?")
    .bind(mime, data, taipeiIso(a.now), key)
    .run();
  if (!r.meta.changes) return false;
  await audit(db, a, data ? "social.platform.icon" : "social.platform.icon_reset", key).run();
  return true;
}

/** Deletes a platform (not the 自定義 one). Links already made with it stay and show the generic link icon. */
export async function deletePlatform(db: D1Database, key: string, a: Actor): Promise<boolean> {
  const r = await db.prepare("DELETE FROM social_platforms WHERE key = ? AND custom = 0").bind(key).run();
  if (!r.meta.changes) return false;
  await audit(db, a, "social.platform.delete", key).run();
  return true;
}

export async function platformIcon(db: D1Database, key: string): Promise<{ mime: string | null; data: ArrayBuffer | null; builtin: string | null } | null> {
  const r = await db.prepare("SELECT icon_mime AS mime, icon_data AS data, builtin_icon AS builtin FROM social_platforms WHERE key = ?").bind(key).first<{ mime: string | null; data: ArrayBuffer | null; builtin: string | null }>();
  return r ?? null;
}

// ---------- members' links ----------

export interface LinkRow {
  id: string;
  platform_key: string;
  platform_name: string | null;
  url: string;
  label: string | null;
  own_icon: boolean;
  icon_version: number;
}

interface RawLink {
  id: string;
  platform_key: string;
  platform_name: string | null;
  url: string;
  label: string | null;
  own_icon: number;
  icon_version: number | null;
}

export async function listLinks(db: D1Database, memberId: string): Promise<LinkRow[]> {
  const r = await db
    .prepare(
      `SELECT l.id, l.platform_key, p.name AS platform_name, l.url, l.label, (l.icon_data IS NOT NULL) AS own_icon, p.icon_version
       FROM social_links l LEFT JOIN social_platforms p ON p.key = l.platform_key
       WHERE l.member_id = ? ORDER BY l.sort_order, l.created_at, l.id`,
    )
    .bind(memberId)
    .all<RawLink>();
  return (r.results ?? []).map((x) => ({ id: x.id, platform_key: x.platform_key, platform_name: x.platform_name, url: x.url, label: x.label, own_icon: x.own_icon === 1, icon_version: x.icon_version ?? 1 }));
}

export type AddResult = { ok: true; id: string } | { ok: false; reason: "unknown_platform" | "too_many" };

export async function addLink(db: D1Database, memberId: string, platformKey: string, url: string, label: string | null, now: Date, requestId: string): Promise<AddResult> {
  const platform = await db.prepare("SELECT key FROM social_platforms WHERE key = ?").bind(platformKey).first<{ key: string }>();
  if (!platform) return { ok: false, reason: "unknown_platform" };
  const count = await db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), 0) AS top FROM social_links WHERE member_id = ?").bind(memberId).first<{ n: number; top: number }>();
  if ((count?.n ?? 0) >= MAX_LINKS) return { ok: false, reason: "too_many" };
  const id = uuidv7(now.getTime());
  const ts = taipeiIso(now);
  await db.batch([
    db.prepare("INSERT INTO social_links (id, member_id, platform_key, url, label, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, memberId, platformKey, url, label, (count?.top ?? 0) + 10, ts),
    auditStatement(db, { actorType: "member", actorId: memberId, action: "social.link.add", targetType: "member", targetId: memberId, result: "success", requestId, detail: { platform: platformKey } }, now),
  ]);
  return { ok: true, id };
}

/** Changes the address and the shown name of one of the member's links (the platform stays). */
export async function updateLink(db: D1Database, memberId: string, id: string, url: string, label: string | null, now: Date, requestId: string): Promise<boolean> {
  const r = await db.prepare("UPDATE social_links SET url = ?, label = ? WHERE id = ? AND member_id = ?").bind(url, label, id, memberId).run();
  if (!r.meta.changes) return false;
  await auditStatement(db, { actorType: "member", actorId: memberId, action: "social.link.update", targetType: "member", targetId: memberId, result: "success", requestId }, now).run();
  return true;
}

export async function removeLink(db: D1Database, memberId: string, id: string, now: Date, requestId: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM social_links WHERE id = ? AND member_id = ?").bind(id, memberId).run();
  if (!r.meta.changes) return false;
  await auditStatement(db, { actorType: "member", actorId: memberId, action: "social.link.remove", targetType: "member", targetId: memberId, result: "success", requestId }, now).run();
  return true;
}

/** Sets the member's own icon of a link of the 自定義 platform. */
export async function setLinkIcon(db: D1Database, memberId: string, id: string, mime: string, data: Uint8Array): Promise<boolean> {
  const r = await db
    .prepare("UPDATE social_links SET icon_mime = ?, icon_data = ? WHERE id = ? AND member_id = ? AND platform_key IN (SELECT key FROM social_platforms WHERE custom = 1)")
    .bind(mime, data, id, memberId)
    .run();
  return !!r.meta.changes;
}

export async function linkIcon(db: D1Database, id: string): Promise<{ mime: string; data: ArrayBuffer } | null> {
  const r = await db
    .prepare("SELECT l.icon_mime AS mime, l.icon_data AS data FROM social_links l JOIN members m ON m.id = l.member_id WHERE l.id = ? AND m.status = 'active' AND l.icon_data IS NOT NULL")
    .bind(id)
    .first<{ mime: string; data: ArrayBuffer }>();
  return r ?? null;
}
