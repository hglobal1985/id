// App registry rules (framework-free). An App definition is one JSON object stored in `registered_apps`;
// parseApp validates it on every write and every read, so a broken row can never be used.
import { SUPPORTED_SCOPES } from "../oidc/scopes";

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
export const DEFAULT_APP_SCOPES: readonly string[] = ["profile.read", "amway.read"];

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
  if (!Array.isArray(item.scopes) || !item.scopes.every((s) => typeof s === "string" && APP_SCOPES.includes(s))) {
    throw new AppDefinitionError("權限範圍有不支援的項目。");
  }
  const config = item.config === undefined ? {} : parseConfig(item.config);
  const auth = item.auth === undefined ? {} : item.auth;
  if (!isRecord(auth)) throw new AppDefinitionError("auth 需為物件。");
  return Object.freeze({
    app_id: item.app_id,
    name,
    ios_bundle_id: platformId(item.ios_bundle_id, "iOS Bundle ID"),
    android_package: platformId(item.android_package, "Android 套件名稱"),
    status: item.status as AppStatus,
    scopes: Object.freeze(APP_SCOPES.filter((s) => (item.scopes as string[]).includes(s))),
    min_version: item.min_version,
    config,
    auth: Object.freeze({ google_audiences: list(auth.google_audiences, AUDIENCE, "額外的 Google 用戶端 ID", 10) }),
    web_origins: list(item.web_origins, WEB_ORIGIN, "網頁版來源", 10),
    return_urls: list(item.return_urls, RETURN_URL, "App 回傳網址", 10),
  });
}

const CONFIG_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const CONFIG_MAX_KEYS = 50;
const CONFIG_MAX_BYTES = 8 * 1024;

/**
 * Validates the public remote settings an App reads from GET /v1/apps/{app_id}/config: a flat object of
 * string, number, boolean or null values. Everything here is public, so it must never hold secrets.
 */
export function parseConfig(value: unknown): Readonly<Record<string, string | number | boolean | null>> {
  if (!isRecord(value)) throw new AppDefinitionError("公開設定需為物件。");
  const keys = Object.keys(value);
  if (keys.length > CONFIG_MAX_KEYS) throw new AppDefinitionError(`公開設定最多 ${CONFIG_MAX_KEYS} 項。`);
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of keys) {
    if (!CONFIG_KEY.test(key)) throw new AppDefinitionError(`設定名稱「${key.slice(0, 20)}」格式不正確（英文字母開頭，只能用英文、數字、底線、點、連字號，最多 64 字）。`);
    const v = value[key] as string | number | boolean | null;
    if (typeof v === "number" ? !Number.isFinite(v) : !(v === null || typeof v === "string" || typeof v === "boolean")) {
      throw new AppDefinitionError(`設定「${key}」的值只能是文字、數字、true／false 或空值。`);
    }
    if (typeof v === "string" && (v.length > 500 || /\p{Cc}/u.test(v))) throw new AppDefinitionError(`設定「${key}」的文字最多 500 字，不可含控制字元。`);
    out[key] = v;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > CONFIG_MAX_BYTES) throw new AppDefinitionError("公開設定總量過大（上限 8 KB）。");
  return Object.freeze(out);
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
  scopes?: string[];
  min_version?: string;
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
  const ios = (form.ios_bundle_id ?? "").trim() || (options.defaults ? `com.hglobal1985.${compact}` : null);
  const android = (form.android_package ?? "").trim() || (options.defaults ? `com.hglobal1985.${compact}` : null);
  const webOrigins = clean(form.web_origins);
  if (!webOrigins.length && options.defaults) webOrigins.push(`https://${appId}.hglobal1985.com`);
  const returnUrls = clean(form.return_urls);
  if (!returnUrls.length && options.defaults) returnUrls.push(`${(form.scheme ?? "").trim() || compact}://auth/google`);
  return parseApp({
    app_id: appId,
    name: form.name ?? "",
    ios_bundle_id: ios,
    android_package: android,
    // Status and remote settings are not part of the form: editing never un-pauses an App or drops its settings.
    status: options.keep?.status ?? "active",
    scopes: form.scopes ?? options.keep?.scopes ?? DEFAULT_APP_SCOPES,
    min_version: (form.min_version ?? "").trim() || options.keep?.min_version || "0.0.0",
    config: options.keep?.config ?? {},
    auth: { google_audiences: clean(form.extra_google_audiences) },
    web_origins: webOrigins,
    return_urls: returnUrls,
  });
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
