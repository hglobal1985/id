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
    expect((await req(a, "PUT", "/v1/me/profile/fields/nickname", { value: "阿甲" })).status).toBe(200);
    expect(db.raw.prepare("SELECT app_id FROM audit_log WHERE action = 'profile.field.update'").get()?.app_id).toBe("central");
    expect((await req(a, "PUT", "/v1/me/profile/fields/nickname", { value: "x" }, { origin: "https://evil.example" })).status).toBe(403);
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
    expect(html).not.toContain("九宮格");
    expect(html).toContain("慢慢來"); // the motto is public by default
    expect(await (await req(o, "GET", `/${n}`)).text()).not.toContain('href="/me/edit"');
    // The owner sees the edit button; making things public shows them.
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: true });
    await req(a, "PUT", "/v1/me/amway/fields/upline_diamond", { value: "陳大華" });
    await req(a, "PUT", "/v1/me/amway/fields/referrer", { value: "秘密推薦人" });
    await req(a, "PUT", "/v1/me/profile/visibility", { fields: { university: "public", university_dept: "public", occupation: "public", derived: "public", upline_diamond: "public" } });
    html = await (await req(a, "GET", `/${n}`)).text();
    expect(html).toContain('href="/me/edit"');
    expect(html).toContain("大學");
    expect(html).toContain("政治大學　資訊管理學系");
    expect(html).toContain('<span class="chip">工程師</span>');
    expect(html).toContain("上手鑽石");
    expect(html).toContain("陳大華");
    expect(html).not.toContain("秘密推薦人"); // Amway fields are hidden until the member makes them public
    expect(html).toContain("彩色九宮格");
    expect(html).toContain("星座：獅子座");
    expect(html).not.toMatch(/ style="/);
    // Turning the Amway area off hides it from visitors, whatever the field switches say.
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: false });
    expect(await (await req(null, "GET", `/${n}`)).text()).not.toContain("陳大華");
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

describe("data deletion", () => {
  it("only on the member site, after a recent sign-in; can be cancelled", async () => {
    const a = await person("a", "甲");
    const t = await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId: a.id, sessionId: db.raw.prepare("SELECT id FROM login_sessions").get()?.id as string, scope: "openid profile.read", authTime: 0 });
    const viaApp = await app.request("/v1/me/deletion-requests", { method: "POST", headers: { authorization: `Bearer ${t.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ scope: "account" }) }, env);
    expect(viaApp.status).toBe(403);

    let res = await req(a, "POST", "/v1/me/deletion-requests", { scope: "amway" });
    expect(res.status).toBe(200);
    const r = (await res.json()) as { id: string; due_at: string; status: string };
    expect(r.status).toBe("requested");
    expect(Date.parse(r.due_at) - now.getTime()).toBeGreaterThan(14.9 * 86400 * 1000);
    expect((await req(a, "POST", `/v1/me/deletion-requests/${r.id}/cancel`)).status).toBe(200);

    now = new Date(now.getTime() + 11 * 60 * 1000);
    res = await req(a, "POST", "/v1/me/deletion-requests", { scope: "account" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("reauth_required");
  });

  it("an administrator carries out account deletion: anonymized, signed out, Google account released", async () => {
    const a = await person("a", "甲");
    const sec = await person("sec", "秘書", ["secretary"]);
    await req(a, "PUT", "/v1/me/profile/fields/bio", { value: "hello" });
    const r = (await (await req(a, "POST", "/v1/me/deletion-requests", { scope: "account" })).json()) as { id: string };
    const list = (await (await req(sec, "GET", "/v1/admin/deletion-requests")).json()) as { requests: { id: string; display_name: string }[] };
    expect(list.requests[0]).toMatchObject({ id: r.id, display_name: "甲" });
    const rv = await person("rv", "審核員", ["reviewer"]);
    expect((await req(rv, "POST", `/v1/admin/deletion-requests/${r.id}/complete`)).status).toBe(403);
    expect((await req(sec, "POST", `/v1/admin/deletion-requests/${r.id}/complete`)).status).toBe(200);

    const m = db.raw.prepare("SELECT status, google_sub, google_email, display_name FROM members WHERE id = ?").get(a.id);
    expect(m).toEqual({ status: "deleted", google_sub: `deleted:${a.id}`, google_email: null, display_name: null });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM profile_field_values WHERE member_id = ?").get(a.id)?.n).toBe(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM member_numbers WHERE member_id = ?").get(a.id)?.n).toBe(0);
    expect((await req(a, "GET", "/v1/me/profile")).status).toBe(401);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'deletion.complete'").get()?.n).toBe(1);
    // The same Google account can sign up again as a new member.
    const again = await upsertMemberByGoogle(db, { sub: "a", emailVerified: true }, "TW", now, "req");
    expect(again.created).toBe(true);
  });

  it("Amway deletion removes the Amway data and turns the area off", async () => {
    const a = await person("a", "甲");
    const sa = await person("sa", "超管", ["super_admin"]);
    await req(a, "PUT", "/v1/me/amway/enabled", { enabled: true });
    await req(a, "PUT", "/v1/me/amway/fields/referrer", { value: "王" });
    const r = (await (await req(a, "POST", "/v1/me/deletion-requests", { scope: "amway" })).json()) as { id: string };
    expect((await req(sa, "POST", `/v1/admin/deletion-requests/${r.id}/complete`)).status).toBe(200);
    const s = (await (await req(a, "GET", "/v1/me/amway")).json()) as { enabled: boolean; fields: { referrer: { value: unknown } } };
    expect(s.enabled).toBe(false);
    expect(s.fields.referrer.value).toBeNull();
    expect(db.raw.prepare("SELECT status FROM members WHERE id = ?").get(a.id)?.status).toBe("active");
  });
});

describe("member center template (same layout as starry.phd)", () => {
  it("shows the main menu with name and App launcher when signed in, a brand bar when not", async () => {
    const a = await person("a", "王小明");
    const me = await (await req(a, "GET", "/me/edit")).text();
    expect(me).toContain('class="starnav"');
    expect(me).toContain('href="/notifications"'); // the bell
    expect(me).toContain("王小明");
    expect(me).toContain("王小"); // initials bubble
    const bell = await (await req(a, "GET", "/privacy")).text();
    expect(bell).not.toContain('class="dot"'); // no unread notifications yet
    db.raw.prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES ('n1', ?, 'spouse.unbound', '{}', '2026-11-11T00:00:00+08:00')").run(a.id);
    expect(await (await req(a, "GET", "/privacy")).text()).toContain('<span class="dot">1</span>');
    expect(me).toContain('href="/apps"');
    expect(me).toContain('href="/logout"');
    const guest = await (await req(null, "GET", "/privacy")).text();
    expect(guest).toContain("guest-brand");
    expect(guest).not.toContain("starnav");
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
    await req(a, "PUT", "/v1/me/profile/fields/nickname", { value: "阿甲" });
    const res = await req(a, "GET", "/v1/me/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    const text = await res.text();
    const data = JSON.parse(text) as { member: { id: string }; profile: Record<string, { value: unknown }>; member_numbers: unknown[] };
    expect(data.member.id).toBe(a.id);
    expect(data.profile.nickname?.value).toBe("阿甲");
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
    expect(o.lights.map((l) => l.key)).toEqual(["apps", "reviews", "deletions", "invalid_apps"]);
    expect(o.lights.every((l) => l.color === "green")).toBe(true);
  });
});
