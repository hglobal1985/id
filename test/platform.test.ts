import { describe, it, expect, beforeEach, vi } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { definitionFromForm, parseApp, APP_SCOPES, AppDefinitionError } from "../src/apps/registry";
import { deliverDue, enqueueEvent, isWebhookUrl, purgeOldEvents } from "../src/db/webhooks";
import { deriveSecret, signature, nextDelaySeconds, MAX_ATTEMPTS } from "../src/webhooks/events";
import { deleteAccount } from "../src/db/deletion";
import { parseStandards, reportIntegratedVersion, appStats } from "../src/db/apps";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "platform-test" });
})();
const KEY = "test-webhook-signing-key";

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
let now = new Date();
interface P { id: string; cookie: string }

async function person(sub: string, name: string, roles: string[] = []): Promise<P> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name, email: `${sub}@example.com` }, "TW", now, "req");
  const { token } = await createSession(db, member.id, now);
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  return { id: member.id, cookie: token };
}
const req = (p: P | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, headers: { ...(p ? { cookie: `__Host-hgid_session=${p.cookie}` } : {}), ...(method !== "GET" ? { origin: ISSUER } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" }, env);
const use = (m: P, appId = "learn") => db.raw.prepare("INSERT OR IGNORE INTO member_apps (member_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, 'x', 'x')").run(m.id, appId);

beforeEach(() => {
  now = new Date();
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk, WEBHOOK_SIGNING_KEY: KEY };
  app = createApp({ now: () => now });
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning','e','none','[]','openid profile.read', 'active','x','x')").run();
});

describe("least-privilege scopes", () => {
  it("a new App is restricted to the eligibility lookup; legacy Apps keep every scope; the owner can name scopes", () => {
    expect(definitionFromForm({ app_id: "new-app", name: "n" }, { defaults: true })).toMatchObject({ scopes: ["amway.read"], scopes_restricted: true });
    const legacy = parseApp({ app_id: "old", name: "n", status: "active", min_version: "0.0.0" });
    expect(legacy).toMatchObject({ scopes: APP_SCOPES, scopes_restricted: false });
    // editing a legacy App keeps it legacy; naming scopes switches it, and unknown scopes are refused
    expect(definitionFromForm({ app_id: "old", name: "n" }, { keep: legacy })).toMatchObject({ scopes_restricted: false });
    expect(definitionFromForm({ app_id: "old", name: "n", scopes: ["amway.read", "profile.read"] }, { keep: legacy })).toMatchObject({ scopes: ["amway.read", "profile.read"], scopes_restricted: true });
    expect(() => definitionFromForm({ app_id: "old", name: "n", scopes: ["root"] }, { keep: legacy })).toThrow(AppDefinitionError);
    expect(() => definitionFromForm({ app_id: "old", name: "n", contact_purposes: ["spam"] }, { keep: legacy })).toThrow(AppDefinitionError);
  });

  it("the learn App is still legacy (nothing is tightened without the owner)", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    const r = (await (await req(sa, "GET", "/v1/admin/apps")).json()) as { apps: { app_id: string; scopes_restricted: boolean; checks: { least_scope: boolean } }[] };
    expect(r.apps.find((a) => a.app_id === "learn")).toMatchObject({ scopes_restricted: false, checks: { least_scope: false } });
  });
});

describe("webhook rules", () => {
  it("accepts https domain names only, signs with HMAC over timestamp.body, and backs off then fails", async () => {
    expect(isWebhookUrl("https://learn.example.com/hooks/hg")).toBe(true);
    for (const bad of ["http://learn.example.com/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://localhost/x", "https://user:pw@learn.example.com/x", "ftp://a.example.com"]) expect(isWebhookUrl(bad), bad).toBe(false);
    const secret = await deriveSecret(KEY, "learn", 1);
    expect(secret).not.toBe(await deriveSecret(KEY, "learn", 2));
    expect(secret).not.toBe(await deriveSecret(KEY, "other", 1));
    expect(await signature(secret, 1700000000, "{}")).toMatch(/^v1=[0-9a-f]{64}$/);
    expect([1, 2, 3, 4, 5, 6].map(nextDelaySeconds)).toEqual([60, 300, 1800, 7200, 21600, 86400]);
    expect(nextDelaySeconds(MAX_ATTEMPTS)).toBeNull();
  });

  it("queues events for the Apps a member uses (names only, merged), delivers them signed, and retries failures", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    const m = await person("m", "會員");
    use(m);
    let res = await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: "http://insecure.example.com/x" });
    expect(res.status).toBe(422);
    res = await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: "https://learn.example.com/hooks/hg" });
    expect(res.status).toBe(200);
    await req(m, "PUT", "/v1/me/profile/fields/legal_name", { value: "王小明" });
    await req(m, "PUT", "/v1/me/profile/fields/display_name", { value: "小明" });
    const rows = db.raw.prepare("SELECT type, fields, status FROM webhook_events").all();
    expect(rows).toEqual([{ type: "member.profile_changed", fields: JSON.stringify(["display_name", "legal_name"]), status: "pending" }]); // merged, names only
    expect(JSON.stringify(rows)).not.toContain("王小明");

    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    let ok = false;
    const send = async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
      return ok ? new Response(null, { status: 204 }) : new Response("", { status: 500 });
    };
    let r = await deliverDue(db, env, now, send);
    expect(r).toMatchObject({ delivered: 0, retried: 1 });
    const call = calls[0]!;
    const secret = await deriveSecret(KEY, "learn", 1);
    expect(call.headers["x-hg-signature"]).toBe(await signature(secret, Number(call.headers["x-hg-timestamp"]), call.body));
    expect(JSON.parse(call.body)).toMatchObject({ type: "member.profile_changed", app_id: "learn", member_id: m.id, fields: ["display_name", "legal_name"] });
    expect(call.headers["x-hg-event-id"]).toBe(JSON.parse(call.body).id);
    // not due yet: nothing is sent again within the first minute
    expect((await deliverDue(db, env, now, send)).retried).toBe(0);
    // due after a minute; this time the App answers 2xx
    ok = true;
    now = new Date(now.getTime() + 61_000);
    r = await deliverDue(db, env, now, send);
    expect(r.delivered).toBe(1);
    expect(db.raw.prepare("SELECT status, attempts FROM webhook_events").get()).toMatchObject({ status: "delivered", attempts: 2 });
  });

  it("gives up after the last retry and keeps the log; old events are purged", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    const m = await person("m", "會員");
    use(m);
    await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: "https://learn.example.com/hooks/hg" });
    await enqueueEvent(db, m.id, "member.profile_changed", ["bio"], now);
    const send = async () => new Response("", { status: 503 });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await deliverDue(db, env, now, send);
      now = new Date(now.getTime() + 25 * 3600 * 1000);
    }
    expect(db.raw.prepare("SELECT status, attempts, last_error FROM webhook_events").get()).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, last_error: "http_503" });
    expect(await purgeOldEvents(db, now)).toBe(0);
    now = new Date(now.getTime() + 31 * 24 * 3600 * 1000);
    expect(await purgeOldEvents(db, now)).toBe(1);
  });

  it("without WEBHOOK_SIGNING_KEY nothing is sent (the events wait), and the secret page says so", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    const m = await person("m", "會員");
    use(m);
    await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: "https://learn.example.com/hooks/hg" });
    await enqueueEvent(db, m.id, "member.deleted", null, now);
    const send = vi.fn();
    const noKey = { ...env, WEBHOOK_SIGNING_KEY: undefined } as Env;
    expect(await deliverDue(db, noKey, now, send)).toMatchObject({ paused: true, delivered: 0 });
    expect(send).not.toHaveBeenCalled();
    env = noKey;
    expect((await req(sa, "POST", "/v1/admin/apps/learn/webhook/secret", { rotate: false })).status).toBe(503);
  });

  it("the signing secret is shown only to a super admin, and rotating changes it", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    const rv = await person("rv", "審核", ["reviewer"]);
    await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: "https://learn.example.com/hooks/hg" });
    expect((await req(rv, "POST", "/v1/admin/apps/learn/webhook/secret", { rotate: false })).status).toBe(403);
    const a = (await (await req(sa, "POST", "/v1/admin/apps/learn/webhook/secret", { rotate: false })).json()) as { secret: string };
    expect(a.secret).toBe(await deriveSecret(KEY, "learn", 1));
    const b = (await (await req(sa, "POST", "/v1/admin/apps/learn/webhook/secret", { rotate: true })).json()) as { secret: string };
    expect(b.secret).toBe(await deriveSecret(KEY, "learn", 2));
    expect(JSON.stringify(db.raw.prepare("SELECT detail FROM audit_log").all())).not.toContain(b.secret);
  });

  it("deleting a member tells every App they used to delete its copy", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    const m = await person("m", "會員");
    use(m);
    await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: "https://learn.example.com/hooks/hg" });
    expect(await deleteAccount(db, m.id, now, "r")).toBe("deleted");
    expect(db.raw.prepare("SELECT type, app_id, member_id, fields FROM webhook_events").all()).toEqual([{ type: "member.deleted", app_id: "learn", member_id: m.id, fields: null }]);
  });

  it("a member who never used the App, or an App without an endpoint, queues nothing", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    const m = await person("m", "會員");
    await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: "https://learn.example.com/hooks/hg" });
    await enqueueEvent(db, m.id, "member.profile_changed", ["bio"], now); // never signed in to learn
    use(m);
    await req(sa, "PUT", "/v1/admin/apps/learn/webhook", { url: null });
    await enqueueEvent(db, m.id, "member.profile_changed", ["bio"], now);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM webhook_events").get()?.n).toBe(0);
  });
});

