// Member site pages: home, 基本資料 (/me), back office (/admin), 完整隱私說明, public profiles (/<member number>).
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { SESSION_COOKIE, readCookie } from "../auth/cookies";
import { findActiveSessionByToken, getMember } from "../db/identity";
import { rolesOf } from "../db/staff";
import { readProfile } from "../db/profile";
import { getActiveBinding, otherSide } from "../db/spouse";
import { publicItems } from "../profile/public";
import { escapeHtml } from "./pages";
import { APPS_PATH, NOTIFICATIONS_PATH, SITE_CSP, sitePage, type NavUser, type SiteNav } from "./layout";
import { initialsOf, tileClass } from "./initials";
import { listApps } from "../db/apps";
import { PRIVACY_SECTIONS, PRIVACY_TITLE, PRIVACY_VERSION, type PrivacySection } from "./privacy";
import { POLICY_SECTIONS, POLICY_TITLE, POLICY_UPDATED } from "./privacy-policy";
import { SITE_CSS } from "./assets/css";
import { ME_JS } from "./assets/me";
import { COMMON_JS } from "./assets/common";
import { NOTES_JS, SHARE_JS } from "./assets/notes";
import { chartHtml } from "./chart";
import { lifeChartOf } from "../profile/astro";
import { AMWAY_FIELDS } from "../amway/fields";
import { listOptions, readAmwayFields } from "../db/amway";
import { readNumbers } from "../db/member-numbers";
import { ADMIN_JS } from "./assets/admin";

type C = Context<AppBindings>;

function page(c: C, body: string, status: 200 | 403 | 404 = 200) {
  c.header("content-security-policy", SITE_CSP);
  c.header("cache-control", "no-store");
  return c.html(body, status);
}

async function currentSession(c: C, deps: Deps) {
  const t = readCookie(c, SESSION_COOKIE);
  return t ? findActiveSessionByToken(c.env.DB, t, deps.now()) : null;
}

/** Name and picture for the main menu. */
async function navUser(db: D1Database, memberId: string): Promise<NavUser> {
  const [member, dn] = await Promise.all([
    getMember(db, memberId),
    db.prepare("SELECT value FROM profile_field_values WHERE member_id = ? AND field_key = 'display_name'").bind(memberId).first<{ value: string }>(),
  ]);
  let name: string | null = null;
  if (dn) {
    try {
      const v = JSON.parse(dn.value) as unknown;
      if (typeof v === "string") name = v;
    } catch {
      /* fall back to the Google name */
    }
  }
  name = (name ?? member?.display_name ?? "").trim() || "會員";
  return { name, initials: initialsOf(name), avatar_url: member?.avatar_url ?? null };
}

