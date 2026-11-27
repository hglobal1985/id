// 生態系統功能的設定與參與狀態（見 platform/eco-features.ts）。
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { ERROR_COUNT_RETENTION_DAYS, MAX_ROWS_PER_APP_DAY, type CountRow, type ErrorReport } from "../platform/error-digest";
import { ECO_FEATURES, appVisibleConfig, settingsFromStored, type EcoFeatureKey, type EcoSettings } from "../platform/eco-features";

type Actor = { memberId: string; requestId: string };

export async function loadEcoSettings(db: D1Database): Promise<Record<EcoFeatureKey, EcoSettings>> {
  const r = await db.prepare("SELECT feature_key, settings FROM eco_features").all<{ feature_key: string; settings: string }>();
  const stored = new Map((r.results ?? []).map((x) => [x.feature_key, x.settings]));
  return Object.fromEntries(ECO_FEATURES.map((k) => [k, settingsFromStored(k, stored.get(k))])) as Record<EcoFeatureKey, EcoSettings>;
}

export interface EcoAppRow {
  feature_key: EcoFeatureKey;
  app_id: string;
  participating: boolean;
  last_status: string | null;
  last_checked_at: string | null;
  last_note: string | null;
}

export async function loadEcoAppRows(db: D1Database): Promise<EcoAppRow[]> {
  const r = await db.prepare("SELECT feature_key, app_id, participating, last_status, last_checked_at, last_note FROM eco_feature_apps").all<{ feature_key: string; app_id: string; participating: number; last_status: string | null; last_checked_at: string | null; last_note: string | null }>();
  return (r.results ?? [])
    .filter((x) => (ECO_FEATURES as readonly string[]).includes(x.feature_key))
    .map((x) => ({ ...x, feature_key: x.feature_key as EcoFeatureKey, participating: x.participating === 1 }));
}

export async function saveEcoSettings(db: D1Database, key: EcoFeatureKey, settings: EcoSettings, actor: Actor, now: Date): Promise<void> {
  const ts = taipeiIso(now);
  await db.batch([
    db.prepare("INSERT INTO eco_features (feature_key, settings, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(feature_key) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(key, JSON.stringify(settings), ts, actor.memberId),
    auditStatement(db, { actorType: "staff", actorId: actor.memberId, action: "eco_feature.save", targetType: "eco_feature", targetId: key, result: "success", requestId: actor.requestId }, now),
  ]);
}

export async function setEcoParticipation(db: D1Database, key: EcoFeatureKey, appId: string, participating: boolean, actor: Actor, now: Date): Promise<void> {
  const ts = taipeiIso(now);
  await db.batch([
    db.prepare("INSERT INTO eco_feature_apps (feature_key, app_id, participating, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(feature_key, app_id) DO UPDATE SET participating = excluded.participating, updated_at = excluded.updated_at").bind(key, appId, participating ? 1 : 0, ts),
    auditStatement(db, { actorType: "staff", actorId: actor.memberId, action: "eco_feature.participation", targetType: "eco_feature", targetId: key, appId, result: "success", requestId: actor.requestId }, now),
  ]);
}

/** 功能執行端（巡檢、週報、備份…）回寫「某個 App 最近一次的結果」，設定頁顯示用。note 不得含個資或機密。 */
export async function recordEcoResult(db: D1Database, key: EcoFeatureKey, appId: string, status: "ok" | "warn" | "fail", note: string | null, now: Date): Promise<void> {
  const ts = taipeiIso(now);
  await db.prepare("INSERT INTO eco_feature_apps (feature_key, app_id, participating, last_status, last_checked_at, last_note, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT(feature_key, app_id) DO UPDATE SET last_status = excluded.last_status, last_checked_at = excluded.last_checked_at, last_note = excluded.last_note")
    .bind(key, appId, status, ts, note ? note.slice(0, 200) : null, ts).run();
}

/** 某個 App 讀 config 時要附上的 eco_features 區塊。 */
export async function ecoConfigFor(db: D1Database, appId: string): Promise<Record<string, unknown>> {
  const [settings, rows] = await Promise.all([loadEcoSettings(db), loadEcoAppRows(db)]);
  const part = new Map(rows.filter((x) => x.app_id === appId).map((x) => [x.feature_key, x.participating] as const));
  return appVisibleConfig(settings, part);
}

export interface UptimeRow {
  url: string;
  name: string;
  status: "up" | "down";
  last_checked_at: string;
  last_change_at: string;
  last_note: string | null;
}

/** 設定頁顯示用：每個被巡檢網址目前的狀態。 */
export async function loadUptimeStates(db: D1Database): Promise<UptimeRow[]> {
  const r = await db.prepare("SELECT url, name, status, last_checked_at, last_change_at, last_note FROM eco_uptime_state ORDER BY name").all<UptimeRow>();
  return r.results ?? [];
}

// ---------- 錯誤回報週報（error_digest） ----------

/** 累加 App 送來的錯誤統計。同一天「種類＋頁面＋版本」的組合超過上限就不再新增新組合（既有組合仍可累加）。回傳實際收下幾筆。 */
export async function addErrorCounts(db: D1Database, appId: string, reports: ErrorReport[], now: Date): Promise<number> {
  const day = taipeiIso(now).slice(0, 10);
  const existing = await db.prepare("SELECT kind, page, app_version FROM eco_error_counts WHERE app_id = ? AND day = ?").bind(appId, day).all<{ kind: string; page: string; app_version: string }>();
  const keys = new Set((existing.results ?? []).map((r) => `${r.kind}|${r.page}|${r.app_version}`));
  const stmts: D1PreparedStatement[] = [];
  for (const r of reports) {
    const k = `${r.kind}|${r.page}|${r.app_version}`;
    if (!keys.has(k)) {
      if (keys.size >= MAX_ROWS_PER_APP_DAY) continue;
      keys.add(k);
    }
    stmts.push(
      db.prepare("INSERT INTO eco_error_counts (app_id, day, kind, page, app_version, count) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(app_id, day, kind, page, app_version) DO UPDATE SET count = count + excluded.count").bind(appId, day, r.kind, r.page, r.app_version, r.count),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

/** 從 fromDay（含）起的統計。 */
export async function loadErrorCounts(db: D1Database, fromDay: string): Promise<CountRow[]> {
  const r = await db.prepare("SELECT app_id, kind, page, app_version, SUM(count) AS count FROM eco_error_counts WHERE day >= ? GROUP BY app_id, kind, page, app_version").bind(fromDay).all<CountRow>();
  return r.results ?? [];
}

/** 週報一天只寄一次：搶到（第一個寫入）的才回 true。 */
export async function claimDigestRun(db: D1Database, runDate: string, now: Date): Promise<boolean> {
  const r = await db.prepare("INSERT OR IGNORE INTO eco_digest_runs (run_date, sent_at) VALUES (?, ?)").bind(runDate, taipeiIso(now)).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function purgeErrorCounts(db: D1Database, now: Date): Promise<void> {
  const cutoff = taipeiIso(new Date(now.getTime() - ERROR_COUNT_RETENTION_DAYS * 86400_000)).slice(0, 10);
  await db.batch([db.prepare("DELETE FROM eco_error_counts WHERE day < ?").bind(cutoff), db.prepare("DELETE FROM eco_digest_runs WHERE run_date < ?").bind(cutoff)]);
}
