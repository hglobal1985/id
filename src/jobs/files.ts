// Avatar files: move the old D1 copies into R2, and sweep R2 files nobody owns any more.
//
// Both are safe to run on every scheduled tick: they only do a small batch, and doing nothing twice changes nothing.
import { blobBytes } from "../lib/blob";
import { IN_R2, avatarKey } from "../lib/files";

const BATCH = 20;
const PREFIX = "avatars/";
/** A file younger than this is never swept (an upload writes R2 first and D1 right after). */
const SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

/** Copies avatars still stored in D1 into R2, then replaces the D1 bytes by the "in R2" marker. Returns how many moved. */
export async function moveAvatarsToR2(db: D1Database, bucket: R2Bucket | undefined): Promise<number> {
  if (!bucket) return 0;
  const rows = await db
    .prepare("SELECT member_id, mime, data, updated_at FROM member_avatars WHERE length(data) > 0 ORDER BY updated_at LIMIT ?")
    .bind(BATCH)
    .all<{ member_id: string; mime: string; data: unknown; updated_at: string }>();
  let moved = 0;
  for (const r of rows.results ?? []) {
    const bytes = blobBytes(r.data);
    if (!bytes.length) continue;
    try {
      await bucket.put(avatarKey(r.member_id), bytes, { httpMetadata: { contentType: r.mime } });
      const check = await bucket.head(avatarKey(r.member_id));
      if (!check || check.size !== bytes.length) continue;
      // Only if the member did not upload a newer one in the meantime.
      const res = await db.prepare("UPDATE member_avatars SET data = ? WHERE member_id = ? AND updated_at = ? AND length(data) > 0").bind(IN_R2, r.member_id, r.updated_at).run();
      if (res.meta.changes) moved++;
    } catch {
      /* try again on the next tick */
    }
  }
  return moved;
}

/** Deletes R2 avatar files whose member no longer has an uploaded avatar. Returns how many were removed. */
export async function sweepAvatars(db: D1Database, bucket: R2Bucket | undefined, now: Date): Promise<number> {
  if (!bucket) return 0;
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: PREFIX, limit: 500, cursor });
    const old = page.objects.filter((o) => now.getTime() - o.uploaded.getTime() > SWEEP_MIN_AGE_MS);
    const ids = old.map((o) => o.key.slice(PREFIX.length));
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const q = part.map(() => "?").join(",");
      const have = await db.prepare(`SELECT member_id FROM member_avatars WHERE member_id IN (${q})`).bind(...part).all<{ member_id: string }>();
      const keep = new Set((have.results ?? []).map((x) => x.member_id));
      const gone = part.filter((id) => !keep.has(id)).map(avatarKey);
      if (gone.length) {
        await bucket.delete(gone);
        removed += gone.length;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return removed;
}
