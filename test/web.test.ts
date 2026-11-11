import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "web-test" });
})();

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
let now = new Date();
interface P {
  id: string;
  cookie: string;
}

async function person(sub: string, name: string, roles: string[] = []): Promise<P> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name, email: `${sub}@example.com` }, "TW", now, "req");
  const { token } = await createSession(db, member.id, now);
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  return { id: member.id, cookie: token };
}

beforeEach(() => {
  now = new Date();
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk };
  app = createApp({ now: () => now });
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning','e','none','[]','openid profile.read', 'active','x','x')").run();
});

const req = (p: P | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
  app.request(
    path,
    {
      method,
      headers: {
        ...(p ? { cookie: `__Host-hgid_session=${p.cookie}` } : {}),
        ...(method !== "GET" ? { origin: ISSUER } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...extra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    },
    env,
  );

describe("member site uses the APIs with its session cookie", () => {
  it("reads and writes as the site itself; cross-site writes are refused", async () => {
    const a = await person("a", "甲");
    expect((await req(a, "GET", "/v1/me/profile")).status).toBe(200);
    expect((await req(a, "PUT", "/v1/me/profile/fields/motto", { value: "阿甲" })).status).toBe(200);
    expect(db.raw.prepare("SELECT app_id FROM audit_log WHERE action = 'profile.field.update'").get()?.app_id).toBe("central");
    expect((await req(a, "PUT", "/v1/me/profile/fields/motto", { value: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await req(null, "GET", "/v1/me/profile")).status).toBe(401);
  });
});

describe("pages", () => {
  it("/me and /admin need sign-in; /admin needs a staff role; pages use a strict CSP", async () => {
    let res = await req(null, "GET", "/me");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?return_to=%2Fme");
    const a = await person("a", "甲");
    // /me opens the member's own public page; the edit page is /me/edit.
    res = await req(a, "GET", "/me");
    expect(res.status).toBe(302);
    const own = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(a.id)?.number as string;
    expect(res.headers.get("location")).toBe(`/${own}`);
    expect((await req(null, "GET", "/me/edit")).headers.get("location")).toBe("/login?return_to=%2Fme%2Fedit");
    res = await req(a, "GET", "/me/edit");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    // The page shrinks avatars and icons in a canvas first, which needs blob: images.
    expect(res.headers.get("content-security-policy")).toContain("img-src 'self' https: data: blob:");
    const editHtml = await res.text();
    expect(editHtml).toContain('src="/assets/common.js"');
    expect(editHtml).toContain('src="/assets/me.js"');
    expect((await req(a, "GET", "/admin")).status).toBe(403);
    const s = await person("s", "秘書", ["secretary"]);
    expect(await (await req(s, "GET", "/admin")).text()).toContain('src="/assets/admin.js"');
    expect((await req(a, "GET", "/")).headers.get("location")).toBe("/me");
    for (const p of ["/assets/me.js", "/assets/admin.js", "/assets/site.css", "/assets/common.js", "/assets/notifications.js", "/assets/share.js"]) expect((await req(null, "GET", p)).status).toBe(200);
  });

  it("the full privacy page shows sections 1–8 and none of the document's internal notes", async () => {
    const res = await req(null, "GET", "/privacy/amway");
    const html = await res.text();
    expect(html).toContain("Amway 會員資料之蒐集與跨系統利用告知");
    for (const h of ["1. 蒐集者", "5. 重複編號比對與夫妻綁定", "8. 資料正確性與責任"]) expect(html).toContain(h);
    for (const internal of ["與第一版的差異", "已決定事項", "請專家確認", "我的提醒", "（新增）"]) expect(html).not.toContain(internal);
    // Section 4 cache time (owner decision 2026-11-10, matches ADR 0006).
    expect(html).toContain("查詢時效性快取最長 1 日");
    expect(html).not.toContain("5 分鐘");
  });

  it("the general privacy policy is public, linked from every page, and links to the Amway notice", async () => {
    const res = await req(null, "GET", "/privacy");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    const html = await res.text();
    expect(html).toContain("<h1>隱私權政策</h1>");
    for (const h of ["1. 營運單位", "6. Cookie", "8. 您的權利", "11. 聯絡我們"]) expect(html).toContain(h);
    expect(html).toContain("hglobal1985@gmail.com");
    expect(html).toContain('<a href="/privacy/amway">完整隱私說明</a>');
    expect(html).not.toContain("{{amway}}");
    for (const banned of ["繁星", "安麗", "回聲"]) expect(html).not.toContain(banned);
    const amway = await (await req(null, "GET", "/privacy/amway")).text();
    expect(amway).toContain('<a href="/privacy">隱私權政策</a>');
  });

  it("member-facing site pages never name the other system in Chinese", async () => {
    const a = await person("a", "甲");
    for (const p of ["/", "/me/edit", "/assets/me.js", "/assets/admin.js", "/assets/common.js", "/assets/notifications.js"]) {
      const t = await (await req(p === "/" ? null : a, "GET", p)).text();
      for (const banned of ["繁星", "安麗", "回聲"]) expect(t, p).not.toContain(banned);
    }
  });
});

describe("public profile /<member number>", () => {
  it("shows public fields only, escapes member input, and 404s unknown numbers", async () => {
    const a = await person("a", "甲");
    await req(a, "PUT", "/v1/me/profile/fields/bio", { value: "<script>alert(1)</script>" });
    await req(a, "PUT", "/v1/me/profile/fields/contact_email", { value: "secret@example.com" });
    const n = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(a.id)?.number as string;
    const html = await (await req(null, "GET", `/${n}`)).text();
    expect(html).toContain("甲");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("secret@example.com");
    expect((await req(null, "GET", "/TW0000000")).status).toBe(404);
    expect((await req(null, "GET", "/nothing-lowercase")).status).toBe(404);
  });

  it("the public page has 分享 for everyone and 編輯 only for its owner; it shows public Amway fields, education lines and the 九宮格 when made public", async () => {
    const a = await person("a", "王小明");
    const o = await person("o", "他人");
    const n = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(a.id)?.number as string;
    await req(a, "PUT", "/v1/me/profile/fields/university", { value: "政治大學" });
    await req(a, "PUT", "/v1/me/profile/fields/university_dept", { value: "資訊管理學系" });
    await req(a, "PUT", "/v1/me/profile/fields/occupation", { value: ["工程師", "老師"] });
    await req(a, "PUT", "/v1/me/profile/fields/birthday", { value: "1990-07-23" });
    await req(a, "PUT", "/v1/me/profile/fields/motto", { value: "慢慢來" });
    let html = await (await req(null, "GET", `/${n}`)).text();
    expect(html).toContain('id="share"');
    expect(html).not.toContain('href="/me/edit"'); // not signed in
    expect(html).not.toContain("政治大學"); // education starts hidden
    expect(html).toContain("彩色九宮格"); // 生命靈數 is always public once a birthday is set
    expect(html).toContain("慢慢來"); // the motto is public by default
    expect(await (await req(o, "GET", `/${n}`)).text()).not.toContain('href="/me/edit"');
    // The owner sees the edit button; making things public shows them.
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: true });
    await req(a, "PUT", "/v1/me/amway/fields/upline_diamond", { value: "陳大華" });
    await req(a, "PUT", "/v1/me/amway/fields/upline_crown_ambassador", { value: "秘密皇冠" });
    await req(a, "PUT", "/v1/me/profile/visibility", { fields: { university: "public", university_dept: "public", occupation: "public" } });
    html = await (await req(a, "GET", `/${n}`)).text();
    expect(html).toContain('href="/me/edit"');
    expect(html).toContain("大學");
    expect(html).toContain("政治大學　資訊管理學系");
    expect(html).toContain('<span class="chip">工程師</span>');
    expect(html).toContain("上手鑽石");
    expect(html).toContain("陳大華");
    expect(html).toContain("星座：獅子座");
    expect(html).not.toContain("秘密皇冠"); // fields with a switch stay hidden until the member makes them public
    expect(html).toContain("彩色九宮格");
    expect(html).toContain("星座：獅子座");
    expect(html).not.toMatch(/ style="/);
    // Turning the Amway area off hides it from visitors, whatever the field switches say.
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: false });
    expect(await (await req(null, "GET", `/${n}`)).text()).not.toContain("陳大華");
  });

  it("the public address is the country code and the number joined (TW9475831); older number-only addresses forward to it", async () => {
    const a = await person("a", "甲");
    await req(a, "PUT", "/v1/me/profile/fields/member_number", { value: [{ country: "TW", number: "9475831" }] });
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: true });
    const res = await req(a, "PUT", "/v1/me/profile/fields/member_number", { value: [{ country: "TW", number: "9475831" }] });
    expect(((await res.json()) as { public_url: string }).public_url).toBe(`${ISSUER}/TW9475831`);
    const page = await req(null, "GET", "/TW9475831");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("TW9475831");
    const old = await req(null, "GET", "/9475831");
    expect(old.status).toBe(302);
    expect(old.headers.get("location")).toBe("/TW9475831");
    expect((await req(null, "GET", "/tw9475831")).status).toBe(200);
    expect((await req(a, "GET", "/me")).headers.get("location")).toBe("/TW9475831");
    // Numbers the system generated already carry the country code: no doubled prefix.
    const b = await person("b", "乙");
    const n = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(b.id)?.number as string;
    expect(n).toMatch(/^TW0\d{6}$/);
    expect((await req(b, "GET", "/me")).headers.get("location")).toBe(`/${n}`);
    const prof = (await (await req(b, "GET", "/v1/me/profile")).json()) as { fields: { member_number: { public_url: string } } };
    expect(prof.fields.member_number.public_url).toBe(`${ISSUER}/${n}`);
  });

  it("bound spouses share one URL with a switcher", async () => {
    const a = await person("a", "甲");
    const b = await person("b", "乙");
    const bn = db.raw.prepare("SELECT country, number FROM member_numbers WHERE member_id = ?").get(b.id) as { country: string; number: string };
    const dup = (await (await req(a, "PUT", "/v1/me/profile/fields/member_number", { value: [bn] })).json()) as { duplicate_candidates: { candidate_id: string }[] };
    expect((await req(a, "POST", "/v1/me/spouse", { candidate_id: dup.duplicate_candidates[0]?.candidate_id })).status).toBe(200);
    const html = await (await req(null, "GET", `/${bn.number}?m=1`)).text();
    expect(html).toContain(`href="/${bn.number}?m=0"`);
    expect(html).toContain('class="on">乙');
  });
});

