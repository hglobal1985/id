// Minimal server-rendered pages for sign-in. Member-facing text uses only the H-Global1985 brand
// and never names the partner system. Full UI comes in a later PR.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · H-Global1985</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--muted:#5d6675;--accent:#1a56db;--line:#dfe3ea}
@media (prefers-color-scheme:dark){:root{--bg:#11141a;--card:#1a1f27;--fg:#e8ebf0;--muted:#a0a8b6;--accent:#6b9cff;--line:#2c333e}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 24px;text-align:center}
.brand{font-weight:700;letter-spacing:.02em;color:var(--muted);font-size:14px;margin:0 0 8px}
h1{font-size:22px;margin:0 0 16px}p{color:var(--muted);margin:0 0 24px}
a.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px 16px;border-radius:10px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600;background:var(--card)}
a.btn:hover{border-color:var(--accent)}
</style>
</head>
<body><main><p class="brand">H-Global1985</p>${body}</main></body>
</html>`;
}

export function loginPage(startHref: string): string {
  return layout(
    "登入",
    `<h1>登入會員</h1><p>請使用 Google 帳號登入。</p><a class="btn" href="${escapeHtml(startHref)}">使用 Google 帳號登入</a>`,
  );
}

export function messagePage(title: string, message: string, link?: { href: string; label: string }): string {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${link ? `<a class="btn" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>` : ""}`,
  );
}
