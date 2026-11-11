// Shared stylesheet of the member site and the back office. Light, mobile-first, colours taken from the
// H-Global1985 logo (deep green, olive, orange, yellow, salmon, warm white). No inline styles are used anywhere
// (the CSP only allows same-origin styles), so sizes and colours are classes. Controls are never native
// dropdowns or checkboxes: .dd (dropdown), .chk (checkbox), .sg (suggestions), .tg (multi-item input).
export const SITE_CSS = String.raw`
:root{color-scheme:light;--bg:#f8f6ef;--card:#fff;--fg:#1d2a22;--muted:#5d6b62;--line:#e2dfd2;--green:#0c603c;--green-d:#094a2e;--green-soft:#e7f1ea;--olive:#486c48;--orange:#cc6c0c;--orange-soft:#fdf0e3;--yellow:#f2dc27;--salmon:#f0a884;--danger:#b3261e;--danger-soft:#fbeae8;--ok:#1b7a43;--warn:#a86408;--shadow:0 1px 3px rgba(29,42,34,.08),0 4px 14px rgba(29,42,34,.05);--grad:linear-gradient(90deg,#cc6c0c,#f2dc27 55%,#f0a884)}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif}
a{color:var(--green)}
h1{font-size:1.4rem;line-height:1.3;margin:0 0 12px}h2{font-size:1.1rem;line-height:1.35;margin:0 0 10px}h3{font-size:1rem;margin:14px 0 6px}
p{margin:0 0 10px}
.wrap{max-width:680px;margin:0 auto;padding:16px 14px 28px}
.foot{max-width:680px;margin:0 auto;padding:4px 14px 40px;color:var(--muted);font-size:14px;display:flex;align-items:center;gap:16px}
.foot a{color:var(--muted)}
.foot .credit{margin-left:auto;text-align:right}
hr.part{border:0;border-top:2px solid var(--line);margin:28px 0 20px}
/* main menu */
.starnav{position:sticky;top:0;z-index:30;display:flex;flex-wrap:nowrap;align-items:center;justify-content:flex-start;gap:2px;padding:4px 6px;background:#fff;border-top:4px solid transparent;border-image:var(--grad) 1;border-bottom:1px solid var(--line)}
.starnav a{position:relative;color:var(--fg);text-decoration:none;padding:6px 10px;min-height:40px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;white-space:nowrap}
.starnav a:hover{background:var(--green-soft)}
.starnav a.on{background:var(--green);color:#fff;font-weight:700}
.starnav .me{font-weight:600;margin-right:auto}
.starnav .me .nm{overflow:hidden;text-overflow:ellipsis}
/* rank box beside the name: fixed width of 5 Chinese characters, smaller than the name, text shrinks to fit */
.rank{display:inline-flex;align-items:center;justify-content:center;flex:none;width:3.9rem;height:1.45rem;padding:0 2px;border-radius:7px;border:1px solid #e6c48c;background:var(--orange-soft);color:var(--orange);font-weight:700;line-height:1;overflow:hidden;white-space:nowrap}
.rank.rk0{font-size:.72rem}.rank.rk1{font-size:.6rem}.rank.rk2{font-size:.48rem}.rank.rk3{font-size:.4rem}
.starnav a.on .rank{background:#fff}
.guest-brand{display:block;text-align:center;padding:14px;font-weight:700;color:var(--green);text-decoration:none;background:#fff;border-bottom:1px solid var(--line);border-top:4px solid transparent;border-image:var(--grad) 1}
.launcher,.bell{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;color:var(--fg);text-decoration:none}
.starnav .launcher,.starnav .bell{padding:0;flex:none}
.launcher:hover,.bell:hover{background:var(--green-soft)}
.launcher.on,.bell.on{background:var(--green);color:#fff}
.bell .dot{position:absolute;top:2px;right:0;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--orange);color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center}
/* cards and text */
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin:0 0 14px;box-shadow:var(--shadow)}
.card>h2.life-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:1.1rem}
.card>h2.lt-0{font-size:1.1rem}.card>h2.lt-1{font-size:.95rem}.card>h2.lt-2{font-size:.82rem}.card>h2.lt-3{font-size:.7rem}.card>h2.lt-4{font-size:.6rem}
.card>h2:first-child{padding-bottom:8px;border-bottom:2px solid var(--green-soft)}
.banner{border-left:4px solid var(--orange);padding:10px 14px;background:var(--orange-soft);border-radius:8px;margin:0 0 12px}
.banner.danger{border-color:var(--danger);background:var(--danger-soft)}
.row{padding:12px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}
.row-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 8px;margin-bottom:6px}
.row-head label,.row-head strong,label{font-weight:700}
.row-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:auto}
.value{margin:0;word-break:break-word;min-height:1.65em}
.value.empty{color:var(--muted)}
.help{color:var(--muted);font-size:14px}
.note{display:inline-block;margin-left:8px;padding:1px 10px;border-radius:999px;background:var(--orange-soft);color:var(--orange);font-size:13px;font-weight:600}
.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:6px 8px;margin:6px 0}
.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:999px;background:var(--green-soft);color:var(--green-d);font-size:.95rem}
.mono{font-family:ui-monospace,Menlo,monospace;word-break:break-all}
ul.plain{padding-left:20px;margin:8px 0}
.msg{font-size:14px;min-height:1.2em}.msg.ok{color:var(--ok)}.msg.bad{color:var(--danger)}
/* inputs */
input[type=text],input[type=email],input[type=url],input[type=tel],input[type=date],input[type=search],textarea{width:100%;min-height:44px;padding:9px 12px;border:1.5px solid var(--line);border-radius:10px;background:#fff;color:var(--fg);font:inherit}
input:focus,textarea:focus,button:focus-visible,a:focus-visible,.dd-btn:focus-visible{outline:3px solid rgba(12,96,60,.28);outline-offset:1px;border-color:var(--green)}
textarea{min-height:110px;resize:vertical}
select{min-height:40px;padding:6px 10px;border:1.5px solid var(--line);border-radius:10px;background:#fff;color:var(--fg);font:inherit}
/* buttons: plain = outlined, primary = filled green, danger = red */
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;font:inherit;padding:6px 14px;border-radius:10px;border:1.5px solid var(--line);background:#fff;color:var(--fg);cursor:pointer;text-decoration:none}
button:hover,.button:hover{border-color:var(--green);color:var(--green)}
button.primary,.button.primary{background:var(--green);border-color:var(--green);color:#fff;font-weight:600}
button.primary:hover,.button.primary:hover{background:var(--green-d);color:#fff}
button.danger,.button.danger{color:var(--danger);border-color:#e8b4af}
button.danger:hover{background:var(--danger-soft);border-color:var(--danger);color:var(--danger)}
button.small{min-height:34px;padding:3px 10px;font-size:.92rem}
button[disabled]{opacity:.5;cursor:default}
.ico{width:1.15em;height:1.15em;flex:none}
/* visibility switch (eye) */
.eye{min-height:34px;padding:3px 10px;font-size:.92rem;border-radius:999px}
.eye.pub{background:var(--green-soft);border-color:#bcd8c6;color:var(--green-d)}
.eye.priv{color:var(--muted)}
.eye.locked{cursor:default;display:inline-flex;align-items:center;gap:6px;border:1.5px solid #bcd8c6;padding:3px 10px;border-radius:999px}
.fixed{color:var(--muted);font-size:.9rem}
/* custom checkbox: as big as the text, never the native control */
.chk{display:inline-flex;align-items:center;gap:.5em;min-height:44px;padding:0;border:0;background:transparent;font:inherit;font-weight:600;color:var(--fg);text-align:left;cursor:pointer}
.chk:hover{color:var(--green)}
.chk .box{position:relative;flex:none;width:1.15em;height:1.15em;border:2px solid #9aa89f;border-radius:.28em;background:#fff}
.chk[aria-checked="true"] .box{background:var(--green);border-color:var(--green)}
.chk[aria-checked="true"] .box::after{content:"";position:absolute;left:.3em;top:.04em;width:.3em;height:.62em;border:solid #fff;border-width:0 .16em .16em 0;transform:rotate(45deg)}
/* custom dropdown (never a native select) */
.dd{position:relative;display:inline-block;min-width:140px;max-width:100%}
.dd.block{display:block}
.dd-btn{width:100%;justify-content:space-between;text-align:left;border:1.5px solid var(--line);border-radius:10px;min-height:44px}
.dd-btn::after{content:"▾";color:var(--muted);margin-left:8px}
.dd-list,.sg-list{position:absolute;z-index:40;left:0;right:0;top:calc(100% + 4px);max-height:260px;overflow:auto;background:#fff;border:1.5px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:4px}
.dd-list[hidden],.sg-list[hidden]{display:none}
.dd-list button,.sg-list button{display:flex;width:100%;justify-content:flex-start;border:0;border-radius:8px;min-height:40px;text-align:left}
.dd-list button:hover,.sg-list button:hover,.dd-list button.cur,.sg-list button.cur{background:var(--green-soft);color:var(--green-d)}
.dd-list button[aria-selected="true"]{font-weight:700}
.dd-list .dd-search{margin:2px 2px 6px;width:calc(100% - 4px)}
.sg{position:relative}
/* multi-item input */
.tg{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border:1.5px solid var(--line);border-radius:10px;background:#fff;min-height:44px}
.tg:focus-within{border-color:var(--green);outline:3px solid rgba(12,96,60,.28)}
.tg input{flex:1 1 120px;min-width:100px;min-height:30px;border:0;padding:2px 4px;outline:0}
.tg input:focus{outline:0}
.tg .chip button{min-height:22px;padding:0 4px;border:0;background:transparent;color:var(--green-d);font-size:1rem;line-height:1}
/* badges */
.badge{display:inline-block;padding:1px 10px;border-radius:999px;font-size:.84rem;border:1px solid var(--line);background:#fff}
.badge.pending,.badge.warn{color:var(--warn);border-color:#e6c48c;background:var(--orange-soft)}.badge.approved,.badge.ok{color:var(--ok);border-color:#b7dcc5;background:var(--green-soft)}.badge.rejected,.badge.bad{color:var(--danger);border-color:#e8b4af;background:var(--danger-soft)}
.badge.num{font-weight:700;color:var(--green-d);background:var(--green-soft);border-color:#bcd8c6;letter-spacing:.03em}
/* avatar bubble: photo or two initials; sizes are classes (no inline styles) */
.avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,#0c603c,#486c48);color:#fff;font-weight:700;flex:0 0 auto;width:96px;height:96px;font-size:38px;overflow:hidden}
.avatar.sm{width:32px;height:32px;font-size:13px}.avatar.md{width:64px;height:64px;font-size:25px}.avatar.lg{width:80px;height:80px;font-size:32px}
.hero{display:flex;align-items:center;gap:14px;margin:4px 0 14px}
.hero-main{min-width:0;flex:1}
.nameline{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0}.nameline h1{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;min-width:0}
.nm-0{font-size:1.4rem}.nm-1{font-size:1.15rem}.nm-2{font-size:.95rem}.nm-3{font-size:.8rem}
.hero .sub{flex-wrap:nowrap;white-space:nowrap;min-width:0}.hero .sub .badge{overflow:hidden;text-overflow:ellipsis}
.badges{display:inline-flex;flex-wrap:wrap;gap:4px;max-width:100%}
/* beside the picture the boxes fit their text and every box uses the same font size (no shrinking) */
.hero .rank:is(.rk0,.rk1,.rk2,.rk3){width:auto;max-width:100%;height:auto;min-height:1.5rem;padding:2px 9px;font-size:.78rem;text-overflow:ellipsis}
/* picture cropper */
.crop-back{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.crop-box{background:var(--card,#fff);border-radius:16px;padding:16px;max-width:340px;width:100%;box-shadow:var(--shadow)}
.crop-box h2{margin:0 0 8px;font-size:1.05rem}
.crop-cv{display:block;width:100%;aspect-ratio:1;border-radius:12px;touch-action:none;cursor:grab;background:#222}
.crop-zoom{width:100%;margin:12px 0 4px}
.crop-box .actions{margin-top:10px}
.rank.k-system{background:var(--green-soft);color:var(--green-d);border-color:#bcd8c6}.rank.k-center{background:#f4f1dc;color:#6b5b12;border-color:#ddd4a0}.hero h1{margin:0 0 4px;word-break:break-word}.hero .sub{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pagebar{display:flex;align-items:stretch;gap:8px;margin:0 0 10px}
.pagebar>.button,.pagebar>button{flex:1 1 0;min-width:0;min-height:40px;padding:6px 6px;font-size:.95rem;white-space:nowrap}
.pagebar>.wide{flex:1.5 1 0}
.motto{margin:0 0 12px;color:var(--olive);font-style:italic}
/* tabs and collapsible sections */
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
.tabs a,.tabs button{padding:6px 14px;border:1.5px solid var(--line);border-radius:999px;text-decoration:none;color:var(--fg);background:#fff}
.tabs .on{background:var(--green);color:#fff;border-color:var(--green)}
details.fold>summary{cursor:pointer;list-style:none;font-weight:700;padding:6px 0;min-height:36px}
details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary::after{content:"＋";float:right;color:var(--orange)}
details.fold[open]>summary::after{content:"－"}
details summary{cursor:pointer;color:var(--muted)}
details.fold>summary{color:var(--fg)}
/* stat boxes and traffic lights (back office) */
.statrow,.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0}
.statbox,.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;text-align:center;box-shadow:var(--shadow)}
.statbox b,.stat b{display:block;font-size:1.6rem;line-height:1.3;color:var(--green-d)}.statbox span,.stat span{color:var(--muted);font-size:.9rem}
.stat.warn{border-color:var(--orange)}.stat.bad{border-color:var(--danger)}
.lights{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin:12px 0}
.light{display:flex;gap:10px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.light i{flex:none;width:14px;height:14px;border-radius:50%;margin-top:6px;background:var(--ok)}
.light.yellow i{background:var(--yellow)}.light.red i{background:var(--danger)}
.light b{display:block}.light span{color:var(--muted);font-size:.9rem}
/* tables */
table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:8px 6px;border-top:1px solid var(--line);vertical-align:top;word-break:break-word}
.tablewrap{overflow-x:auto}
.dots{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.72rem;line-height:1.3}
.dots th,.dots td{border:1px solid var(--line);padding:5px 2px;text-align:center;word-break:break-all}
.dots th:first-child,.dots td:first-child{text-align:left;width:34%;padding:5px 6px;word-break:normal}
.dots th.me{background:var(--green-soft);color:var(--green-d)}
.dots td.y{color:var(--green);font-size:1rem}.dots td:not(.y):not(:first-child){color:#b9c2bc}
.dateparts{display:flex;gap:8px}.dateparts .dd{flex:1 1 0;min-width:0}.dateparts .dd-btn{padding:6px 10px}
.filters{display:grid;gap:8px;margin:8px 0}
.filters select{width:100%;min-height:44px}
.member-row .linklike{border:0;background:transparent;padding:0;min-height:0;color:var(--green);font-weight:700;text-align:left;text-decoration:underline}
/* life number chart (same drawing data as the starry.phd member center) */
.ln-card{max-width:440px;margin-inline:auto;background:#f6f8f4;color:#0f172a;border:1px solid var(--line);border-radius:18px;padding:12px 14px}
.ln-head{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;padding-bottom:10px;border-bottom:2px solid #e3e8df}
.ln-item{display:flex;align-items:center;gap:4px;font-weight:400;font-size:.8rem;line-height:1.3;white-space:nowrap}
.ln-item.z{color:#8b2fe0}.ln-item.b{color:#8a6500}.ln-item.t{color:#3d7a06}.ln-item.l{color:#e5303a}
.ln-badge{display:inline;font-weight:inherit}
.ln-svg{display:block;width:100%;height:auto;margin:4px 0 0}
.ln-svg text{font-family:inherit;font-weight:800}
.ln-dot{flex:none;width:16px;height:16px;border-radius:50%;border:2.5px solid;box-sizing:border-box}
.rg-black{border-color:#0f172a}.rg-birthday{border-color:#f5b400}.rg-zodiac{border-color:#8b2fe0}.rg-talent{border-color:#7ccf1b}
.ln-legend{border-top:2px solid #e3e8df;margin-top:4px;padding-top:8px;display:grid;grid-template-columns:1fr;gap:4px;font-size:.8rem;color:#1e293b;line-height:1.3}
.ln-legend>div{display:flex;align-items:center;gap:8px}
.ln-dot-tri{flex:none;width:16px;height:16px}
/* App launcher page */
.lc-list{display:flex;flex-direction:column;gap:2px;padding:8px}
.lc-row{display:flex;flex-direction:column;gap:4px;padding:8px 6px;border-radius:12px}
.lc-row:hover{background:var(--green-soft)}
.lc-main{display:flex;align-items:center;gap:10px;color:var(--fg);text-decoration:none;min-width:0}
.lc-main.off{opacity:.5}
.lc-ico{width:52px;height:52px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.2rem}
.lc-ico.out{background:#6b786f}.lc-ico.out .ico{width:1.4rem;height:1.4rem}
.lc-ico.c0{background:#0c603c}.lc-ico.c1{background:#486c48}.lc-ico.c2{background:#cc6c0c}.lc-ico.c3{background:#b5543a}.lc-ico.c4{background:#2f7d6d}.lc-ico.c5{background:#8a9a2b}.lc-ico.c6{background:#9a6a1a}.lc-ico.c7{background:#c4912f}
.lc-text{display:flex;flex-direction:column;min-width:0}
.lc-name{font-weight:600;line-height:1.25}
.lc-sum{font-size:.78rem;color:var(--muted);line-height:1.3}
.lc-links{display:flex;flex-wrap:wrap;gap:6px;margin-left:62px}
.lc-chip{font-size:.78rem;padding:3px 10px;border:1px solid var(--line);border-radius:999px;color:var(--green);text-decoration:none;white-space:nowrap}
.lc-note{font-size:.78rem;color:var(--muted)}
/* education / member number lines */
.edu-line{display:grid;grid-template-columns:1fr;gap:8px}
.edu-line .gap{display:none}
@media (min-width:560px){.edu-line{grid-template-columns:1fr 1fr}}
.num-line{display:grid;grid-template-columns:minmax(120px,170px) 1fr auto;gap:8px;align-items:start;margin:6px 0}
@media (max-width:480px){.num-line{grid-template-columns:1fr;}}
.actions .small .ico{width:1em;height:1em}
/* three picture buttons in one full-width row */
.avbtns{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 6px}
.avbtns button{min-height:44px;padding:6px 4px;font-size:.95rem;white-space:nowrap}
/* public address with the big share button at its left */
.pubrow{display:flex;align-items:center;gap:12px;margin-top:8px}
.pubtext{min-width:0;display:flex;flex-direction:column}.pubtext a{word-break:break-all}
.share-big{flex:none;width:56px;height:56px;min-height:56px;padding:0;border-radius:16px;border-color:var(--green);color:var(--green);background:var(--green-soft)}
.share-big .ico{width:30px;height:30px}
/* social links: icons under the name, centered; 5 per row, 7 (smaller) when there are more than two rows */
.socials{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 0;margin:2px 0 14px}
.soc{position:relative;width:20%;display:flex;flex-direction:column;align-items:center;gap:4px}
.socials.dense .soc{width:14.2857%}
.soc-link{display:block;line-height:0}
.soc-ico,.soc-plus{width:44px;height:44px;border-radius:10px;display:block;object-fit:cover}
.socials.dense .soc-ico,.socials.dense .soc-plus{width:34px;height:34px}
.soc-copy,.soc-tag{font:inherit;font-size:.7rem;line-height:1.2;box-sizing:border-box;height:2.3rem;display:flex;align-items:center;justify-content:center;padding:2px 6px;min-height:0;max-width:100%;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--muted);white-space:normal;overflow:hidden;overflow-wrap:anywhere;text-align:center}
.soc-copy:hover{border-color:var(--green);color:var(--green)}
.soc-tag{border-color:transparent;background:transparent}
.soc-plus{display:flex;align-items:center;justify-content:center;border:2px dashed var(--green);background:#fff;color:var(--green);min-height:0;padding:0}
.soc-plus .ico{width:1.4em;height:1.4em}
.soc-x{position:absolute;top:-6px;right:calc(50% - 30px);width:20px;height:20px;min-height:0;padding:0;border-radius:50%;border:1px solid var(--line);background:#fff;color:var(--danger);font-size:.8rem;line-height:1}
.socials.dense .soc-x{right:calc(50% - 25px)}
.soc-panel{border:1.5px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px;background:#fbfaf5}
.soc-panel .gap{height:8px}
.soc-preview{width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid var(--line)}
.adm-ico{width:40px;height:40px;border-radius:10px;object-fit:cover;flex:none}
/* toast */
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;max-width:90vw;padding:10px 18px;border-radius:999px;background:var(--green-d);color:#fff;box-shadow:var(--shadow);font-weight:600}
.toast[hidden]{display:none}
/* notifications */
.note-item{padding:12px 0;border-top:1px solid var(--line)}
.note-item:first-of-type{border-top:0}
.note-item.unread{border-left:4px solid var(--orange);padding-left:10px}
.note-item .when{color:var(--muted);font-size:.85rem}
/* back office: full-width layout with a top bar and a "more" drop-down */
body.admin .wrap{max-width:none;margin:0;padding:16px clamp(12px,3vw,40px) 32px}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;padding:8px clamp(12px,3vw,40px);background:#fff;border-top:4px solid transparent;border-image:var(--grad) 1;border-bottom:1px solid var(--line)}
.topbar .brand{font-weight:700;color:var(--green);text-decoration:none;margin-right:auto;font-size:1.05rem}
.topbar .menu-toggle{position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none}
.topbar .burger{display:none;cursor:pointer;font-size:1.6rem;line-height:1;padding:4px 10px;border:1.5px solid var(--line);border-radius:8px;user-select:none}
.topbar .menu{display:flex;align-items:center;gap:4px 8px;flex-wrap:wrap}
.topbar .menu a,.topbar .menu button,.topbar .menu summary{color:var(--fg);text-decoration:none;padding:8px 12px;border-radius:8px;cursor:pointer;list-style:none;white-space:nowrap;border:0;background:transparent;font:inherit;min-height:40px}
.topbar .menu summary::-webkit-details-marker{display:none}
.topbar .menu a:hover,.topbar .menu button:hover,.topbar .menu summary:hover{background:var(--green-soft);color:var(--green-d)}
.topbar .menu .on{background:var(--green);color:#fff}
.topbar details.more{position:relative}
.topbar details.more .drop{position:absolute;right:0;top:calc(100% + 6px);min-width:200px;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:6px;box-shadow:var(--shadow);display:flex;flex-direction:column}
.topbar details.more .drop a,.topbar details.more .drop button{display:block;text-align:left}
@media (max-width:900px){
.topbar .burger{display:block}
.topbar .menu{display:none;position:absolute;right:10px;top:calc(100% + 4px);z-index:25;width:max-content;max-width:calc(100vw - 20px);flex-direction:column;align-items:stretch;gap:2px;padding:6px;background:#fff;border:1.5px solid var(--line);border-radius:12px;box-shadow:0 8px 24px rgba(29,42,34,.18)}
.topbar .menu-toggle:checked ~ .menu{display:flex}
.topbar details.more .drop{position:static;box-shadow:none;border:0;padding:0 0 0 12px;min-width:0;background:transparent}
.topbar .menu a,.topbar .menu button,.topbar .menu summary{padding:10px 14px;text-align:left}
}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:16px;align-items:start}
.grid>.card{margin:0}
@media (max-width:720px){body.admin table{display:block;overflow-x:auto}}
@media (min-width:700px){.wrap{padding-top:24px}}
`;
