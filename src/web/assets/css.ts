// Shared stylesheet of the member site and the back office. Same night-sky template as the starry.phd member
// center: sticky round-pill main menu, translucent cards, collapsible sections, App launcher, back-office top bar.
// No inline styles are used anywhere (the CSP only allows same-origin styles), so sizes and colours are classes.
export const SITE_CSS = String.raw`
:root{color-scheme:dark;--bg:#07061a;--fg:#ecebff;--muted:#a8a5d0;--line:rgba(167,139,250,.28);--accent:#a78bfa;--danger:#ff8a80;--card:rgba(24,20,56,.72);--ok:#4cc38a;--warn:#f0b35a;--bad:#ff8a80}
*{box-sizing:border-box}
html{background:#07061a}
body{margin:0;min-height:100vh;color:var(--fg);font:16px/1.6 system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;background-color:#07061a;background-image:radial-gradient(1.2px 1.2px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 38% 62%,#cfc6ff,transparent),radial-gradient(1.4px 1.4px at 71% 24%,#fff,transparent),radial-gradient(1px 1px at 86% 78%,#fff,transparent),radial-gradient(1px 1px at 55% 90%,#b9a9ff,transparent),radial-gradient(900px 500px at 85% -10%,rgba(124,92,255,.28),transparent),radial-gradient(700px 500px at -10% 40%,rgba(56,189,248,.14),transparent);background-size:260px 260px,310px 310px,420px 420px,380px 380px,340px 340px,auto,auto;background-attachment:fixed}
a{color:var(--accent)}
h1{font-size:1.5rem;margin:0 0 16px}h2{font-size:1.15rem;margin:0 0 12px}h3{font-size:1rem;margin:16px 0 6px}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 32px}
.foot{max-width:760px;margin:0 auto;padding:8px 16px 48px;color:var(--muted);font-size:14px}
.foot a{margin-right:16px}
/* main menu */
.starnav{position:sticky;top:0;z-index:30;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 6px;padding:8px 10px;background:rgba(9,7,30,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.starnav a{color:var(--fg);text-decoration:none;padding:6px 12px;border-radius:999px;display:inline-flex;align-items:center;gap:8px;flex:0 0 auto}
.starnav a:hover{background:rgba(167,139,250,.2)}
.starnav a.on{background:var(--accent);color:#0b0720;font-weight:700;box-shadow:0 0 0 2px rgba(167,139,250,.45)}
.starnav .me{font-weight:600}
.starnav .launcher{margin-left:0}
@media (min-width:700px){.starnav{padding:10px 24px}}
.guest-brand{display:block;text-align:center;padding:14px;font-weight:700;color:var(--fg);text-decoration:none}
.launcher{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;color:var(--fg);text-decoration:none}
.launcher:hover{background:rgba(127,127,160,.2)}
.launcher.on{background:var(--accent);color:#0b0720}
/* cards and text */
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 16px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 6px 30px rgba(10,6,40,.45)}
.banner{border-left:4px solid var(--accent);padding:12px 16px;background:var(--card);border-radius:8px;margin:12px 0}
.banner.danger{border-color:var(--danger)}
.row{display:grid;grid-template-columns:1fr;gap:6px;padding:10px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}
.row label,label{font-weight:600}
.help{color:var(--muted);font-size:14px}
.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}
.chips{display:flex;flex-wrap:wrap;gap:6px 8px;margin:8px 0}
.mono{font-family:ui-monospace,Menlo,monospace;word-break:break-all}
ul.plain{padding-left:20px;margin:8px 0}
.msg{font-size:14px;min-height:1.2em}.msg.ok{color:var(--ok)}.msg.bad{color:var(--bad)}
input[type=text],input[type=email],input[type=url],input[type=tel],input[type=date],input[type=search],select,textarea{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:rgba(9,7,30,.7);color:var(--fg);font:inherit}
textarea{min-height:96px}
/* buttons: plain = outlined, primary = filled, danger = red */
button,.button{display:inline-block;font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer;text-decoration:none}
button:hover,.button:hover{border-color:var(--accent)}
button.primary,.button.primary{background:linear-gradient(135deg,#7c5cff,#a78bfa);border-color:transparent;color:#0b0720;font-weight:600}
button.danger,.button.danger{color:var(--danger);border-color:var(--danger)}
/* badges */
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.82rem;border:1px solid var(--line);background:rgba(9,7,30,.5)}
.badge.pending,.badge.warn{color:var(--warn);border-color:var(--warn)}.badge.approved,.badge.ok{color:var(--ok);border-color:var(--ok)}.badge.rejected,.badge.bad{color:var(--bad);border-color:var(--bad)}
/* avatar bubble: photo or two initials; sizes are classes (no inline styles) */
.avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,#5b3fd6,#38bdf8);color:#fff;font-weight:700;flex:0 0 auto;width:96px;height:96px;font-size:38px;overflow:hidden}
.avatar.sm{width:32px;height:32px;font-size:13px}.avatar.md{width:64px;height:64px;font-size:25px}.avatar.lg{width:72px;height:72px;font-size:29px}
.hero{display:flex;align-items:center;gap:16px;margin:8px 0 16px}.hero h1{margin:0}
/* tabs and collapsible sections */
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px}
.tabs a,.tabs button{padding:6px 12px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--fg)}
.tabs .on{background:var(--accent);color:#0b0720;border-color:var(--accent)}
details.fold>summary{cursor:pointer;list-style:none;font-weight:700;padding:4px 0}
details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary::after{content:"＋";float:right;color:var(--accent)}
details.fold[open]>summary::after{content:"－"}
details summary{cursor:pointer;color:var(--muted)}
details.fold>summary{color:var(--fg)}
/* stat boxes */
.statrow,.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0}
.statbox,.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;text-align:center}
.statbox b,.stat b{display:block;font-size:1.6rem;line-height:1.3}.statbox span,.stat span{color:var(--muted);font-size:.9rem}
.stat.warn{border-color:var(--warn)}.stat.bad{border-color:var(--bad)}
/* traffic lights on the back-office home */
.lights{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:12px 0}
.light{display:flex;gap:10px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.light i{flex:none;width:14px;height:14px;border-radius:50%;margin-top:6px;background:var(--ok)}
.light.yellow i{background:var(--warn)}.light.red i{background:var(--bad)}
.light b{display:block}.light span{color:var(--muted);font-size:.9rem}
/* tables */
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:8px 6px;border-top:1px solid var(--line);vertical-align:top;word-break:break-word}
.tablewrap{overflow-x:auto}
/* App launcher page */
.lc-list{display:flex;flex-direction:column;gap:2px;padding:8px}
.lc-row{display:flex;flex-direction:column;gap:4px;padding:8px 6px;border-radius:12px}
.lc-row:hover{background:rgba(127,127,160,.15)}
.lc-main{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none;min-width:0}
.lc-main.off{opacity:.5}
.lc-ico{width:52px;height:52px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.2rem}
.lc-ico.c0{background:#7c5cff}.lc-ico.c1{background:#2f9e8f}.lc-ico.c2{background:#e0773c}.lc-ico.c3{background:#d6457a}.lc-ico.c4{background:#3b82c4}.lc-ico.c5{background:#8a9a2b}.lc-ico.c6{background:#a35bd1}.lc-ico.c7{background:#c4912f}
.lc-text{display:flex;flex-direction:column;min-width:0}
.lc-name{font-weight:600;line-height:1.25}
.lc-sum{font-size:.78rem;color:var(--muted);line-height:1.3}
.lc-links{display:flex;flex-wrap:wrap;gap:6px;margin-left:62px}
.lc-chip{font-size:.75rem;padding:3px 10px;border:1px solid var(--line);border-radius:999px;color:var(--accent);text-decoration:none;white-space:nowrap}
.lc-note{font-size:.75rem;color:var(--muted)}
/* back office: full-width layout with a top bar and a "more" drop-down */
body.admin .wrap{max-width:none;margin:0;padding:20px clamp(12px,3vw,40px) 32px}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;padding:10px clamp(12px,3vw,40px);background:rgba(9,7,30,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.topbar .brand{font-weight:700;color:var(--fg);text-decoration:none;margin-right:auto;font-size:1.05rem}
.topbar .menu-toggle{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none}
.topbar .burger{display:none;cursor:pointer;font-size:1.6rem;line-height:1;padding:4px 10px;border:1px solid var(--line);border-radius:8px;user-select:none}
.topbar .menu{display:flex;align-items:center;gap:4px 8px;flex-wrap:wrap}
.topbar .menu a,.topbar .menu button,.topbar .menu summary{color:var(--fg);text-decoration:none;padding:8px 12px;border-radius:8px;cursor:pointer;list-style:none;white-space:nowrap;border:0;background:transparent;font:inherit}
.topbar .menu summary::-webkit-details-marker{display:none}
.topbar .menu a:hover,.topbar .menu button:hover,.topbar .menu summary:hover{background:rgba(167,139,250,.2)}
.topbar .menu .on{background:var(--accent);color:#0b0720}
.topbar details.more{position:relative}
.topbar details.more .drop{position:absolute;right:0;top:calc(100% + 6px);min-width:200px;background:#120f2e;border:1px solid var(--line);border-radius:12px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;flex-direction:column}
.topbar details.more .drop a,.topbar details.more .drop button{display:block;text-align:left}
@media (max-width:900px){
.topbar .burger{display:block}
.topbar .menu{display:none;width:100%;flex-direction:column;align-items:stretch;gap:2px}
.topbar .menu-toggle:checked ~ .menu{display:flex}
.topbar details.more .drop{position:static;box-shadow:none;border:0;padding:0 0 0 12px;min-width:0;background:transparent}
.topbar .menu a,.topbar .menu button,.topbar .menu summary{padding:12px;text-align:left}
}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:16px;align-items:start}
.grid>.card{margin:0}
@media (max-width:720px){body.admin table{display:block;overflow-x:auto}}
`;
