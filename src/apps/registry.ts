// App registry rules (framework-free). An App definition is one JSON object stored in `registered_apps`;
// parseApp validates it on every write and every read, so a broken row can never be used.
import { SUPPORTED_SCOPES } from "../oidc/scopes";
import { MEMBER_DATA_KEYS } from "./data-fields";

export type AppStatus = "active" | "paused" | "killed";
export const APP_STATUSES: readonly AppStatus[] = ["active", "paused", "killed"];

export interface AppEntry {
  app_id: string;
  name: string;
  /** iOS, Android and the web version share one app_id. */
  ios_bundle_id: string | null;
  android_package: string | null;
  status: AppStatus;
  /** Scopes carried by this App's access tokens (same names as the /v1 APIs check). */
  scopes: readonly string[];
  /** false = legacy App holding every scope (owner decision 2026-11-11); true = only `scopes` (least privilege, ADR 0021). */
  scopes_restricted: boolean;
  /** Purposes this App may look up members' contact e-mail for (POST /v1/apps/{app_id}/contacts/lookup). Empty = not allowed. */
  contact_purposes: readonly string[];
  /** Member data fields this App may read for its members through POST /v1/apps/{app_id}/members/lookup, hidden ones included (ADR 0022). Empty = none. */
  member_data_fields: readonly string[];
  min_version: string;
  /** Public remote settings returned by GET /v1/apps/{app_id}/config. Never secrets. */
  config: Readonly<Record<string, unknown>>;
  /** Extra Google client ids accepted for this App (only for native sign-in; the relay client is always accepted). */
  auth: { readonly google_audiences: readonly string[] };
  /** HTTPS origins of the App's web version: CORS on /v1 and sign-in relay return pages. */
  web_origins: readonly string[];
  /** App deep links the sign-in relay may return to, e.g. learn://auth/google. */
  return_urls: readonly string[];
}

/** Scopes an App may hold. `openid` and `profile` belong to the OIDC flow only. */
export const APP_SCOPES: readonly string[] = SUPPORTED_SCOPES.filter((s) => s !== "openid" && s !== "profile");

/** What each scope allows, in plain words (the back office shows this first, the code in brackets). */
export const SCOPE_LABELS: Readonly<Record<string, string>> = {
  "profile.read": "讀取會員基本資料與通知（頭像、暱稱、本名、社群連結、站內通知）",
  "profile.basic.write": "修改基本資料（暱稱、自我介紹、職業、學歷、社群連結、會員編號）",
  "profile.avatar.write": "更換或移除頭像",
  "profile.contact.write": "修改聯絡與地區資料（聯絡信箱、手機、居住地）",
  "profile.birthday.write": "修改生日",
  "profile.visibility.write": "設定各欄位要公開或隱藏",
  "profile.spouse.write": "夫妻綁定與解除",
  "amway.read": "讀取 Amway 資料與查詢資格（系統、中心、獎銜；判斷會員能不能使用某些內容）",
  "amway.write": "修改 Amway 資料（勾選「我是 Amway 會員」、填系統、中心、獎銜、上手）",
};

/** What each contact-lookup purpose means, in plain words. */
export const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  payment_notice: "付款相關通知（繳費提醒、收據、對帳）",
  course_notice: "課程相關通知（報名成功、開課、課程異動）",
  account_security: "帳號安全通知（異常登入、重要資料被修改）",
};

/** The least-privilege default for a newly registered App: sign-in and eligibility lookup only. */
export const DEFAULT_APP_SCOPES: readonly string[] = ["amway.read"];

/** What an App may be allowed to send contact notices for. */
export const CONTACT_PURPOSES: readonly string[] = ["payment_notice", "course_notice", "account_security"];

/** app_ids that can never be registered: they name the central site itself. */
export const RESERVED_APP_IDS: readonly string[] = ["central", "account", "id", "admin", "www"];

const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const AUDIENCE = /^[A-Za-z0-9._:-]{1,200}$/;
const PLATFORM_ID = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/;
const WEB_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;
// Custom-scheme deep links only, so the relay can never hand tokens to an unregistered web page.
const RETURN_URL = /^(?!(?:https?|javascript|data|file|intent|blob|about):)[a-z][a-z0-9+.-]{1,30}:\/\/[A-Za-z0-9._~/-]{1,100}$/;

