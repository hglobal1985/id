// POST /v1/vocab/suggestions (ADR 0029): a trusted service suggests a 職稱; it waits for approval.
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import { PENDING_CAP } from "../src/db/vocab";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "vocab-submit-test" });
})();

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
let now = new Date();

async function person(sub: string, roles: string[] = []) {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name: sub }, "TW", now, "r");
  const { token: cookie, session } = await createSession(db, member.id, now);
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  const token = (await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId: member.id, sessionId: session.id, scope: "openid profile.read profile.basic.write", authTime: 0 })).access_token;
  return { id: member.id, cookie, token };
}
const admin = (p: { cookie: string }, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie: `__Host-hgid_session=${p.cookie}`, ...(method !== "GET" ? { origin: ISSUER } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }, env);
const post = (token: string | null, body: unknown, raw = false) =>
  app.request("/v1/vocab/suggestions", { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }, env);
/** The service token of the App `learn` (the owner creates its secret in the back office). */
async function serviceToken(sa: { cookie: string }, appId = "learn") {
  const secret = ((await (await admin(sa, "POST", `/v1/admin/apps/${appId}/service-secret`)).json()) as { client_secret: string }).client_secret;
  const r = await app.request("/v1/service/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: appId, client_secret: secret }) }, env);
  return ((await r.json()) as { access_token: string }).access_token;
}
const suggestions = async (m: { token: string }, q: string) => ((await (await app.request(`/v1/vocab/suggestions?pool=job_title&q=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${m.token}` } }, env)).json()) as { suggestions: string[] }).suggestions;

beforeEach(() => {
  now = new Date();
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk, WEBHOOK_SIGNING_KEY: "k" } as Env;
  app = createApp({ now: () => now });
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning','e','none','[]','openid profile.read profile.basic.write','active','x','x')").run();
});

describe("who may call it and what it accepts", () => {
  it("needs the App's service token: no token, a bad one and a member's token are all 401; only job_title is open", async () => {
    const sa = await person("sa", ["super_admin"]);
    const m = await person("m");
    const t = await serviceToken(sa);
    expect((await post(null, { pool: "job_title", value: "區域經理" })).status).toBe(401);
    expect((await post("not-a-token", { pool: "job_title", value: "區域經理" })).status).toBe(401);
    expect((await post(m.token, { pool: "job_title", value: "區域經理" })).status).toBe(401); // a member's login is not a service token
    expect((await post(null, { pool: "job_title" })).status).toBe(401); // a stranger gets 401 even with a wrong body (malformed JSON itself is a 400 for everyone)
    for (const pool of ["education_center", "occupation", "upline_diamond", "nope"]) {
      const r = await post(t, { pool, value: "x" });
      expect(r.status).toBe(403);
    }
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM vocab_terms WHERE pool != 'occupation' AND pool != 'education_center' AND pending = 1").get()?.n).toBe(0);
    const ok = await post(t, { pool: "job_title", value: "區域經理" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ pool: "job_title", value: "區域經理", created: true });
  });

  it("the value is trimmed, at most 50 characters, not empty (400); malformed bodies are 400", async () => {
    const sa = await person("sa", ["super_admin"]);
    const t = await serviceToken(sa);
    const r = await post(t, { pool: "job_title", value: "   總監  " });
    expect(await r.json()).toEqual({ pool: "job_title", value: "總監", created: true });
    expect((await post(t, { pool: "job_title", value: "   " })).status).toBe(400);
    expect((await post(t, { pool: "job_title", value: "" })).status).toBe(400);
    expect((await post(t, { pool: "job_title", value: "長".repeat(51) })).status).toBe(400);
    expect((await post(t, { pool: "job_title", value: "長".repeat(50) })).status).toBe(200);
    expect((await post(t, { pool: "job_title", value: "a\nb" })).status).toBe(400);
    expect((await post(t, { pool: "job_title" })).status).toBe(400);
    expect((await post(t, { pool: "job_title", value: 5 })).status).toBe(400);
    expect((await post(t, "{ broken", true)).status).toBe(400);
  });

  it("a spelling already there (case, full/half width) is not added again: the existing term comes back", async () => {
    const sa = await person("sa", ["super_admin"]);
    const t = await serviceToken(sa);
    expect(await (await post(t, { pool: "job_title", value: "Regional Manager" })).json()).toMatchObject({ value: "Regional Manager", created: true });
    expect(await (await post(t, { pool: "job_title", value: "regional manager" })).json()).toEqual({ pool: "job_title", value: "Regional Manager", created: false });
    expect(await (await post(t, { pool: "job_title", value: "ＲＥＧＩＯＮＡＬ　ＭＡＮＡＧＥＲ" })).json()).toMatchObject({ value: "Regional Manager", created: false });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM vocab_terms WHERE pool = 'job_title'").get()?.n).toBe(1);
    // A term members already use comes back as it is (and is not made pending).
    db.raw.prepare("INSERT INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at) VALUES ('job_title', '講師', '講師', 3, 0, 'x', 'x')").run();
    expect(await (await post(t, { pool: "job_title", value: "講師" })).json()).toEqual({ pool: "job_title", value: "講師", created: false });
    expect(db.raw.prepare("SELECT pending FROM vocab_terms WHERE pool = 'job_title' AND norm = '講師'").get()).toEqual({ pending: 0 });
  });
});

