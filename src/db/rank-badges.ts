// Rank badges (ADR 0027): which ranks have a badge picture, its version and where the artwork sits in the canvas.
// The picture is in R2 (badges/<rank code>.png, served publicly at /badges/<code>.png); this is the index.
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { dropFiles } from "../lib/files";

/** Every badge is drawn on the same canvas, so one scale fits every rank (a higher rank has a longer artwork). */
export const BADGE_WIDTH = 380;
export const BADGE_HEIGHT = 720;
export const BADGE_MAX_BYTES = 256 * 1024;

export const badgeKey = (rank: string) => `badges/${rank}.png`;
const CODE = /^[a-z0-9_]{1,40}$/;
export const isRankCode = (v: unknown): v is string => typeof v === "string" && CODE.test(v);

export interface BadgeRow {
  value: string;
  version: number;
  width: number;
  height: number;
  art_top: number;
  art_bottom: number;
}

export interface BadgeInfo {
  badge_url: string;
  badge: { width: number; height: number; art_top: number; art_bottom: number };
}

/** Public address of a badge. The version is part of it: a replaced picture gets a new address, so caches never serve the old one. */
export const badgeUrl = (issuer: string, rank: string, version: number) => `${issuer}/badges/${rank}.png?v=${version}`;

export function badgeInfo(issuer: string, b: BadgeRow): BadgeInfo {
  return { badge_url: badgeUrl(issuer, b.value, b.version), badge: { width: b.width, height: b.height, art_top: b.art_top, art_bottom: b.art_bottom } };
}

export async function listBadges(db: D1Database): Promise<Map<string, BadgeRow>> {
  const r = await db.prepare("SELECT value, version, width, height, art_top, art_bottom FROM rank_badges").all<BadgeRow>();
  return new Map((r.results ?? []).map((b) => [b.value, b]));
}

/** Checks an uploaded picture: a PNG on the standard 380x720 canvas, not too big. Reads the header only. */
export function checkBadgePng(bytes: Uint8Array): { ok: true } | { ok: false; message: string } {
  if (bytes.length > BADGE_MAX_BYTES) return { ok: false, message: "圖片太大（上限 256 KB）" };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || !sig.every((x, i) => bytes[i] === x)) return { ok: false, message: "請上傳 PNG 圖片" };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(12) !== 0x49484452) return { ok: false, message: "請上傳 PNG 圖片" };
  const w = dv.getUint32(16);
  const h = dv.getUint32(20);
  if (w !== BADGE_WIDTH || h !== BADGE_HEIGHT) return { ok: false, message: `圖片尺寸必須是 ${BADGE_WIDTH}×${BADGE_HEIGHT}（透明背景），目前是 ${w}×${h}` };
  return { ok: true };
}

export function checkArtRange(top: unknown, bottom: unknown): { ok: true; top: number; bottom: number } | { ok: false } {
  if (!Number.isInteger(top) || !Number.isInteger(bottom)) return { ok: false };
  const t = top as number;
  const b = bottom as number;
  return t >= 0 && b > t && b <= BADGE_HEIGHT ? { ok: true, top: t, bottom: b } : { ok: false };
}

export interface Actor {
  memberId: string;
  requestId: string;
  now: Date;
}

const audit = (db: D1Database, a: Actor, action: string, rank: string) =>
  auditStatement(db, { actorType: "staff", actorId: a.memberId, action, targetType: "rank_badge", targetId: rank, result: "success", requestId: a.requestId, detail: { rank } }, a.now);

/** The rank must be an existing 獎銜 option. */
export async function rankExists(db: D1Database, value: string): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS x FROM amway_options WHERE field_key = 'rank' AND value = ?").bind(value).first<{ x: number }>();
  return !!r;
}

/** Stores a badge (new or replacement). Returns false when R2 refused the file, so nothing points at a missing picture. */
export async function saveBadge(db: D1Database, bucket: R2Bucket, rank: string, bytes: Uint8Array, artTop: number, artBottom: number, a: Actor): Promise<boolean> {
  try {
    await bucket.put(badgeKey(rank), bytes, { httpMetadata: { contentType: "image/png" } });
  } catch {
    return false;
  }
  const ts = taipeiIso(a.now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO rank_badges (value, version, width, height, art_top, art_bottom, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT (value) DO UPDATE SET version = rank_badges.version + 1, art_top = excluded.art_top, art_bottom = excluded.art_bottom, updated_at = excluded.updated_at`,
      )
      .bind(rank, BADGE_WIDTH, BADGE_HEIGHT, artTop, artBottom, ts),
    audit(db, a, "rank_badge.save", rank),
  ]);
  return true;
}

/** Removes a badge: the rank goes back to "no badge" (the API returns null for it). */
export async function removeBadge(db: D1Database, bucket: R2Bucket | undefined, rank: string, a: Actor): Promise<boolean> {
  const r = await db.prepare("DELETE FROM rank_badges WHERE value = ?").bind(rank).run();
  if (!r.meta.changes) return false;
  await audit(db, a, "rank_badge.remove", rank).run();
  await dropFiles(bucket, [badgeKey(rank)]);
  return true;
}
