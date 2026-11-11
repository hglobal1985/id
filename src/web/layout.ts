// Shared page shell for the member site and the back office (same template as the starry.phd member center).
// All dynamic text is escaped; scripts and styles are same-origin files.
import { escapeHtml } from "./pages";
import { clipName, type RankBadge } from "./nav-text";

export const SITE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data: blob:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const APPS_PATH = "/apps";
export const NOTIFICATIONS_PATH = "/notifications";

export interface NavUser {
  name: string;
  initials: string;
  avatar_url: string | null;
  /** The reviewed rank (already shortened for the menu), shown in a small box beside the name. */
  rank?: RankBadge | null;
}

export interface SiteNav {
  signedIn: boolean;
  staff?: boolean;
  user?: NavUser | null;
  /** Current path, to highlight the active menu item. */
  path?: string;
  /** Unread in-site notifications (the bell). */
  unread?: number;
}

const DOTS = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">${[4, 12, 20]
  .flatMap((y) => [4, 12, 20].map((x) => `<circle cx="${x}" cy="${y}" r="2" fill="currentColor"/>`))
  .join("")}</svg>`;

/** The 9-dot button: a plain link to the Apps page. */
export function appLauncher(on = false): string {
  return `<a class="launcher${on ? " on" : ""}"${on ? ' aria-current="page"' : ""} href="${APPS_PATH}" aria-label="Apps" title="Apps">${DOTS}</a>`;
}

const BELL = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 21h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

/** The bell: a plain link to the notifications page, with the number of unread ones. */
export function bellLink(unread: number, on = false): string {
  const label = unread > 0 ? `站內通知（${unread} 則未讀）` : "站內通知";
  return `<a class="bell${on ? " on" : ""}"${on ? ' aria-current="page"' : ""} href="${NOTIFICATIONS_PATH}" aria-label="${label}" title="${label}">${BELL}${unread > 0 ? `<span class="dot">${unread > 99 ? "99+" : unread}</span>` : ""}</a>`;
}

/** The round picture: the member's photo, or two initials. `size` is a class (sm, md, lg or empty), never an inline style. */
export function avatarBubble(user: { initials: string; avatar_url: string | null }, size: "sm" | "md" | "lg" | "" = "sm", label = ""): string {
  const cls = `avatar${size ? ` ${size}` : ""}`;
  return user.avatar_url
    ? `<img class="${cls}" src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(label)}">`
    : `<span class="${cls}" role="img" aria-label="${escapeHtml(label)}">${escapeHtml(user.initials)}</span>`;
}

function memberNav(nav: SiteNav): string {
  if (!nav.signedIn) return `<a class="guest-brand" href="/">會員中心</a>`;
  const path = nav.path ?? "";
  const on = (href: string) => (path === href || path.startsWith(`${href}/`) ? ' class="on" aria-current="page"' : "");
  const u = nav.user ?? { name: "我", initials: "H", avatar_url: null };
  return `<nav class="starnav" aria-label="主選單">
  <a class="me${path === "/me" ? " on" : ""}" href="/me" title="${escapeHtml(u.name)}">${avatarBubble(u, "sm", u.name)}<span class="nm">${escapeHtml(clipName(u.name, 4))}</span>${u.rank ? `<span class="rank rk${u.rank.size}" title="${escapeHtml(u.rank.text)}">${escapeHtml(u.rank.text)}</span>` : ""}</a>
  ${nav.staff ? `<a href="/admin"${on("/admin")}>後台</a>` : ""}
  ${bellLink(nav.unread ?? 0, path === NOTIFICATIONS_PATH)}
  ${appLauncher(path === APPS_PATH)}
</nav>`;
}

function adminBar(nav: SiteNav): string {
  return `<header class="topbar">
  <a class="brand" href="/admin">後台</a>
  ${appLauncher()}
  <input type="checkbox" id="menu-toggle" class="menu-toggle" aria-label="開關選單">
  <label for="menu-toggle" class="burger" aria-hidden="true">☰</label>
  <div class="menu" id="menu">${nav.signedIn ? "" : '<a href="/login">登入</a>'}</div>
</header>`;
}

export function sitePage(opts: { title: string; body: string; script?: string | string[]; nav?: SiteNav; admin?: boolean }): string {
  const nav: SiteNav = opts.nav ?? { signedIn: false };
  const header = opts.admin ? adminBar(nav) : memberNav(nav);
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>會員中心</title>
<link rel="stylesheet" href="/assets/site.css">
</head>
<body${opts.admin ? ' class="admin"' : ""}>
${header}
<main class="wrap">${opts.body}</main>
<footer class="foot"><a href="/privacy">隱私權政策</a><a href="/privacy/amway">完整隱私說明</a></footer>
${[opts.script ?? []].flat().map((src) => `<script src="${escapeHtml(src)}" defer></script>`).join("\n")}
</body>
</html>`;
}
