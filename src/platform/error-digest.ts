// 錯誤回報週報的規則（不依賴框架，杜杜龍 2026-11-27）：App 送來的錯誤統計怎麼驗證、怎麼整理成週報、何時該寄。
// 只收「錯誤種類、頁面、App 版本、次數」；任何自由文字（錯誤訊息、堆疊、網址參數）一律不收。

export const ERROR_KINDS = ["crash", "render", "network", "api", "auth", "other"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];
export const KIND_LABEL: Record<ErrorKind, string> = { crash: "程式當機", render: "畫面顯示錯誤", network: "網路連線錯誤", api: "伺服器回應錯誤", auth: "登入錯誤", other: "其他" };

export const MAX_REPORTS_PER_CALL = 20;
export const MAX_COUNT_PER_REPORT = 1000;
/** 單一 App 每天最多幾種「種類＋頁面＋版本」組合（防止被灌爆資料庫）。 */
export const MAX_ROWS_PER_APP_DAY = 200;
/** 統計保留天數（週報只看最近 7 天，多留一些給日後查）。 */
export const ERROR_COUNT_RETENTION_DAYS = 35;

export interface ErrorReport {
  kind: ErrorKind;
  page: string;
  app_version: string;
  count: number;
}

export class ErrorReportError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/** 頁面只留路徑：去掉查詢字串與錨點，把像識別碼的片段（UUID、8 碼以上英數混合或純數字）換成 :id。 */
export function normalizePage(raw: string): string {
  const path = (raw.split(/[?#]/)[0] ?? "").trim();
  if (!path.startsWith("/")) throw new ErrorReportError("page 要以 / 開頭（只要路徑）。");
  const segs = path.split("/").map((s) => {
    if (!s) return s;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return ":id";
    if (/^\d+$/.test(s)) return s.length > 3 ? ":id" : s;
    if (s.length >= 12 && /\d/.test(s) && /^[A-Za-z0-9_-]+$/.test(s)) return ":id";
    return s;
  });
  const out = segs.join("/");
  if (out.length > 120 || !/^\/[A-Za-z0-9_\-./:]*$/.test(out)) throw new ErrorReportError("page 只能是 120 字以內的路徑（英數、- _ . /）。");
  return out;
}

export function normalizeReport(input: unknown): ErrorReport {
  if (!isRecord(input)) throw new ErrorReportError("每筆回報需為物件。");
  const kind = input.kind;
  if (typeof kind !== "string" || !(ERROR_KINDS as readonly string[]).includes(kind)) throw new ErrorReportError(`kind 只能是 ${ERROR_KINDS.join("、")}。`);
  if (typeof input.page !== "string") throw new ErrorReportError("page 必填。");
  const v = input.app_version;
  if (typeof v !== "string" || !VERSION.test(v)) throw new ErrorReportError("app_version 格式要像 1.2.3。");
  const count = input.count === undefined ? 1 : input.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_COUNT_PER_REPORT) throw new ErrorReportError(`count 要是 1 到 ${MAX_COUNT_PER_REPORT} 的整數。`);
  return { kind: kind as ErrorKind, page: normalizePage(input.page), app_version: v, count };
}

export function normalizeReports(input: unknown): ErrorReport[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_REPORTS_PER_CALL) throw new ErrorReportError(`reports 要有 1 到 ${MAX_REPORTS_PER_CALL} 筆。`);
  return input.map(normalizeReport);
}

/** 台北時間的 {日期, 星期, 小時, 分鐘}。 */
export function taipeiParts(now: Date): { date: string; weekday: number; hour: number; minute: number } {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}

/** 週報固定在設定的星期、台北 09:00～09:04 之間寄（排程每 5 分鐘醒一次）。 */
export function isDigestDue(weekday: number, now: Date): boolean {
  const p = taipeiParts(now);
  return p.weekday === weekday && p.hour === 9 && p.minute < 5;
}

export interface CountRow {
  app_id: string;
  kind: string;
  page: string;
  app_version: string;
  count: number;
}

export interface AppDigest {
  app_id: string;
  name: string;
  total: number;
  by_kind: { kind: string; count: number }[];
  top_pages: { page: string; count: number }[];
  versions: string[];
}

const TOP = 5;

/** 把一週的統計整理成每個 App 的摘要（次數多的在前）。 */
export function summarize(rows: CountRow[], names: ReadonlyMap<string, string>): AppDigest[] {
  const byApp = new Map<string, CountRow[]>();
  for (const r of rows) byApp.set(r.app_id, [...(byApp.get(r.app_id) ?? []), r]);
  const sum = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [...byApp.entries()]
    .map(([app_id, list]) => {
      const kinds = new Map<string, number>();
      const pages = new Map<string, number>();
      const versions = new Set<string>();
      let total = 0;
      for (const r of list) {
        total += r.count;
        kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + r.count);
        pages.set(r.page, (pages.get(r.page) ?? 0) + r.count);
        versions.add(r.app_version);
      }
      return {
        app_id,
        name: names.get(app_id) ?? app_id,
        total,
        by_kind: sum(kinds).map(([kind, count]) => ({ kind, count })),
        top_pages: sum(pages).slice(0, TOP).map(([page, count]) => ({ page, count })),
        versions: [...versions].sort(),
      };
    })
    .sort((a, b) => b.total - a.total || a.app_id.localeCompare(b.app_id));
}

export function kindLabel(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? kind;
}

export function digestText(apps: AppDigest[], fromDate: string, toDate: string): string {
  const total = apps.reduce((n, a) => n + a.total, 0);
  const head = `錯誤回報週報（${fromDate} ～ ${toDate}）：共 ${total} 次。`;
  const blocks = apps.map((a) => {
    const kinds = a.by_kind.map((k) => `${kindLabel(k.kind)} ${k.count}`).join("、");
    const pages = a.top_pages.map((p) => `${p.page}（${p.count}）`).join("、");
    return `■ ${a.name}：${a.total} 次\n  種類：${kinds}\n  最常發生的頁面：${pages}\n  版本：${a.versions.join("、")}`;
  });
  return `${head}\n\n${blocks.join("\n\n")}\n\n這是系統自動寄出的週報，只含錯誤種類、頁面、版本與次數。`;
}
