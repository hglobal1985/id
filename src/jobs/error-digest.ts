// 錯誤回報週報（生態系統功能 error_digest，杜杜龍 2026-11-27）。排程每 5 分鐘呼叫一次；
// 在設定的星期、台北 09:00 寄出最近 7 天的錯誤統計（站內通知＋Email 給超級管理員），一週只寄一次。沒有任何錯誤就不寄。
import { taipeiIso } from "../lib/time";
import { claimDigestRun, loadEcoAppRows, loadEcoSettings, loadErrorCounts, purgeErrorCounts, recordEcoResult } from "../db/eco-features";
import { listApps } from "../db/apps";
import { digestText, isDigestDue, summarize, taipeiParts } from "../platform/error-digest";
import { contactEmails, superAdmins } from "./uptime";
import { sendMail, type Mailer } from "./mail";

/** 回傳這次彙整的錯誤總數（0＝沒到時間、功能關閉或本週沒有錯誤）。 */
export async function runErrorDigest(db: D1Database, mailer: Mailer | undefined, now: Date): Promise<number> {
  const s = (await loadEcoSettings(db)).error_digest;
  if (!s.enabled || !isDigestDue(s.weekday ?? 1, now)) return 0;
  const today = taipeiParts(now).date;
  if (!(await claimDigestRun(db, today, now))) return 0;
  const from = taipeiIso(new Date(now.getTime() - 6 * 86400_000)).slice(0, 10);
  const [rows, { apps }, appRows] = await Promise.all([loadErrorCounts(db, from), listApps(db, now), loadEcoAppRows(db)]);
  const off = new Set(appRows.filter((r) => r.feature_key === "error_digest" && !r.participating).map((r) => r.app_id));
  const digest = summarize(rows.filter((r) => !off.has(r.app_id)), new Map(apps.map((a) => [a.app_id, a.name])));
  for (const a of apps) if (!off.has(a.app_id)) await recordEcoResult(db, "error_digest", a.app_id, "ok", `最近 7 天 ${digest.find((d) => d.app_id === a.app_id)?.total ?? 0} 次`, now);
  const total = digest.reduce((n, a) => n + a.total, 0);
  await purgeErrorCounts(db, now);
  if (!total) return 0;
  const admins = await superAdmins(db);
  const ts = taipeiIso(now);
  if (s.notify_push) {
    await db.batch(
      admins.map((id) => db.prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES (lower(hex(randomblob(16))), ?, 'eco.error_digest', ?, ?)").bind(id, JSON.stringify({ total, apps: digest.slice(0, 5).map((a) => ({ name: a.name, total: a.total })) }), ts)),
    );
  }
  if (s.notify_email && mailer) {
    const text = digestText(digest, from, today);
    for (const to of await contactEmails(db, admins)) await sendMail(mailer, to, `錯誤回報週報：本週共 ${total} 次`, text).catch(() => undefined);
  }
  return total;
}
