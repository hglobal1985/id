// 生態系統功能（杜杜龍 2026-11-27）：整個生態系通用的系統功能，設定存在中央，每個 App 一律照同一套規則參與。
// 本檔不依賴框架：功能清單、預設值、驗證、以及「某個 App 實際看到的設定」。
// 各功能的執行（巡檢、週報、備份…）各自在後續的 PR 實作，這裡只負責「設定」與「誰參與」。

export const ECO_FEATURES = ["dependency_alerts", "uptime_watch", "error_digest", "weekly_backup"] as const;
export type EcoFeatureKey = (typeof ECO_FEATURES)[number];

export const UPTIME_INTERVALS = [5, 10, 15, 30, 60] as const;
export const MAX_SITES = 10;
export const MAX_KEEP = 12;

export interface UptimeSite {
  name: string;
  url: string;
}

/** 單一功能的全域設定。欄位依功能而不同；沒有用到的欄位不出現。 */
export interface EcoSettings {
  enabled: boolean;
  notify_push: boolean;
  notify_email: boolean;
  /** uptime_watch：每幾分鐘巡檢一次 */
  interval_minutes?: number;
  /** uptime_watch：要巡檢的網址（只能是 https 的寰宇網域） */
  sites?: UptimeSite[];
  /** error_digest、weekly_backup：星期幾執行（0＝星期日 … 6＝星期六，台北時間） */
  weekday?: number;
  /** weekly_backup：保留最近幾份 */
  keep?: number;
}

export interface EcoFeatureInfo {
  key: EcoFeatureKey;
  label: string;
  summary: string;
  /** 這個功能需要 App 自己做什麼（沒有就是中央全包）。 */
  app_duty: string;
  /** 這個功能在設定頁可調的欄位。 */
  fields: ReadonlyArray<"interval_minutes" | "sites" | "weekday" | "keep">;
  /** App 讀 config 時看得到的欄位（不含通知對象與網址清單）。 */
  app_visible: ReadonlyArray<"weekday" | "keep">;
  defaults: EcoSettings;
}

export const DEFAULT_SITES: UptimeSite[] = [
  { name: "行動大學", url: "https://learn.hglobal1985.com/api/v2/version" },
  { name: "繳作業系統", url: "https://check.hglobal1985.com/version" },
  { name: "會員中心", url: "https://id.hglobal1985.com/v1/health" },
];

export const ECO_CATALOG: Record<EcoFeatureKey, EcoFeatureInfo> = {
  dependency_alerts: {
    key: "dependency_alerts",
    label: "套件安全漏洞提醒",
    summary: "每個程式庫啟用 GitHub Dependabot：每週檢查套件漏洞，自動開修正 PR。",
    app_duty: "App 的程式庫要有 .github/dependabot.yml（每週檢查）；修正 PR 通過檢查才合併。",
    fields: [],
    app_visible: [],
    defaults: { enabled: true, notify_push: false, notify_email: false },
  },
  uptime_watch: {
    key: "uptime_watch",
    label: "網站自動巡檢",
    summary: "定時檢查各網站的健康網址，掛了就通知杜杜龍。",
    app_duty: "App 的網站要有公開、不含機密的健康網址（回 200 與版本資訊）。",
    fields: ["interval_minutes", "sites"],
    app_visible: [],
    defaults: { enabled: true, notify_push: true, notify_email: true, interval_minutes: 15, sites: DEFAULT_SITES },
  },
  error_digest: {
    key: "error_digest",
    label: "錯誤回報週報",
    summary: "彙整各 App 前台錯誤回報，每週推播與 Email 給杜杜龍。",
    app_duty: "App 把前台錯誤回報送到中央（只含錯誤種類、頁面、版本、次數，不含個資、Token、姓名、信箱）。",
    fields: ["weekday"],
    app_visible: [],
    defaults: { enabled: true, notify_push: true, notify_email: true, weekday: 1 },
  },
  weekly_backup: {
    key: "weekly_backup",
    label: "重要資料每週備份",
    summary: "各 App 的永久資料每週匯出到 R2，附還原說明。",
    app_duty: "App 提供備份匯出（只含依法或業務必須永久保存的資料；不含 Amway 資料與暫存資料），備份檔存在 R2、不放進公開程式庫。",
    fields: ["weekday", "keep"],
    app_visible: ["weekday", "keep"],
    defaults: { enabled: true, notify_push: true, notify_email: false, weekday: 0, keep: 8 },
  },
};