export class AppDefinitionError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function platformId(v: unknown, field: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.length <= 150 && PLATFORM_ID.test(v)) return v;
  throw new AppDefinitionError(`${field} 格式不正確（例如 com.hglobal1985.learn）。`);
}

function list(v: unknown, pattern: RegExp, field: string, max: number): readonly string[] {
  if (v === undefined) return Object.freeze([]);
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === "string" && pattern.test(x))) {
    throw new AppDefinitionError(`${field} 有格式不正確的項目。`);
  }
  return Object.freeze([...new Set(v as string[])]);
}

function scopeList(v: unknown): readonly string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && APP_SCOPES.includes(x))) throw new AppDefinitionError("權限範圍有不認得的項目。");
  return Object.freeze([...new Set(v as string[])]);
}

function purposeList(v: unknown): readonly string[] {
  const out = list(v, /^[a-z_]{3,40}$/, "聯絡信箱用途", 10);
  if (!out.every((x) => CONTACT_PURPOSES.includes(x))) throw new AppDefinitionError("聯絡信箱用途有不認得的項目。");
  return out;
}

function dataFieldList(v: unknown): readonly string[] {
  const out = list(v, /^[a-z_]{2,40}$/, "可使用的會員資料欄位", 60);
  if (!out.every((x) => MEMBER_DATA_KEYS.includes(x))) throw new AppDefinitionError("可使用的會員資料欄位有不認得的項目。");
  return out;
}

/** Validates one App definition. Throws AppDefinitionError with a message the back office can show. */
export function parseApp(item: unknown): AppEntry {
  if (!isRecord(item) || typeof item.app_id !== "string" || !APP_ID.test(item.app_id)) {
    throw new AppDefinitionError("app_id 需為 2～32 個小寫英文、數字或連字號，並以英文字母開頭。");
  }
  if (RESERVED_APP_IDS.includes(item.app_id)) throw new AppDefinitionError("這個 app_id 保留給中央會員系統，不能登記。");
  const name = typeof item.name === "string" ? item.name.trim() : "";
  // Control characters are refused; the name is shown in the back office and inside the integration instructions.
  if (!name || name.length > 80 || /\p{Cc}/u.test(name)) throw new AppDefinitionError("名稱必填，最多 80 字。");
  if (!APP_STATUSES.includes(item.status as AppStatus)) throw new AppDefinitionError("狀態需為 active、paused 或 killed。");
  if (typeof item.min_version !== "string" || !SEMVER.test(item.min_version)) throw new AppDefinitionError("最低版本要寫成 1.2.3 的格式。");
  if (item.config !== undefined && !isRecord(item.config)) throw new AppDefinitionError("config 需為物件。");
  const auth = item.auth === undefined ? {} : item.auth;
  if (!isRecord(auth)) throw new AppDefinitionError("auth 需為物件。");
  return Object.freeze({
    app_id: item.app_id,
    name,
    ios_bundle_id: platformId(item.ios_bundle_id, "iOS Bundle ID"),
    android_package: platformId(item.android_package, "Android 套件名稱"),
    status: item.status as AppStatus,
    // Legacy Apps (no scopes_restricted flag) hold every scope (owner decision 2026-11-11). An App the owner restricted
    // holds exactly its stored list (ADR 0021).
    scopes: item.scopes_restricted === true ? scopeList(item.scopes) : APP_SCOPES,
    scopes_restricted: item.scopes_restricted === true,
    contact_purposes: purposeList(item.contact_purposes),
    member_data_fields: dataFieldList(item.member_data_fields),
    min_version: item.min_version,
    config: Object.freeze({ ...(item.config as Record<string, unknown> | undefined) }),
    auth: Object.freeze({ google_audiences: list(auth.google_audiences, AUDIENCE, "額外的 Google 用戶端 ID", 10) }),
    web_origins: list(item.web_origins, WEB_ORIGIN, "網頁版來源", 10),
    return_urls: list(item.return_urls, RETURN_URL, "App 回傳網址", 10),
  });
}