describe("account deletion (immediate)", () => {
  it("only on the member site, after a recent sign-in; the old request mechanism and 刪除 Amway 資料 are gone", async () => {
    const a = await person("a", "甲");
    const t = await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId: a.id, sessionId: db.raw.prepare("SELECT id FROM login_sessions").get()?.id as string, scope: "openid profile.read", authTime: 0 });
    const viaApp = await app.request("/v1/me/delete-account", { method: "POST", headers: { authorization: `Bearer ${t.access_token}` } }, env);
    expect(viaApp.status).toBe(403);
    const sec = await person("sec", "秘書", ["secretary"]);
    for (const [who, method, path] of [[a, "POST", "/v1/me/deletion-requests"], [a, "GET", "/v1/me/deletion-requests"], [sec, "GET", "/v1/admin/deletion-requests"], [sec, "GET", "/v1/admin/amway/options"], [sec, "PUT", "/v1/admin/amway/options"]] as const) {
      expect((await req(who, method, path, method !== "GET" ? { scope: "amway" } : undefined)).status, path).toBe(404);
    }
    now = new Date(now.getTime() + 11 * 60 * 1000);
    const res = await req(a, "POST", "/v1/me/delete-account");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("reauth_required");
    expect(db.raw.prepare("SELECT status FROM members WHERE id = ?").get(a.id)?.status).toBe("active");
  });

  it("takes effect at once: anonymized, Amway data removed, signed out everywhere, Google account released", async () => {
    const a = await person("a", "甲");
    await req(a, "PUT", "/v1/me/profile/fields/bio", { value: "hello" });
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: true });
    await req(a, "PUT", "/v1/me/amway/fields/referrer", { value: "王" });
    const res = await req(a, "POST", "/v1/me/delete-account");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: boolean }).deleted).toBe(true);
    const m = db.raw.prepare("SELECT status, google_sub, google_email, display_name, amway_enabled FROM members WHERE id = ?").get(a.id);
    expect(m).toEqual({ status: "deleted", google_sub: `deleted:${a.id}`, google_email: null, display_name: null, amway_enabled: 0 });
    for (const table of ["profile_field_values", "member_numbers", "amway_field_values", "notifications"]) {
      expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id = ?`).get(a.id)?.n, table).toBe(0);
    }
    expect((await req(a, "GET", "/v1/me/profile")).status).toBe(401);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'account.delete'").get()?.n).toBe(1);
    // The same Google account can sign up again as a new member.
    const again = await upsertMemberByGoogle(db, { sub: "a", emailVerified: true }, "TW", now, "req");
    expect(again.created).toBe(true);
  });

  it("the last super administrator cannot delete the account", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const res = await req(sa, "POST", "/v1/me/delete-account");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("last_super_admin");
    const sa2 = await person("sa2", "超管二", ["super_admin"]);
    expect((await req(sa, "POST", "/v1/me/delete-account")).status).toBe(200);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM staff_roles WHERE role = 'super_admin'").get()?.n).toBe(1);
    expect(sa2.id).toBeTruthy();
  });
});

describe("member center template (same layout as starry.phd)", () => {
  it("shows the main menu with name and App launcher when signed in, a brand bar when not", async () => {
    const a = await person("a", "王小明");
    const me = await (await req(a, "GET", "/me/edit")).text();
    expect(me).toContain("<title>會員中心</title>");
    expect(me).not.toMatch(/H-Global1985|hglobal|寰宇/i);
    expect(me).toContain('class="starnav"');
    expect(me).toContain('href="/notifications"'); // the bell
    expect(me).toContain("王小明");
    expect(me).toContain("王小"); // initials bubble
    const bell = await (await req(a, "GET", "/privacy")).text();
    expect(bell).not.toContain('class="dot"'); // no unread notifications yet
    db.raw.prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES ('n1', ?, 'spouse.unbound', '{}', '2026-11-11T00:00:00+08:00')").run(a.id);
    expect(await (await req(a, "GET", "/privacy")).text()).toContain('<span class="dot">1</span>');
    expect(me).toContain('href="/apps"');
    expect(me).not.toContain('href="/logout"'); // 登出 lives first in the launcher page (the 9 dots)
    const apps = await (await req(a, "GET", "/apps")).text();
    expect(apps.indexOf('href="/logout"')).toBeGreaterThan(apps.lastIndexOf('href="/me/edit"')); // 登出 is the last entry
    expect(await (await req(null, "GET", "/apps")).text()).not.toContain('href="/logout"');
    const guest = await (await req(null, "GET", "/privacy")).text();
    expect(guest).toContain("guest-brand");
    expect(guest).not.toContain("starnav");
  });

  it("the main menu cuts a long name to 4 Chinese characters and shows the reviewed rank in a small box (創辦人 → F)", async () => {
    const a = await person("a", "王大明明明明");
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: true });
    const code = db.raw.prepare("SELECT value FROM amway_options WHERE field_key = 'rank' AND label = '創辦人執行專才鑽石'").get()?.value as string;
    await req(a, "PUT", "/v1/me/amway/fields/rank", { value: code });
    // No review is needed unless the training system is H-Global1985, and an unreviewed rank is not shown.
    expect(await (await req(a, "GET", "/privacy")).text()).not.toContain('class="rank');
    db.raw.prepare("UPDATE amway_field_values SET value_approved = 1 WHERE member_id = ? AND field_key = 'rank'").run(a.id);
    const html = await (await req(a, "GET", "/privacy")).text();
    expect(html).toContain('<span class="nm">王大明明…</span>');
    expect(html).toMatch(/<span class="rank rk2" title="F執行專才鑽石">F執行專才鑽石<\/span>/);
    expect(html).not.toContain("創辦人");
  });

  it("the 9-dot page lists 個人設定 first and 登出 last; the name, 系統, 中心 and 獎銜 boxes sit beside the name on the page", async () => {
    const a = await person("a", "王小明");
    const apps = await (await req(a, "GET", "/apps")).text();
    const rows = apps.split('class="lc-row"');
    expect(rows[1]).toContain("個人設定");
    expect(rows[1]).toContain('href="/me/edit"');
    expect(rows.at(-1)).toContain("登出");
    // 系統 / 中心 / 獎銜 boxes (only while the Amway switch is on and only what is filled)
    const n = db.raw.prepare("SELECT country, number FROM member_numbers WHERE member_id = ?").get(a.id) as { country: string; number: string };
    expect(await (await req(null, "GET", `/${n.number}`)).text()).not.toContain('class="badges"');
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: true });
    await req(a, "PUT", "/v1/me/amway/fields/education_system", { value: "某系統" });
    await req(a, "PUT", "/v1/me/amway/fields/education_center", { value: "南京 062" });
    let html = await (await req(null, "GET", `/${n.number}`)).text();
    expect(html).toContain("會員編號");
    expect(html).toMatch(/<span class="rank k-system rk0" title="系統：某系統">某系統<\/span>/);
    expect(html).toMatch(/<span class="rank k-center rk0" title="中心：南京 062">南京 062<\/span>/);
    expect(html).not.toContain("k-rank"); // no reviewed rank yet
    // Always-public fields show without any switch; referrer and uplines too.
    await req(a, "PUT", "/v1/me/amway/fields/referrer", { value: "推薦人甲" });
    await req(a, "PUT", "/v1/me/profile/fields/country", { value: "日本" });
    html = await (await req(null, "GET", `/${n.number}`)).text();
    expect(html).toContain("推薦人甲");
    expect(html).toContain("日本");
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: false });
    expect(await (await req(null, "GET", "/")).text()).not.toContain("推薦人甲");
  });

  it("the name at the top stays on one line: long names take a smaller step; the 會員編號 line and the badges follow what is public", async () => {
    const long = await person("l", "王小明明明明明明明明明明");
    const short = await person("s", "王小明");
    const num = (p: P) => db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(p.id)?.number as string;
    expect(await (await req(null, "GET", `/${num(short)}`)).text()).toContain('<h1 class="nm nm-0">王小明</h1>');
    expect(await (await req(null, "GET", `/${num(long)}`)).text()).toMatch(/<h1 class="nm nm-3">王小明明明明明明明明明明<\/h1>/);
    // The Amway boxes beside the name follow the switches: hide the center and its box is gone for visitors.
    await req(short, "PUT", "/v1/me/amway/enabled", { enabled: true });
    await req(short, "PUT", "/v1/me/amway/fields/education_system", { value: "某系統" });
    await req(short, "PUT", "/v1/me/amway/fields/education_center", { value: "南京 062" });
    let html = await (await req(null, "GET", `/${num(short)}`)).text();
    expect(html).toContain("某系統");
    expect(html).toContain("南京 062");
    expect(html).not.toContain("H-Global1985");
    expect((await req(short, "PUT", "/v1/me/profile/visibility", { fields: { education_center: "private" } })).status).toBe(200);
    html = await (await req(null, "GET", `/${num(short)}`)).text();
    expect(html).toContain("某系統");
    expect(html).not.toContain("南京 062");
    // The owner still sees every box in the editor data.
    const mine = (await (await req(short, "GET", "/v1/me/profile")).json()) as { badges: { kind: string }[] };
    expect(mine.badges.map((b) => b.kind)).toEqual(["system", "center"]);
  });

  it("/apps lists registered Apps with their web link; paused ones have no link and stopped ones are hidden", async () => {
    let html = await (await req(null, "GET", "/apps")).text();
    expect(html).toContain("寰宇行動大學");
    expect(html).toContain('class="lc-chip"');
    db.raw.prepare("INSERT INTO app_status_overrides (app_id, status, reason, updated_at, updated_by) VALUES ('learn','paused',NULL,'x','x')").run();
    const { clearAppCache } = await import("../src/db/apps");
    clearAppCache();
    html = await (await req(null, "GET", "/apps")).text();
    expect(html).toContain("暫停中");
    expect(html).not.toContain('class="lc-chip"');
    db.raw.prepare("UPDATE app_status_overrides SET status = 'killed' WHERE app_id = 'learn'").run();
    clearAppCache();
    expect(await (await req(null, "GET", "/apps")).text()).not.toContain("寰宇行動大學");
  });

  it("the back office is a full-width page with the top bar and no inline styles anywhere", async () => {
    const s = await person("s", "管理", ["secretary"]);
    const html = await (await req(s, "GET", "/admin")).text();
    expect(html).toContain('class="topbar"');
    expect(html).toContain('<body class="admin">');
    for (const p of ["/me/edit", "/notifications", "/admin", "/apps", "/privacy"]) expect(await (await req(s, "GET", p)).text(), p).not.toMatch(/ style="/);
  });
});

describe("signed-in devices, sign out everywhere, download my data", () => {
  const appSession = (memberId: string, id: string, appId = "learn") =>
    db.raw
      .prepare("INSERT INTO app_sessions (id, member_id, app_id, refresh_hash, scope, device_label, auth_time_epoch, last_used_epoch, expires_epoch, created_at) VALUES (?, ?, ?, 'h', 'profile.read', 'iPhone', ?, ?, ?, 'x')")
      .run(id, memberId, appId, Math.floor(now.getTime() / 1000), Math.floor(now.getTime() / 1000), Math.floor(now.getTime() / 1000) + 3600);

  it("lists this browser and each App; signs out one other device but never the current one", async () => {
    const a = await person("a", "甲");
    appSession(a.id, "app-sess-1");
    const list = (await (await req(a, "GET", "/v1/me/sessions")).json()) as { sessions: { id: string; kind: string; app_name: string; current: boolean; device_label: string | null }[] };
    expect(list.sessions.map((s) => [s.kind, s.app_name, s.current, s.device_label])).toEqual(expect.arrayContaining([["web", "會員網站", true, null], ["app", "寰宇行動大學", false, "iPhone"]]));
    const current = list.sessions.find((s) => s.current) as { id: string };
    expect((await req(a, "POST", `/v1/me/sessions/${current.id}/revoke`)).status).toBe(409);
    expect((await req(a, "POST", "/v1/me/sessions/app-sess-1/revoke")).status).toBe(200);
    expect(db.raw.prepare("SELECT revoked_epoch FROM app_sessions WHERE id = 'app-sess-1'").get()?.revoked_epoch).not.toBeNull();
    expect((await req(a, "POST", "/v1/me/sessions/app-sess-1/revoke")).status).toBe(404);
    // Someone else's session cannot be signed out.
    const b = await person("b", "乙");
    appSession(b.id, "app-sess-b");
    expect((await req(a, "POST", "/v1/me/sessions/app-sess-b/revoke")).status).toBe(404);
  });

  it("sign out everywhere ends the browser session and every App session", async () => {
    const a = await person("a", "甲");
    appSession(a.id, "app-sess-1");
    expect((await req(a, "POST", "/v1/me/logout-all")).status).toBe(200);
    expect((await req(a, "GET", "/v1/me/profile")).status).toBe(401);
    expect(db.raw.prepare("SELECT revoked_epoch FROM app_sessions WHERE id = 'app-sess-1'").get()?.revoked_epoch).not.toBeNull();
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'app.logout_all'").get()?.n).toBe(1);
  });

  it("downloads only my own data, without any token or secret, and audits it", async () => {
    const a = await person("a", "甲");
    await req(a, "PUT", "/v1/me/profile/fields/motto", { value: "阿甲" });
    const res = await req(a, "GET", "/v1/me/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const data = JSON.parse(text) as { member: { id: string }; profile: Record<string, { value: unknown }>; member_numbers: unknown[] };
    expect(data.member.id).toBe(a.id);
    expect(data.profile.motto?.value).toBe("阿甲");
    expect(data.member_numbers.length).toBe(1);
    for (const secret of ["token_hash", "refresh_hash", "google_sub", a.cookie]) expect(text).not.toContain(secret);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'member.export'").get()?.n).toBe(1);
    expect((await req(null, "GET", "/v1/me/export")).status).toBe(401);
  });
});

describe("back office overview", () => {
  it("any staff role sees counts and traffic lights; members do not", async () => {
    const r = await person("r", "審", ["reviewer"]);
    const m = await person("m", "會員");
    expect((await req(m, "GET", "/v1/admin/overview")).status).toBe(403);
    const o = (await (await req(r, "GET", "/v1/admin/overview")).json()) as { members: { total: number }; lights: { key: string; color: string }[]; apps: { total: number } };
    expect(o.members.total).toBe(2);
    expect(o.apps.total).toBeGreaterThanOrEqual(1);
    expect(o.lights.map((l) => l.key)).toEqual(["apps", "reviews", "invalid_apps"]);
    expect(o.lights.every((l) => l.color === "green")).toBe(true);
  });
});