describe("restricted contact lookup (service credential)", () => {
  async function setup() {
    const sa = await person("sa", "管理", ["super_admin"]);
    const m = await person("m", "會員");
    use(m);
    const secret = ((await (await req(sa, "POST", "/v1/admin/apps/learn/service-secret")).json()) as { client_secret: string }).client_secret;
    const token = async (s = secret) => {
      const r = await req(null, "POST", "/v1/service/token", { app_id: "learn", client_secret: s });
      return r.status === 200 ? ((await r.json()) as { access_token: string }).access_token : null;
    };
    const lookup = async (t: string | null, ids: string[], purpose = "payment_notice") => req(null, "POST", "/v1/apps/learn/contacts/lookup", { member_ids: ids, purpose }, t ? { authorization: `Bearer ${t}` } : {});
    return { sa, m, secret, token, lookup };
  }

  it("the secret is stored as a hash, a wrong secret is refused, and the token is service-only", async () => {
    const { m, secret, token, lookup } = await setup();
    expect(JSON.stringify(db.raw.prepare("SELECT secret_hash FROM app_service_credentials").all())).not.toContain(secret);
    expect(await token("hgs_wrong")).toBeNull();
    const t = (await token())!;
    expect(t).toBeTruthy();
    // a service token is not a member token
    expect((await app.request("/v1/me/profile", { headers: { authorization: `Bearer ${t}` } }, env)).status).toBe(401);
    // no token / junk token
    expect((await lookup(null, [m.id])).status).toBe(401);
    expect((await lookup("junk", [m.id])).status).toBe(401);
  });

  it("only for an owner-approved purpose; returns the contact e-mail (own first), reports unknown members, audits without addresses", async () => {
    const { sa, m, token, lookup } = await setup();
    const t = (await token())!;
    expect((await lookup(t, [m.id])).status).toBe(403); // purpose not allowed yet
    expect((await req(sa, "PUT", "/v1/admin/apps/learn", { name: "寰宇行動大學", contact_purposes: ["payment_notice"] })).status).toBe(200);
    let r = (await (await lookup(t, [m.id, "00000000-0000-4000-8000-000000000000"])).json()) as { contacts: { member_id: string; email: string; email_verified: boolean }[]; not_found: string[] };
    expect(r.contacts).toEqual([{ member_id: m.id, email: "m@example.com", email_verified: true }]); // the verified Google address
    expect(r.not_found).toEqual(["00000000-0000-4000-8000-000000000000"]);
    await req(m, "PUT", "/v1/me/profile/fields/contact_email", { value: "own@example.org" });
    r = (await (await lookup(t, [m.id])).json()) as typeof r;
    expect(r.contacts).toEqual([{ member_id: m.id, email: "own@example.org", email_verified: false }]);
    const audit = JSON.stringify(db.raw.prepare("SELECT action, actor_type, detail FROM audit_log WHERE action = 'contacts.lookup'").all());
    expect(audit).toContain("payment_notice");
    expect(audit).not.toContain("example.org");
    expect(audit).not.toContain("m@example.com");
    // another purpose, and more than 50 ids, are refused
    expect((await lookup(t, [m.id], "course_notice")).status).toBe(403);
    expect((await lookup(t, Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`))).status).toBe(422);
  });

  it("members who never signed in to the App, and deleted members, are not returned; revoking stops new tokens", async () => {
    const { sa, m, token, lookup } = await setup();
    await req(sa, "PUT", "/v1/admin/apps/learn", { name: "寰宇行動大學", contact_purposes: ["payment_notice"] });
    const t = (await token())!;
    const stranger = await person("s", "路人");
    expect(((await (await lookup(t, [stranger.id])).json()) as { not_found: string[] }).not_found).toEqual([stranger.id]);
    await deleteAccount(db, m.id, now, "r");
    expect(((await (await lookup(t, [m.id])).json()) as { contacts: unknown[] }).contacts).toEqual([]);
    expect((await req(sa, "DELETE", "/v1/admin/apps/learn/service-secret")).status).toBe(200);
    expect(await token()).toBeNull();
  });

  it("only a super admin manages credentials", async () => {
    const rv = await person("rv", "審核", ["reviewer"]);
    expect((await req(rv, "POST", "/v1/admin/apps/learn/service-secret")).status).toBe(403);
  });
});

describe("member data for Apps (hidden fields included)", () => {
  async function setup() {
    const sa = await person("sa", "管理", ["super_admin"]);
    const m = await person("m", "會員");
    use(m);
    // the member hides everything
    await req(m, "PUT", "/v1/me/profile/fields/legal_name", { value: "王小明" });
    await req(m, "PUT", "/v1/me/profile/fields/phone", { value: "+886912345678" });
    await req(m, "PUT", "/v1/me/profile/visibility", { fields: { legal_name: "private", phone: "private", display_name: "public" } });
    await req(m, "PUT", "/v1/me/amway/enabled", { enabled: true });
    await req(m, "PUT", "/v1/me/amway/fields/education_system", { value: "其他體系" });
    const secret = ((await (await req(sa, "POST", "/v1/admin/apps/learn/service-secret")).json()) as { client_secret: string }).client_secret;
    const t = ((await (await req(null, "POST", "/v1/service/token", { app_id: "learn", client_secret: secret })).json()) as { access_token: string }).access_token;
    const lookup = (ids: string[], fields: string[], useAs = "process") => req(null, "POST", "/v1/apps/learn/members/lookup", { member_ids: ids, fields, use: useAs }, { authorization: `Bearer ${t}` });
    const allow = (fields: string[]) => req(sa, "PUT", "/v1/admin/apps/learn", { name: "寰宇行動大學", member_data_fields: fields });
    return { sa, m, lookup, allow };
  }

  it("nothing is readable until the owner allows the field for the App; then hidden fields are returned too", async () => {
    const { m, lookup, allow } = await setup();
    let r = await lookup([m.id], ["legal_name"]);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("field_not_allowed");
    expect((await allow(["legal_name", "phone", "education_system", "rank"])).status).toBe(200);
    r = await lookup([m.id], ["legal_name", "phone", "education_system", "rank"], "display");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ members: [{ member_id: m.id, fields: { legal_name: "王小明", phone: "+886912345678", education_system: "其他體系", rank: null } }], not_found: [] });
    // a field the owner did not allow is still refused, and unknown fields are invalid
    expect((await lookup([m.id], ["birthday"])).status).toBe(403);
    expect((await lookup([m.id], ["nope"])).status).toBe(422);
  });

  it("only members who signed in to the App; deleted members and strangers are not found; audit has names, not values", async () => {
    const { m, lookup, allow } = await setup();
    await allow(["legal_name"]);
    const stranger = await person("s", "路人");
    const r = (await (await lookup([m.id, stranger.id], ["legal_name"])).json()) as { members: { member_id: string }[]; not_found: string[] };
    expect(r.members.map((x) => x.member_id)).toEqual([m.id]);
    expect(r.not_found).toEqual([stranger.id]);
    const audit = JSON.stringify(db.raw.prepare("SELECT action, detail FROM audit_log WHERE action = 'members.lookup'").all());
    expect(audit).toContain("legal_name");
    expect(audit).not.toContain("王小明");
    await deleteAccount(db, m.id, now, "r");
    expect(((await (await lookup([m.id], ["legal_name"])).json()) as { members: unknown[] }).members).toEqual([]);
  });

  it("a reviewed Amway field counts only once approved; a non-Amway member gets null; more than 50 ids are refused", async () => {
    const { m, lookup, allow } = await setup();
    await allow(["rank", "education_center"]);
    db.raw.prepare("INSERT OR REPLACE INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at) VALUES (?, 'rank', '\"r03\"', NULL, 'not_required', 0, 'x')").run(m.id);
    let r = (await (await lookup([m.id], ["rank"])).json()) as { members: { fields: { rank: unknown } }[] };
    expect(r.members[0]!.fields.rank).toBeNull(); // not approved
    db.raw.prepare("UPDATE amway_field_values SET value_approved = 1 WHERE member_id = ? AND field_key = 'rank'").run(m.id);
    r = (await (await lookup([m.id], ["rank"])).json()) as typeof r;
    expect(r.members[0]!.fields.rank).toBe("r03");
    db.raw.prepare("UPDATE members SET amway_enabled = 0 WHERE id = ?").run(m.id);
    r = (await (await lookup([m.id], ["rank"])).json()) as typeof r;
    expect(r.members[0]!.fields.rank).toBeNull();
    expect((await lookup(Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), ["rank"])).status).toBe(422);
  });

  it("the platform page lists every field with its group, and only a super admin can allow fields", async () => {
    const { sa } = await setup();
    const rv = await person("rv", "審核", ["reviewer"]);
    const p = (await (await req(sa, "GET", "/v1/admin/apps/learn/platform")).json()) as { member_data_options: { key: string; label: string; group: string }[] };
    expect(p.member_data_options.map((o) => o.key)).toEqual(expect.arrayContaining(["legal_name", "phone", "birthday", "rank", "avatar", "member_number", "upline_diamond"]));
    expect(p.member_data_options.every((o) => o.label && o.group)).toBe(true);
    expect((await req(rv, "PUT", "/v1/admin/apps/learn", { name: "x", member_data_fields: ["phone"] })).status).toBe(403);
  });
});

describe("plain-language labels", () => {
  it("every scope and contact purpose has a Chinese explanation, and the platform page lists them with their codes", async () => {
    const { SCOPE_LABELS, PURPOSE_LABELS, CONTACT_PURPOSES } = await import("../src/apps/registry");
    for (const s of APP_SCOPES) expect(SCOPE_LABELS[s], s).toBeTruthy();
    for (const p of CONTACT_PURPOSES) expect(PURPOSE_LABELS[p], p).toBeTruthy();
    const sa = await person("sa", "管理", ["super_admin"]);
    const r = (await (await req(sa, "GET", "/v1/admin/apps/learn/platform")).json()) as { scope_options: { key: string; label: string }[]; contact_purpose_options: { key: string; label: string }[] };
    expect(r.scope_options.map((o) => o.key)).toEqual([...APP_SCOPES]);
    expect(r.scope_options.every((o) => /[\u4e00-\u9fff]/.test(o.label))).toBe(true);
    expect(r.contact_purpose_options.map((o) => o.key)).toEqual([...CONTACT_PURPOSES]);
  });
});

describe("back-office script", () => {
  it("the back-office page loads the shared helpers (common.js) before admin.js, because admin.js uses HG (a missing helper once made 平台設定 do nothing)", async () => {
    const { ADMIN_JS } = await import("../src/web/assets/admin");
    expect(ADMIN_JS).toMatch(/\bHG\./);
    const sa = await person("sa", "管理", ["super_admin"]);
    const html = await (await app.request("/admin", { headers: { cookie: `__Host-hgid_session=${sa.cookie}` } }, env)).text();
    expect(html.indexOf('src="/assets/common.js"')).toBeGreaterThan(-1);
    expect(html.indexOf('src="/assets/common.js"')).toBeLessThan(html.indexOf('src="/assets/admin.js"'));
  });
});

describe("standards reported by Apps", () => {
  it("keeps the last report when an App only reports a version, and ignores unknown standards", async () => {
    const sa = await person("sa", "管理", ["super_admin"]);
    await reportIntegratedVersion(db, "learn", "2026-11-12.10", sa.id, now, ["webhook", "delete_copy"]);
    await reportIntegratedVersion(db, "learn", "2026-11-12.10", sa.id, now);
    expect((await appStats(db, now)).get("learn")?.standards).toEqual(["webhook", "delete_copy"]);
    expect(parseStandards(JSON.stringify(["webhook", "bogus", 3]))).toEqual(["webhook"]);
    expect(parseStandards("not json")).toEqual([]);
  });
});