/** The JSON stored in `registered_apps.definition`. */
export function appDefinition(app: AppEntry): Record<string, unknown> {
  return {
    app_id: app.app_id,
    name: app.name,
    ios_bundle_id: app.ios_bundle_id,
    android_package: app.android_package,
    status: app.status,
    scopes: app.scopes,
    scopes_restricted: app.scopes_restricted,
    contact_purposes: app.contact_purposes,
    member_data_fields: app.member_data_fields,
    min_version: app.min_version,
    config: app.config,
    auth: { google_audiences: app.auth.google_audiences },
    web_origins: app.web_origins,
    return_urls: app.return_urls,
  };
}

export interface AppForm {
  app_id?: string;
  name?: string;
  ios_bundle_id?: string;
  android_package?: string;
  scheme?: string;
  web_origins?: string[];
  return_urls?: string[];
  extra_google_audiences?: string[];
  min_version?: string;
  /** Super admin only: switches the App to an explicit scope list (null/omitted keeps what is stored). */
  scopes?: string[];
  contact_purposes?: string[];
  member_data_fields?: string[];
}

const clean = (v: string[] | undefined) => [...new Set((v ?? []).map((x) => x.trim()).filter(Boolean))];

/**
 * Builds the definition a back-office form describes. With `defaults`, blank platform fields are derived from the
 * app_id: every App ships on iOS, Android and the web under one app_id, so a new App gets
 * com.hglobal1985.<app_id>, https://<app_id>.hglobal1985.com and <app_id>://auth/google.
 */
export function definitionFromForm(form: AppForm, options: { defaults?: boolean; keep?: AppEntry } = {}): AppEntry {
  const appId = (form.app_id ?? "").trim();
  const compact = appId.replace(/-/g, "");
  // Fields the form leaves out (undefined, not empty) keep what is stored: a small edit such as new scopes never wipes the rest.
  const k = options.keep;
  const ios = form.ios_bundle_id === undefined && k ? k.ios_bundle_id : (form.ios_bundle_id ?? "").trim() || (options.defaults ? `com.hglobal1985.${compact}` : null);
  const android = form.android_package === undefined && k ? k.android_package : (form.android_package ?? "").trim() || (options.defaults ? `com.hglobal1985.${compact}` : null);
  const webOrigins = form.web_origins === undefined && k ? [...k.web_origins] : clean(form.web_origins);
  if (!webOrigins.length && options.defaults) webOrigins.push(`https://${appId}.hglobal1985.com`);
  const returnUrls = form.return_urls === undefined && k ? [...k.return_urls] : clean(form.return_urls);
  if (!returnUrls.length && options.defaults) returnUrls.push(`${(form.scheme ?? "").trim() || compact}://auth/google`);
  return parseApp({
    app_id: appId,
    name: form.name ?? "",
    ios_bundle_id: ios,
    android_package: android,
    // Status and remote settings are not part of the form: editing never un-pauses an App or drops its settings.
    status: options.keep?.status ?? "active",
    // A new App starts with the least privilege; an existing one keeps what it has unless the form names scopes.
    ...scopeFields(form, options),
    contact_purposes: form.contact_purposes ?? options.keep?.contact_purposes ?? [],
    member_data_fields: form.member_data_fields ?? options.keep?.member_data_fields ?? [],
    min_version: (form.min_version ?? "").trim() || options.keep?.min_version || "0.0.0",
    config: options.keep?.config ?? {},
    auth: { google_audiences: form.extra_google_audiences === undefined && k ? [...k.auth.google_audiences] : clean(form.extra_google_audiences) },
    web_origins: webOrigins,
    return_urls: returnUrls,
  });
}

function scopeFields(form: AppForm, options: { defaults?: boolean; keep?: AppEntry }): { scopes: readonly string[]; scopes_restricted: boolean } {
  if (form.scopes) return { scopes: form.scopes, scopes_restricted: true };
  if (options.keep) return { scopes: options.keep.scopes, scopes_restricted: options.keep.scopes_restricted };
  return { scopes: DEFAULT_APP_SCOPES, scopes_restricted: true };
}

/** A registered deep link, or an https page (no fragment) on one of the App's registered web origins. */
export function allowedReturn(app: AppEntry, value: string): "deep_link" | "web" | null {
  if (app.return_urls.includes(value)) return "deep_link";
  if (value.length > 300) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" && url.hash === "" && url.username === "" && url.password === "" && app.web_origins.includes(url.origin) ? "web" : null;
}
