// 每週備份（生態系統功能 weekly_backup，杜杜龍 2026-11-27）。排程每 5 分鐘呼叫；在設定的星期、台北 03:00 把中央的永久資料匯出到 R2。
// 一週只做一次；每份備份先寫資料檔，最後才寫 manifest.json（沒有 manifest 代表不完整）；結束後只留最近 keep 份。
import { taipeiIso } from "../lib/time";
import { claimBackupRun, loadEcoSettings, recordEcoResult } from "../db/eco-features";
import { taipeiParts } from "../platform/error-digest";
import { BACKUP_PREFIX, BACKUP_TABLES, ROWS_PER_FILE, backupFolder, backupsToDelete, isBackupDue, restoreReadme, type BackupManifest } from "../platform/backup";
import { superAdmins } from "./uptime";

/** 回傳備份的總列數（0＝沒到時間、功能關閉、沒有 R2，或失敗）。失敗時回寫結果並通知杜杜龍。 */
export async function runWeeklyBackup(db: D1Database, bucket: R2Bucket | undefined, now: Date): Promise<number> {
  const s = (await loadEcoSettings(db)).weekly_backup;
  if (!s.enabled || !bucket || !isBackupDue(s.weekday ?? 0, now)) return 0;
  const date = taipeiParts(now).date;
  if (!(await claimBackupRun(db, date, now))) return 0;
  const folder = backupFolder(date);
  try {
    const manifest: BackupManifest = { version: 1, created_at: taipeiIso(now), tables: {} };
    let total = 0;
    for (const [table, cols] of Object.entries(BACKUP_TABLES)) {
      const files: string[] = [];
      let rows = 0;
      for (let offset = 0; ; offset += ROWS_PER_FILE) {
        const r = await db.prepare(`SELECT ${cols.join(", ")} FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`).bind(ROWS_PER_FILE, offset).all<Record<string, unknown>>();
        const list = r.results ?? [];
        if (!list.length && offset > 0) break;
        const name = `${table}.${files.length + 1}.ndjson`;
        await bucket.put(folder + name, list.map((x) => JSON.stringify(x)).join("\n"), { httpMetadata: { contentType: "application/x-ndjson" } });
        files.push(name);
        rows += list.length;
        if (list.length < ROWS_PER_FILE) break;
      }
      manifest.tables[table] = { rows, files };
      total += rows;
    }
    await bucket.put(folder + "README.txt", restoreReadme(date), { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
    await bucket.put(folder + "manifest.json", JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
    await pruneBackups(bucket, s.keep ?? 8);
    await recordEcoResult(db, "weekly_backup", "central", "ok", `${date} 共 ${total} 列`, now);
    return total;
  } catch (e) {
    await recordEcoResult(db, "weekly_backup", "central", "fail", `${date} 備份失敗：${e instanceof Error ? e.name : "error"}`, now).catch(() => undefined);
    if (s.notify_push) {
      const ts = taipeiIso(now);
      const admins = await superAdmins(db);
      await db.batch(admins.map((id) => db.prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES (lower(hex(randomblob(16))), ?, 'eco.backup_failed', ?, ?)").bind(id, JSON.stringify({ date }), ts))).catch(() => undefined);
    }
    throw e;
  }
}

async function pruneBackups(bucket: R2Bucket, keep: number): Promise<void> {
  const listed = await bucket.list({ prefix: BACKUP_PREFIX, delimiter: "/" });
  for (const folder of backupsToDelete(listed.delimitedPrefixes, keep)) {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: folder, cursor });
      if (page.objects.length) await bucket.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}
