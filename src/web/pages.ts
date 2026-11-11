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
<title>會員中心</title>
<style>
:root{color-scheme:dark;--bg:#07061a;--card:rgba(24,20,56,.72);--fg:#ecebff;--muted:#a8a5d0;--accent:#a78bfa;--line:rgba(167,139,250,.28)}
*{box-sizing:border-box}html{background:#07061a}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;color:var(--fg);font:16px/1.6 system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;background-color:#07061a;background-image:radial-gradient(1.2px 1.2px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 38% 62%,#cfc6ff,transparent),radial-gradient(1.4px 1.4px at 71% 24%,#fff,transparent),radial-gradient(1px 1px at 86% 78%,#fff,transparent),radial-gradient(900px 500px at 85% -10%,rgba(124,92,255,.28),transparent),radial-gradient(700px 500px at -10% 40%,rgba(56,189,248,.14),transparent);background-attachment:fixed}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px 24px;text-align:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 6px 30px rgba(10,6,40,.45)}
.brand{font-weight:700;letter-spacing:.02em;color:var(--fg);font-size:16px;margin:0 0 8px}
h1{font-size:22px;margin:0 0 16px}p{color:var(--muted);margin:0 0 24px}
.foot{width:100%;max-width:400px;display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--muted)}.foot a{color:var(--muted)}
a.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px 16px;border-radius:10px;border:0;color:#0b0720;text-decoration:none;font-weight:600;background:linear-gradient(135deg,#7c5cff,#a78bfa)}
a.btn:hover{filter:brightness(1.08)}
</style>
</head>
<body><main><p class="brand">會員中心</p>${body}</main><footer class="foot"><a href="/privacy">隱私權政策</a><span>網站設計 杜杜龍</span></footer></body>
</html>`;
}

export function messagePage(title: string, message: string, link?: { href: string; label: string }): string {
  return layout(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${link ? `<a class="btn" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>` : ""}`,
  );
}