describe("approval", () => {
  it("a suggested term is invisible to members until the super admin approves it (or it is refused by deleting it)", async () => {
    const sa = await person("sa", ["super_admin"]);
    const sec = await person("sec", ["secretary"]);
    const m = await person("m");
    const t = await serviceToken(sa);
    await post(t, { pool: "job_title", value: "區域經理" });
    await post(t, { pool: "job_title", value: "亂打的詞" });
        expect(await suggestions(m, "區域")).toEqual([]); // not offered while waiting
    // It shows in the back office, marked as waiting and by which App.
    const pools = (await (await admin(sa, "GET", "/v1/admin/vocab")).json()) as { pools: { pool: string; terms: number; pending: number }[] };
    expect(pools.pools.find((p) => p.pool === "job_title")).toMatchObject({ terms: 0, pending: 2 });
    const list = (await (await admin(sa, "GET", "/v1/admin/vocab/job_title")).json()) as { terms: { term: string; pending: boolean; suggested_by: string | null }[] };
    expect(list.terms.find((x) => x.term === "區域經理")).toMatchObject({ pending: true, suggested_by: "learn" });
    // Only the super admin approves.
    expect((await admin(sec, "POST", "/v1/admin/vocab/job_title/approve", { term: "區域經理" })).status).toBe(403);
    expect((await admin(sa, "POST", "/v1/admin/vocab/job_title/approve", { term: "區域經理" })).status).toBe(200);
    expect((await admin(sa, "POST", "/v1/admin/vocab/job_title/approve", { term: "區域經理" })).status).toBe(404); // nothing waiting any more
    expect(await suggestions(m, "區域")).toEqual(["區域經理"]);
    // Refusing = deleting: it never appears.
    expect((await admin(sa, "POST", "/v1/admin/vocab/job_title/delete", { term: "亂打的詞" })).status).toBe(200);
    expect(await suggestions(m, "亂打")).toEqual([]);
    // A member who types the same word before approval does not bypass the check.
    await post(t, { pool: "job_title", value: "副理" });
    await app.request("/v1/me/profile/fields/job_title", { method: "PUT", headers: { authorization: `Bearer ${m.token}`, "content-type": "application/json" }, body: JSON.stringify({ value: ["副理"] }) }, env);
    expect(await suggestions(m, "副理")).not.toContain("副理"); // (any typed character matches, so 區域經理 may show; the waiting word itself must not)
    // An administrator who merges into a waiting term approves the result.
    await post(t, { pool: "job_title", value: "經理人" });
    await admin(sa, "POST", "/v1/admin/vocab/job_title/merge", { froms: ["副理"], into: "經理人" });
    expect(await suggestions(m, "經理")).toContain("經理人");
  });

  it("every new term is audited with the App, the time and the word; a repeat is not a new addition", async () => {
    const sa = await person("sa", ["super_admin"]);
    const t = await serviceToken(sa);
    await post(t, { pool: "job_title", value: "區域經理" });
    await post(t, { pool: "job_title", value: "區域經理" });
    const rows = db.raw.prepare("SELECT actor_type, actor_id, app_id, target_id, result, occurred_at, detail FROM audit_log WHERE action = 'vocab.suggest'").all() as { actor_type: string; actor_id: string; app_id: string; target_id: string; result: string; occurred_at: string; detail: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_type: "app", actor_id: "learn", app_id: "learn", target_id: "job_title", result: "success" });
    expect(rows[0]!.occurred_at).toMatch(/\+08:00$/);
    expect(JSON.parse(rows[0]!.detail)).toEqual({ pool: "job_title", term: "區域經理" });
    await admin(sa, "POST", "/v1/admin/vocab/job_title/approve", { term: "區域經理" });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'vocab.approve'").get()?.n).toBe(1);
  });
});

describe("limits", () => {
  it("at most 200 terms wait for approval (429); approving frees room; the per-minute limit uses the write limiter", async () => {
    const sa = await person("sa", ["super_admin"]);
    const t = await serviceToken(sa);
    const ins = db.raw.prepare("INSERT INTO vocab_terms (pool, norm, term, uses, hglobal, pending, suggested_by, created_at, updated_at) VALUES ('job_title', ?, ?, 0, 0, 1, 'learn', 'x', 'x')");
    for (let i = 0; i < PENDING_CAP; i++) ins.run("t" + i, "t" + i);
    const full = await post(t, { pool: "job_title", value: "第二百零一個" });
    expect(full.status).toBe(429);
    expect(((await full.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect((await post(t, { pool: "job_title", value: "t5" })).status).toBe(200); // a word already waiting is just returned
    await admin(sa, "POST", "/v1/admin/vocab/job_title/approve", { term: "t1" });
    expect((await post(t, { pool: "job_title", value: "第二百零一個" })).status).toBe(200);
    await admin(sa, "POST", "/v1/admin/vocab/job_title/approve", { term: "t2" });
    await admin(sa, "POST", "/v1/admin/vocab/job_title/approve", { term: "t3" });
    // The per-minute limit (a Workers Rate Limiting binding; here a stub that refuses the 2nd call).
    let calls = 0;
    const limited = { ...env, RL_WRITE: { limit: async () => ({ success: ++calls <= 1 }) } } as Env;
    const call = (v: string) => app.request("/v1/vocab/suggestions", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ pool: "job_title", value: v }) }, limited);
    expect((await call("甲")).status).toBe(200);
    const r = await call("乙");
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });
});
