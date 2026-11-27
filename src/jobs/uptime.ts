// 網站自動巡檢（生態系統功能 uptime_watch，杜杜龍 2026-11-27）。排程每 5 分鐘呼叫一次；依後台設定的頻率巡檢，
// 掛了（連續失敗 2 次）與恢復各通知一次：站內通知＋Email 給超級管理員。設定與結果在後台「系統功能」頁。
import { taipeiIso, epochSeconds } from "../lib/time";
import { loadEcoSettings } from "../db/eco-features";
import { PROBE_TIMEOUT_MS, describeError, isProbeDue, nextState, type Alert, type ProbeResult, type SiteState } from "../platform/uptime";
import { sendMail, type Mailer } from "./mail";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
interface StateRow {
  url: string;
  status: "up" | "down";
  consecutive_failures: number;
  last_checked_epoch: number;
}

export async function probe(fetcher: Fetcher, url: string): Promise<ProbeResult> {
  try {
    const res = await fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { "user-agent": "hglobal-uptime/1" } });
    void res.body?.cancel();
    return res.status >= 200 && res.status < 300 ? { ok: true, note: `HTTP ${res.status}` } : { ok: false, note: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, note: describeError(e) };
  }
}

export async function loadSiteStates(db: D1Database): Promise<Map<string, StateRow>> {
  const r = await db.prepare("SELECT url, status, consecutive_failures, last_checked_epoch FROM eco_uptime_state").all<StateRow>();
  return new Map((r.results ?? []).map((x) => [x.url, x]));
}

export async function superAdmins(db: D1Database): Promise<string[]> {
  const r = await db.prepare("SELECT DISTINCT s.member_id FROM staff_roles s JOIN members m ON m.id = s.member_id WHERE s.role = 'super_admin' AND m.status = 'active'").all<{ member_id: string }>();
  return (r.results ?? []).map((x) => x.member_id);
}

export async function contactEmails(db: D1Database, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const r = await db.prepare("SELECT value FROM profile_field_values WHERE member_id = ? AND field_key = 'contact_email'").bind(id).first<{ value: string }>();
    try {
      const v = r ? (JSON.parse(r.value) as unknown) : null;
      if (typeof v === "string" && /^[^\s@]+@[^\s@]+$/.test(v)) out.push(v);
    } catch {
      /* 壞掉的值略過 */
    }
  }
  return out;
}

async function sendAlerts(db: D1Database, mailer: Mailer | undefined, notifyPush: boolean, notifyEmail: boolean, items: { name: string; alert: Exclude<Alert, null>; note: string }[], now: Date): Promise<void> {
  if (!items.length) return;
  const admins = await superAdmins(db);
  const ts = taipeiIso(now);
  // 「推播」在中央等同站內通知：各 App 的通知頁會顯示；真正的手機推播由 App 端轉送。
  if (notifyPush) {
    await db.batch(
      admins.flatMap((id) => items.map((it) => db.prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES (lower(hex(randomblob(16))), ?, 'eco.uptime', ?, ?)").bind(id, JSON.stringify({ name: it.name, alert: it.alert, note: it.note }), ts))),
    );
  }
  if (notifyEmail && mailer) {
    const lines = items.map((it) => `${it.alert === "down" ? "【掛了】" : "【已恢復】"}${it.name}（${it.note}）`);
    const subject = items.some((i) => i.alert === "down") ? "網站巡檢：有網站打不開" : "網站巡檢：網站已恢復";
    const text = `${lines.join("\n")}\n\n時間：${ts}\n這是系統自動寄出的通知。`;
    for (const to of await contactEmails(db, admins)) await sendMail(mailer, to, subject, text).catch(() => undefined);
  }
}

/** 回傳這次巡檢的網站數（0＝沒到時間或功能關閉）。 */
export async function runUptime(db: D1Database, mailer: Mailer | undefined, fetcher: Fetcher, now: Date): Promise<number> {
  const s = (await loadEcoSettings(db)).uptime_watch;
  if (!s.enabled || !s.sites?.length) return 0;
  const interval = s.interval_minutes ?? 15;
  const nowEpoch = epochSeconds(now);
  const states = await loadSiteStates(db);
  const due = s.sites.filter((site) => isProbeDue(interval, states.get(site.url)?.last_checked_epoch ?? null, nowEpoch));
  if (!due.length) return 0;
  const results = await Promise.all(due.map(async (site) => ({ site, r: await probe(fetcher, site.url) })));
  const ts = taipeiIso(now);
  const alerts: { name: string; alert: Exclude<Alert, null>; note: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const { site, r } of results) {
    const prev = states.get(site.url);
    const prevState: SiteState | null = prev ? { status: prev.status, consecutive_failures: prev.consecutive_failures } : null;
    const { state, alert } = nextState(prevState, r);
    const changed = !prev || prev.status !== state.status;
    stmts.push(
      db.prepare("INSERT INTO eco_uptime_state (url, name, status, consecutive_failures, last_checked_at, last_checked_epoch, last_change_at, last_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, status = excluded.status, consecutive_failures = excluded.consecutive_failures, last_checked_at = excluded.last_checked_at, last_checked_epoch = excluded.last_checked_epoch, last_change_at = CASE WHEN ? = 1 THEN excluded.last_change_at ELSE eco_uptime_state.last_change_at END, last_note = excluded.last_note")
        .bind(site.url, site.name, state.status, state.consecutive_failures, ts, nowEpoch, ts, r.note, changed ? 1 : 0),
    );
    if (alert) alerts.push({ name: site.name, alert, note: r.note });
  }
  await db.batch(stmts);
  await sendAlerts(db, mailer, s.notify_push, s.notify_email, alerts, now);
  return due.length;
}