export class EcoError extends Error {}

export const isEcoFeature = (k: string): k is EcoFeatureKey => (ECO_FEATURES as readonly string[]).includes(k);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asBool = (v: unknown, name: string): boolean => {
  if (typeof v !== "boolean") throw new EcoError(`${name} 需為 true 或 false。`);
  return v;
};

/** 巡檢網址只允許 https 的寰宇網域（避免把中央變成任意網址的探測器）。 */
export function checkSiteUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new EcoError("網址格式不正確。");
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.port) throw new EcoError("網址只能是 https（不可帶帳號或埠號）。");
  if (host !== "hglobal1985.com" && !host.endsWith(".hglobal1985.com")) throw new EcoError("只能巡檢 hglobal1985.com 的網站。");
  if (raw.length > 200) throw new EcoError("網址太長。");
  return u.toString();
}

/** 驗證並整理一個功能的設定（整份取代）。沒有給的欄位用預設值。 */
export function normalizeSettings(key: EcoFeatureKey, input: unknown): EcoSettings {
  if (!isRecord(input)) throw new EcoError("設定需為物件。");
  const info = ECO_CATALOG[key];
  const d = info.defaults;
  const out: EcoSettings = {
    enabled: input.enabled === undefined ? d.enabled : asBool(input.enabled, "enabled"),
    notify_push: input.notify_push === undefined ? d.notify_push : asBool(input.notify_push, "notify_push"),
    notify_email: input.notify_email === undefined ? d.notify_email : asBool(input.notify_email, "notify_email"),
  };
  if (info.fields.includes("interval_minutes")) {
    const v = input.interval_minutes === undefined ? d.interval_minutes : input.interval_minutes;
    if (typeof v !== "number" || !(UPTIME_INTERVALS as readonly number[]).includes(v)) throw new EcoError(`頻率只能是 ${UPTIME_INTERVALS.join("、")} 分鐘。`);
    out.interval_minutes = v;
  }
  if (info.fields.includes("sites")) {
    const v = input.sites === undefined ? d.sites : input.sites;
    if (!Array.isArray(v) || v.length > MAX_SITES) throw new EcoError(`巡檢網站最多 ${MAX_SITES} 個。`);
    const seen = new Set<string>();
    out.sites = v.map((s): UptimeSite => {
      if (!isRecord(s) || typeof s.name !== "string" || typeof s.url !== "string") throw new EcoError("每個網站要有 name 與 url。");
      const name = s.name.trim();
      if (name.length < 1 || name.length > 30) throw new EcoError("網站名稱 1 到 30 字。");
      const url = checkSiteUrl(s.url.trim());
      if (seen.has(url)) throw new EcoError("網址重複了。");
      seen.add(url);
      return { name, url };
    });
  }
  if (info.fields.includes("weekday")) {
    const v = input.weekday === undefined ? d.weekday : input.weekday;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 6) throw new EcoError("星期需為 0（日）到 6（六）。");
    out.weekday = v;
  }
  if (info.fields.includes("keep")) {
    const v = input.keep === undefined ? d.keep : input.keep;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_KEEP) throw new EcoError(`保留份數 1 到 ${MAX_KEEP}。`);
    out.keep = v;
  }
  return out;
}

/** 讀回資料庫存的設定：壞掉或缺欄位就退回預設（fail safe：設定壞了不會讓功能意外關掉或亂跑）。 */
export function settingsFromStored(key: EcoFeatureKey, stored: string | null | undefined): EcoSettings {
  if (!stored) return structuredClone(ECO_CATALOG[key].defaults);
  try {
    return normalizeSettings(key, JSON.parse(stored));
  } catch {
    return structuredClone(ECO_CATALOG[key].defaults);
  }
}

/** App 讀 GET /v1/apps/{app_id}/config 時看到的設定：只有「是否參與」與少數公開欄位，沒有通知對象、沒有網址清單。 */
export function appVisibleConfig(settings: Record<EcoFeatureKey, EcoSettings>, participation: ReadonlyMap<EcoFeatureKey, boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ECO_FEATURES) {
    const s = settings[key];
    const on = s.enabled && (participation.get(key) ?? true);
    const entry: Record<string, unknown> = { enabled: on };
    if (on) for (const f of ECO_CATALOG[key].app_visible) if (s[f] !== undefined) entry[f] = s[f];
    out[key] = entry;
  }
  return out;
}
