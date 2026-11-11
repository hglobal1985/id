// Social link rules (framework-free).
export const MAX_LINKS = 30;
export const URL_MAX = 300;
export const LABEL_MAX = 30;
/** Largest image a member may upload for a custom link / the super admin for a platform (already shrunk by the page). */
export const LINK_ICON_MAX_BYTES = 16 * 1024;
export const PLATFORM_ICON_MAX_BYTES = 32 * 1024;

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string };

/**
 * A web address the member typed. A missing scheme is added (https://); a typed http:// or https:// is kept as typed.
 * Other schemes (javascript:, data:, mailto: ...) are refused. The host must be real and no credentials are allowed.
 */
export function validateSocialUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string") return { ok: false, message: "請貼上網址" };
  let v = raw.normalize("NFC").trim();
  if (!v || v.length > URL_MAX) return { ok: false, message: `網址不可空白，最多 ${URL_MAX} 字` };
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001F\u007F\s]/.test(v)) return { ok: false, message: "網址不可含空白或控制字元" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    if (!/^https?:\/\//i.test(v)) return { ok: false, message: "只能是 http:// 或 https:// 開頭的網址" };
  } else if (/^(javascript|data|vbscript|mailto|tel|file|blob|about):/i.test(v)) {
    return { ok: false, message: "只能是網址（http:// 或 https://）" };
  } else {
    v = `https://${v.replace(/^\/\//, "")}`;
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, message: "網址格式不正確" };
  }
  if (u.username || u.password || !u.hostname.includes(".")) return { ok: false, message: "網址格式不正確" };
  // A typed http:// stays http://; URL() only normalizes the rest (host case, a bare path "/").
  return { ok: true, url: u.toString() };
}

export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.normalize("NFC").trim();
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (!t || [...t].length > LABEL_MAX || /[\u0000-\u001F\u007F]/.test(t)) return null;
  return t;
}

/** A stable key for a new platform from its name (latin letters and digits), e.g. "Mastodon" → "mastodon". */
export function platformKeyOf(name: string, taken: (key: string) => boolean): string {
  const base = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "platform";
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}${i}`)) return `${base}${i}`;
  return `${base}${Date.now()}`;
}

/** Icons per row on the card: 5 up to two rows, 7 (smaller icons) when more than two rows would be needed. */
export function iconsPerRow(total: number): 5 | 7 {
  return total > 10 ? 7 : 5;
}