async function navFor(c: C, deps: Deps, path: string): Promise<SiteNav> {
  const s = await currentSession(c, deps);
  if (!s) return { signedIn: false, path };
  const [user, roles, unread] = await Promise.all([
    navUser(c.env.DB, s.member_id),
    rolesOf(c.env.DB, s.member_id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL").bind(s.member_id).first<{ n: number }>(),
  ]);
  return { signedIn: true, staff: roles.length > 0, user, path, unread: unread?.n ?? 0 };
}

function asset(c: C, body: string, type: string) {
  c.header("content-type", type);
  // Always revalidate so a deploy takes effect at once (the files are small).
  c.header("cache-control", "no-cache");
  return c.body(body, 200);
}

export function registerSiteRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.get("/assets/site.css", (c) => asset(c, SITE_CSS, "text/css; charset=utf-8"));
  app.get("/assets/me.js", (c) => asset(c, ME_JS, "text/javascript; charset=utf-8"));
  app.get("/assets/common.js", (c) => asset(c, COMMON_JS, "text/javascript; charset=utf-8"));
  app.get("/assets/notifications.js", (c) => asset(c, NOTES_JS, "text/javascript; charset=utf-8"));
  app.get("/assets/share.js", (c) => asset(c, SHARE_JS, "text/javascript; charset=utf-8"));
  app.get("/assets/admin.js", (c) => asset(c, ADMIN_JS, "text/javascript; charset=utf-8"));

  app.get("/", async (c) => {
    if (await currentSession(c, deps)) return c.redirect("/me", 302);
    return page(c, sitePage({ title: "會員中心", nav: { signedIn: false }, body: '<section class="card"><h1>H-Global1985 會員中心</h1><p>登入後可以管理您的基本資料。</p><p><a class="button primary" href="/login">使用 Google 帳號登入</a></p></section>' }));
  });

  app.get("/logout", (c) => c.redirect("/oauth/logout", 302));

  // Uploaded avatars (always public). Served as an image only, never as a page.
  app.get("/avatar/:id{[0-9a-f-]{36}}", async (c) => {
    const row = await c.env.DB.prepare("SELECT a.mime, a.data FROM member_avatars a JOIN members m ON m.id = a.member_id WHERE a.member_id = ? AND m.status = 'active'")
      .bind(c.req.param("id"))
      .first<{ mime: string; data: ArrayBuffer }>();
    if (!row) return c.body("Not found", 404);
    c.header("content-type", row.mime);
    c.header("cache-control", "public, max-age=3600");
    c.header("x-content-type-options", "nosniff");
    c.header("content-security-policy", "default-src 'none'; sandbox");
    return c.body(row.data, 200);
  });

  // /me opens the member's own public page (the page visitors see); editing is on /me/edit.
  app.get("/me", async (c) => {
    const s = await currentSession(c, deps);
    if (!s) return c.redirect("/login?return_to=%2Fme", 302);
    const first = (await readNumbers(c.env.DB, s.member_id))[0];
    return c.redirect(first ? `/${encodeURIComponent(first.number)}` : "/me/edit", 302);
  });

  app.get("/me/edit", async (c) => {
    const s = await currentSession(c, deps);
    if (!s) return c.redirect("/login?return_to=%2Fme%2Fedit", 302);
    return page(c, sitePage({ title: "編輯基本資料", nav: await navFor(c, deps, "/me"), body: '<div id="app"><p class="help">載入中…</p></div>', script: ["/assets/common.js", "/assets/me.js"] }));
  });

  app.get(NOTIFICATIONS_PATH, async (c) => {
    const s = await currentSession(c, deps);
    if (!s) return c.redirect("/login?return_to=%2Fnotifications", 302);
    return page(c, sitePage({ title: "站內通知", nav: await navFor(c, deps, NOTIFICATIONS_PATH), body: '<div id="app"><p class="help">載入中…</p></div>', script: ["/assets/common.js", "/assets/notifications.js"] }));
  });

  app.get("/admin", async (c) => {
    const s = await currentSession(c, deps);
    if (!s) return c.redirect("/login?return_to=%2Fadmin", 302);
    if (!(await rolesOf(c.env.DB, s.member_id)).length) {
      return page(c, sitePage({ title: "後台", nav: await navFor(c, deps, "/admin"), body: '<section class="card"><h2>沒有權限</h2><p>此頁面只開放給管理人員。</p></section>' }), 403);
    }
    return page(c, sitePage({ title: "後台", admin: true, nav: await navFor(c, deps, "/admin"), body: '<div id="app"><p class="help">載入中…</p></div>', script: "/assets/admin.js" }));
  });

  // H-Global1985 Apps: the 9-dot launcher leads here. Public (names and web addresses only); stopped Apps are hidden.
  app.get(APPS_PATH, async (c) => {
    const { apps } = await listApps(c.env.DB, deps.now());
    const rows = apps
      .filter((a) => a.status !== "killed")
      .map((a) => {
        const letter = escapeHtml([...a.name.trim()][0]?.toUpperCase() ?? "?");
        const icon = `<span class="lc-ico ${tileClass(a.app_id)}">${letter}</span>`;
        const text = `<span class="lc-text"><span class="lc-name">${escapeHtml(a.name)}</span></span>`;
        const web = a.web_origins[0];
        const paused = a.status === "paused";
        const main = !paused && web ? `<a class="lc-main" href="${escapeHtml(web)}" rel="noopener">${icon}${text}</a>` : `<span class="lc-main off">${icon}${text}</span>`;
        const links = paused ? '<span class="lc-note">暫停中</span>' : web ? `<a class="lc-chip" href="${escapeHtml(web)}" rel="noopener">網頁</a>` : "";
        return `<div class="lc-row">${main}${links ? `<div class="lc-links">${links}</div>` : ""}</div>`;
      })
      .join("");
    const body = `<h1>H-Global1985 Apps</h1><div class="card lc-list">${rows || '<p class="help">目前沒有可使用的 App。</p>'}</div>`;
    return page(c, sitePage({ title: "H-Global1985 Apps", nav: await navFor(c, deps, APPS_PATH), body }));
  });

  // Static legal text: escaped, then the {{amway}} token becomes a link to the Amway notice.
  const text = (t: string) => escapeHtml(t).replaceAll("{{amway}}", '<a href="/privacy/amway">完整隱私說明</a>');
  const sections = (list: PrivacySection[]) =>
    list
      .map(
        (s) =>
          `<h2>${escapeHtml(s.heading)}</h2>` +
          (s.paragraphs ?? []).map((p) => `<p>${text(p)}</p>`).join("") +
          (s.items ? `<ul class="plain">${s.items.map((i) => `<li>${text(i)}</li>`).join("")}</ul>` : ""),
      )
      .join("");

  app.get("/privacy", async (c) => {
    const nav = await navFor(c, deps, "/privacy");
    const body =
      `<article class="card"><h1>${escapeHtml(POLICY_TITLE)}</h1><p class="help">最後更新：${escapeHtml(POLICY_UPDATED)}</p>` +
      sections(POLICY_SECTIONS) +
      "</article>";
    c.header("content-security-policy", SITE_CSP);
    c.header("cache-control", "public, max-age=300");
    return c.html(sitePage({ title: POLICY_TITLE, nav, body }));
  });

  app.get("/privacy/amway", async (c) => {
    const nav = await navFor(c, deps, "/privacy/amway");
    const body =
      `<article class="card"><h1>${escapeHtml(PRIVACY_TITLE)}</h1><p class="help">版本 ${escapeHtml(PRIVACY_VERSION)}</p>` +
      sections(PRIVACY_SECTIONS) +
      "</article>";
    c.header("content-security-policy", SITE_CSP);
    c.header("cache-control", "public, max-age=300");
    return c.html(sitePage({ title: "完整隱私說明", nav, body }));
  });

  // Public profile: /<default member number>. Bound spouses share one URL; visitors switch between them.
  app.get("/:number{[A-Z0-9][A-Z0-9-]{0,19}}", async (c) => {
    const number = c.req.param("number");
    const db = c.env.DB;
    const r = await db
      .prepare(
        `SELECT n.member_id FROM member_numbers n JOIN members m ON m.id = n.member_id
         WHERE n.position = 0 AND n.number = ? AND m.status = 'active' ORDER BY m.created_at LIMIT 5`,
      )
      .bind(number)
      .all<{ member_id: string }>();
    let ids = (r.results ?? []).map((x) => x.member_id);
    if (ids.length === 1) {
      const b = await getActiveBinding(db, ids[0] as string);
      if (b) ids = [b.initiator_id, otherSide(b, b.initiator_id)];
    }
    const nav = await navFor(c, deps, "/");
    if (!ids.length) return page(c, sitePage({ title: "找不到會員", nav, body: '<section class="card"><h2>找不到此會員</h2><p>網址可能已經變更。</p></section>' }), 404);
    const pick = Math.min(Math.max(Number(c.req.query("m") ?? 0) || 0, 0), ids.length - 1);
    const viewer = await currentSession(c, deps);
    const options = await listOptions(db);
    const EDU = [
      { label: "大學", school: "university", dept: "university_dept" },
      { label: "碩士", school: "grad_school", dept: "grad_dept" },
      { label: "博士", school: "phd_school", dept: "phd_dept" },
    ];
    const eduKeys = new Set(EDU.flatMap((l) => [l.school, l.dept]));
    const profiles = await Promise.all(
      ids.map(async (id) => {
        const m = await getMember(db, id);
        const { values, visibility } = await readProfile(db, id);
        const items = publicItems(values, visibility, m?.display_name ?? null);
        const pub = (k: string, dflt: "public" | "private" = "private") => (visibility.get(k) ?? dflt) === "public";
        const str = (k: string) => (typeof values.get(k)?.value === "string" ? (values.get(k)?.value as string) : "");
        // Education: one line per level, shown when the school or the department is public.
        const edu = EDU.map((l) => ({ label: l.label, text: [pub(l.school) ? str(l.school) : "", pub(l.dept) ? str(l.dept) : ""].filter(Boolean).join("　") })).filter((l) => l.text);
        // Amway area: only when the member turned it on; reviewed values only when approved.
        const amway: { label: string; text: string }[] = [];
        if (m?.amway_enabled === 1) {
          const rows = await readAmwayFields(db, id);
          for (const f of AMWAY_FIELDS) {
            const row = rows.get(f.key);
            if (!pub(f.key) || !row || typeof row.value !== "string" || !(row.value_approved || row.status === "not_required")) continue;
            const label = f.type === "select" ? (options.get(f.key)?.find((o) => o.value === row.value)?.label ?? "") : row.value;
            if (label) amway.push({ label: f.label, text: label });
          }
        }
        const birthday = str("birthday");
        const chart = birthday && pub("derived") ? lifeChartOf(birthday) : null;
        return { m, id, items, edu, amway, chart };
      }),
    );
    const nameOf = (p: (typeof profiles)[number]) => {
      const dn = p.items.find((i) => i.key === "display_name");
      return typeof dn?.value === "string" ? dn.value : "會員";
    };
    const tabs =
      profiles.length > 1
        ? `<div class="tabs">${profiles.map((p, i) => `<a href="/${encodeURIComponent(number)}?m=${i}"${i === pick ? ' class="on"' : ""}>${escapeHtml(nameOf(p))}</a>`).join("")}</div>`
        : "";
    const p = profiles[pick] as (typeof profiles)[number];
    const avatar = p.m?.avatar_url ? `<img class="avatar lg" src="${escapeHtml(p.m.avatar_url)}" alt="">` : `<span class="avatar lg" aria-hidden="true">${escapeHtml(initialsOf(nameOf(p)))}</span>`;
    const value = (i: { type: string; value: string | string[] }) => {
      if (Array.isArray(i.value)) return `<div class="chips">${i.value.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>`;
      if (i.type === "url") return `<a href="${escapeHtml(i.value)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(i.value)}</a>`;
      return escapeHtml(i.value).replace(/\n/g, "<br>");
    };
    const motto = p.items.find((i) => i.key === "motto");
    const row = (label: string, html: string) => `<div class="row"><div class="row-head"><label>${escapeHtml(label)}</label></div><div class="value">${html}</div></div>`;
    const rows =
      p.items
        .filter((i) => i.key !== "display_name" && i.key !== "motto" && !eduKeys.has(i.key))
        .map((i) => row(i.label, value(i)))
        .join("") + p.edu.map((l) => row(l.label, escapeHtml(l.text))).join("");
    const amwayRows = p.amway.map((a) => row(a.label, escapeHtml(a.text))).join("");
    const mine = viewer?.member_id === p.id;
    const share = `<button type="button" class="small" id="share" data-label="分享"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4" stroke="currentColor" stroke-width="2"/></svg>分享</button>`;
    const edit = mine ? `<a class="button small primary" href="/me/edit"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>編輯</a>` : "";
    const body =
      `${tabs}<div class="pagebar"><span></span><div class="tools">${share}${edit}</div></div>` +
      `<section class="card"><div class="hero">${avatar}<div><h1>${escapeHtml(nameOf(p))}</h1><div class="sub"><span class="help">會員</span><span class="badge num">${escapeHtml(number)}</span></div></div></div>` +
      (motto && typeof motto.value === "string" ? `<p class="motto">${escapeHtml(motto.value)}</p>` : "") +
      `${rows || '<p class="help">還沒有公開的資料。</p>'}</section>` +
      (amwayRows ? `<section class="card"><h2>Amway</h2>${amwayRows}</section>` : "") +
      (p.chart ? `<section class="card"><h2>生命靈數</h2>${chartHtml(p.chart)}</section>` : "");
    return page(c, sitePage({ title: nameOf(p), nav, body, script: "/assets/share.js" }));
  });
}
