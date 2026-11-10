export const SITE_CSS = String.raw`
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--muted:#5d6675;--accent:#1a56db;--line:#dfe3ea;--ok:#0f7b3f;--warn:#a15c00;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#11141a;--card:#1a1f27;--fg:#e8ebf0;--muted:#a0a8b6;--accent:#6b9cff;--line:#2c333e;--ok:#4cc38a;--warn:#f0b35a;--bad:#ff8a80}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif}
a{color:var(--accent)}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card)}
.brand{font-weight:700;text-decoration:none;color:var(--fg)}
.nav{display:flex;gap:16px;flex-wrap:wrap}
.wrap{max-width:760px;margin:0 auto;padding:16px}
.foot{max-width:760px;margin:0 auto;padding:24px 16px;color:var(--muted);font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 16px}
.card h2{font-size:18px;margin:0 0 12px}
.row{display:grid;grid-template-columns:1fr;gap:6px;padding:10px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}
.row label{font-weight:600}
.help{color:var(--muted);font-size:14px}
.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input[type=text],input[type=email],input[type=url],input[type=tel],input[type=date],select,textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
textarea{min-height:96px}
button{padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.danger{color:var(--bad)}
.badge{display:inline-block;font-size:13px;padding:1px 8px;border-radius:999px;border:1px solid var(--line)}
.badge.pending{color:var(--warn)}.badge.approved{color:var(--ok)}.badge.rejected{color:var(--bad)}
.msg{font-size:14px;min-height:1.2em}.msg.ok{color:var(--ok)}.msg.bad{color:var(--bad)}
.avatar{width:96px;height:96px;border-radius:50%;object-fit:cover;background:var(--line);display:block}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
.tabs a,.tabs button{padding:6px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none}
.tabs .on{background:var(--accent);color:#fff;border-color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px;border-top:1px solid var(--line);vertical-align:top}
details summary{cursor:pointer;color:var(--muted)}
.mono{font-family:ui-monospace,Menlo,monospace;word-break:break-all}
ul.plain{padding-left:20px;margin:8px 0}
`;
