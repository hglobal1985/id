// Shared page shell for the member site. All dynamic text is escaped; scripts and styles are same-origin files.
import { escapeHtml } from "./pages";

export const SITE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export function sitePage(opts: { title: string; body: string; script?: string; nav?: { signedIn: boolean; staff?: boolean } }): string {
  const nav = opts.nav
    ? `<nav class="nav">${
        opts.nav.signedIn
          ? `<a href="/me">基本資料</a>${opts.nav.staff ? '<a href="/admin">後台</a>' : ""}<a href="/logout">登出</a>`
          : '<a href="/login">登入</a>'
      }</nav>`
    : "";
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)} · H-Global1985</title>
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<header class="top"><a class="brand" href="/">H-Global1985</a>${nav}</header>
<main class="wrap">${opts.body}</main>
<footer class="foot"><a href="/privacy">隱私權政策</a> · <a href="/privacy/amway">完整隱私說明</a></footer>
${opts.script ? `<script src="${escapeHtml(opts.script)}" defer></script>` : ""}
</body>
</html>`;
}
