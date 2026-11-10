import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { clearAppCache } from "../src/db/apps";
import { importSigningKey, signJwt, verifyJwt } from "../src/lib/jwt";
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, resetGoogleKeyCache } from "../src/auth/google";
import { AppDefinitionError, allowedReturn, definitionFromForm, parseApp } from "../src/apps/registry";
import { HANDOFF_UPDATED, HANDOFF_VERSION, HANDOFF_VERSION_PATTERN, buildHandoff, isUpToDate } from "../src/apps/handoff";
import type { Env } from "../src/env";
import { createHash } from "node:crypto";

const ISSUER = "https://id.test.example";
const GOOGLE_CLIENT = "google-client";

async function newPrivateJwk(kid: string): Promise<string> {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid });
}
const jwk = await newPrivateJwk("apps-test");
const ourKey = await importSigningKey(jwk);
const googleKey = await importSigningKey(await newPrivateJwk("google-1"));
const otherKey = await importSigningKey(await newPrivateJwk("google-1"));

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
let now: Date;
let exchanges: Record<string, string>[] = [];
const fetchStub: typeof fetch = async (input, init) => {
  if (String(input) === GOOGLE_TOKEN_URL) {
    const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
    exchanges.push(body);
    if (body.code !== "good-code" || body.client_secret !== "x") return new Response("bad", { status: 400 });
    return Response.json({ id_token: "ID.TOKEN.VALUE" });
  }
  if (String(input) === GOOGLE_JWKS_URL) return Response.json({ keys: [googleKey.publicJwk] }, { headers: { "cache-control": "max-age=3600" } });
  throw new Error(`unexpected fetch ${String(input)}`);
};

beforeEach(() => {
  now = new Date("2026-11-10T10:00:00Z");
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk, GOOGLE_CLIENT_ID: `${GOOGLE_CLIENT}\n`, GOOGLE_CLIENT_SECRET: "x" };
  app = createApp({ now: () => now, fetch: fetchStub });
  clearAppCache();
  resetGoogleKeyCache();
  exchanges = [];
});

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, env);
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers }, env);
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const errorCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
const later = (seconds: number) => {
  now = new Date(now.getTime() + seconds * 1000);
};

async function googleIdToken(nonce: string, over: Record<string, unknown> = {}, key = googleKey): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return signJwt({ iss: "https://accounts.google.com", aud: GOOGLE_CLIENT, sub: "g-1", email: "m@example.com", email_verified: true, name: "測試會員", iat, exp: iat + 3600, nonce, ...over }, key);
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  scope: string;
  user: { member_id: string; is_new: boolean };
}

async function signIn(appId = "learn", over: Record<string, unknown> = {}): Promise<Tokens> {
  const { nonce } = (await (await post("/v1/auth/nonce", { app_id: appId })).json()) as { nonce: string };
  const r = await post("/v1/auth/google", { app_id: appId, id_token: await googleIdToken(sha256Hex(nonce), over), nonce, device_label: "iPhone" });
  expect(r.status).toBe(200);
  return (await r.json()) as Tokens;
}

async function staff(sub: string, roles: string[], authAgoSeconds = 0) {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name: sub }, "TW", now, "req");
  const { token } = await createSession(db, member.id, new Date(now.getTime() - authAgoSeconds * 1000));
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  return { id: member.id, cookie: token };
}
const admin = (p: { cookie: string }, method: string, path: string, body?: unknown) =>
  app.request(
    path,
    {
      method,
      headers: { cookie: `__Host-hgid_session=${p.cookie}`, ...(method !== "GET" ? { origin: ISSUER } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    env,
  );

describe("registry rules", () => {
  it("derives the three platforms from the app_id (H-Global1985 format)", () => {
    const a = definitionFromForm({ app_id: "my-app", name: " 我的 App " }, { defaults: true });
    expect(a).toMatchObject({
      app_id: "my-app",
      name: "我的 App",
      ios_bundle_id: "com.hglobal1985.myapp",
      android_package: "com.hglobal1985.myapp",
      web_origins: ["https://my-app.hglobal1985.com"],
      return_urls: ["myapp://auth/google"],
      scopes: ["profile.read", "amway.read"],
      status: "active",
      min_version: "0.0.0",
    });
  });

  it("rejects bad definitions", () => {
    const base = { app_id: "ok", name: "n", status: "active", scopes: [], min_version: "1.0.0" };
    expect(parseApp(base).app_id).toBe("ok");
    for (const bad of [
      { ...base, app_id: "Bad" },
      { ...base, app_id: "central" },
      { ...base, name: "" },
      { ...base, status: "gone" },
      { ...base, min_version: "1.0" },
      { ...base, scopes: ["openid"] },
      { ...base, scopes: ["everything"] },
      { ...base, web_origins: ["http://a.example.com"] },
      { ...base, web_origins: ["https://a.example.com/path"] },
      { ...base, return_urls: ["https://a.example.com/x"] },
      { ...base, return_urls: ["javascript://x"] },
      { ...base, ios_bundle_id: "no spaces allowed" },
    ]) {
      expect(() => parseApp(bad)).toThrow(AppDefinitionError);
    }
  });

  it("only returns to registered deep links or pages on registered web origins", () => {
    const a = definitionFromForm({ app_id: "learn", name: "x" }, { defaults: true });
    expect(allowedReturn(a, "learn://auth/google")).toBe("deep_link");
    expect(allowedReturn(a, "https://learn.hglobal1985.com/auth/done")).toBe("web");
    expect(allowedReturn(a, "https://learn.hglobal1985.com/auth/done#x")).toBeNull();
    expect(allowedReturn(a, "https://learn.hglobal1985.com.evil.example/auth")).toBeNull();
    expect(allowedReturn(a, "https://user@learn.hglobal1985.com/")).toBeNull();
    expect(allowedReturn(a, "other://auth/google")).toBeNull();
  });

  it("the migration registers 寰宇行動大學 as app_id learn", async () => {
    const r = await get("/v1/apps/learn/config");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ app_id: "learn", status: "active", min_version: "0.0.0", config: {} });
    expect(await errorCode(await get("/v1/apps/nope/config"))).toBe("app_not_found");
    const row = db.raw.prepare("SELECT definition FROM registered_apps WHERE app_id = 'learn'").get() as { definition: string };
    expect(parseApp(JSON.parse(row.definition))).toMatchObject({ name: "寰宇行動大學", ios_bundle_id: "com.hglobal1985.learn", web_origins: ["https://learn.hglobal1985.com"] });
  });
});

describe("handoff text", () => {
  // Changing the text without bumping the version fails here: update HANDOFF_VERSION, HANDOFF_UPDATED and this digest together.
  it("is versioned", () => {
    const text = buildHandoff(definitionFromForm({ app_id: "learn", name: "寰宇行動大學" }, { defaults: true }), "https://id.hglobal1985.com");
    expect(HANDOFF_VERSION).toMatch(HANDOFF_VERSION_PATTERN);
    expect(HANDOFF_VERSION > "2026-11-10.1").toBe(true);
    expect(text.startsWith(`【串接指令版本 ${HANDOFF_VERSION}｜更新時間 ${HANDOFF_UPDATED}】`)).toBe(true);
    expect({ version: HANDOFF_VERSION, digest: sha256Hex(text).slice(0, 16) }).toEqual({ version: "2026-11-10.2", digest: "0d23f1462a6048c2" });
    expect(isUpToDate(HANDOFF_VERSION)).toBe(true);
    expect(isUpToDate("2026-11-10.1")).toBe(false);
    expect(isUpToDate(null)).toBe(false);
  });

  it("has the H-Global1985 rules and no secrets or other-system brand names", () => {
    const text = buildHandoff(definitionFromForm({ app_id: "learn", name: "寰宇行動大學" }, { defaults: true }), "https://id.hglobal1985.com");
    for (const must of ["只補差異", "/v1/eligibility/check", "check-batch", "amway.read", "/v1/amway/field-definitions", "最多快取 1 日", "Fail closed", "Amway 資料不得被 App 保存", "starry.phd、H-Global1985、Amway", "https://id.hglobal1985.com/auth/google/start?app_id=learn", "learn://auth/google"]) {
      expect(text).toContain(must);
    }
    for (const never of ["繁星", "安麗", "Battery", "電池", "Passkey", "Apple"]) expect(text).not.toContain(never);
  });
});

describe("app sign-in", () => {
  it("nonce → Google ID token → tokens that work on the /v1 APIs", async () => {
    const t = await signIn();
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: 900, refresh_expires_in: 2592000, scope: "profile.read amway.read", user: { is_new: true } });
    const claims = await verifyJwt(t.access_token, [ourKey.publicJwk], { issuer: ISSUER, audience: ISSUER, typ: "at+jwt", now: Math.floor(now.getTime() / 1000) });
    expect(claims).toMatchObject({ sub: t.user.member_id, app_id: "learn", client_id: "learn" });
    expect((await get("/v1/me/profile", bearer(t.access_token))).status).toBe(200);
    expect((await post("/v1/eligibility/check", { rule: { audience: "everyone" } }, bearer(t.access_token))).status).toBe(200);
    // Scopes come from the registration: learn cannot write the profile.
    const w = await app.request("/v1/me/profile/fields/display_name", { method: "PUT", headers: { ...bearer(t.access_token), "content-type": "application/json" }, body: JSON.stringify({ value: "x" }) }, env);
    expect(w.status).toBe(403);
    // Account-level pages stay on the member site, and back-office APIs never accept App tokens.
    expect((await post("/v1/me/deletion-requests", { scope: "account" }, bearer(t.access_token))).status).toBe(403);
    expect((await get("/v1/admin/apps", bearer(t.access_token))).status).toBe(401);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM member_apps WHERE app_id = 'learn'").get()).toEqual({ n: 1 });
    expect((await signIn()).user).toEqual({ member_id: t.user.member_id, status: "active", is_new: false });
  });

  it("accepts a raw nonce in the ID token too, and refuses every wrong token with one answer", async () => {
    const nonceOf = async () => ((await (await post("/v1/auth/nonce", { app_id: "learn" })).json()) as { nonce: string }).nonce;
    let n = await nonceOf();
    expect((await post("/v1/auth/google", { app_id: "learn", id_token: await googleIdToken(n), nonce: n })).status).toBe(200);
    // A nonce works once.
    expect(await errorCode(await post("/v1/auth/google", { app_id: "learn", id_token: await googleIdToken(n), nonce: n }))).toBe("invalid_nonce");
    n = await nonceOf();
    const wrong: [string, Promise<string>][] = [
      ["audience", googleIdToken(sha256Hex(n), { aud: "someone-else" })],
      ["issuer", googleIdToken(sha256Hex(n), { iss: "https://evil.example" })],
      ["expired", googleIdToken(sha256Hex(n), { exp: Math.floor(now.getTime() / 1000) - 600 })],
      ["signature", googleIdToken(sha256Hex(n), {}, otherKey)],
      ["nonce", googleIdToken(sha256Hex("another-nonce-value-0000"))],
    ];
    for (const [, token] of wrong) {
      const r = await post("/v1/auth/google", { app_id: "learn", id_token: await token, nonce: n });
      expect(r.status).toBe(401);
      expect(await errorCode(r)).toBe("invalid_token");
    }
    // A nonce is bound to its App and expires after 10 minutes.
    db.raw.prepare("INSERT INTO registered_apps (app_id, definition, created_at, updated_at) VALUES ('other', ?, 'x', 'x')").run(JSON.stringify({ app_id: "other", name: "o", status: "active", scopes: [], min_version: "0.0.0" }));
    clearAppCache();
    expect(await errorCode(await post("/v1/auth/google", { app_id: "other", id_token: await googleIdToken(sha256Hex(n)), nonce: n }))).toBe("invalid_nonce");
    later(601);
    expect(await errorCode(await post("/v1/auth/google", { app_id: "learn", id_token: await googleIdToken(sha256Hex(n)), nonce: n }))).toBe("invalid_nonce");
    expect(await errorCode(await post("/v1/auth/nonce", { app_id: "nope" }))).toBe("app_not_found");
  });

  it("fails closed without the Google client or signing key, and for disabled members", async () => {
    const { nonce } = (await (await post("/v1/auth/nonce", { app_id: "learn" })).json()) as { nonce: string };
    const token = await googleIdToken(sha256Hex(nonce));
    const r = await app.request("/v1/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: "learn", id_token: token, nonce }) }, { ...env, GOOGLE_CLIENT_ID: undefined });
    expect(r.status).toBe(503);
    const t = await signIn();
    db.raw.prepare("UPDATE members SET status = 'disabled' WHERE id = ?").run(t.user.member_id);
    expect((await get("/v1/me/profile", bearer(t.access_token))).status).toBe(401);
    expect(await errorCode(await post("/v1/auth/refresh", { refresh_token: t.refresh_token }))).toBe("account_disabled");
    const again = await post("/v1/auth/nonce", { app_id: "learn" });
    const n2 = ((await again.json()) as { nonce: string }).nonce;
    expect(await errorCode(await post("/v1/auth/google", { app_id: "learn", id_token: await googleIdToken(sha256Hex(n2)), nonce: n2 }))).toBe("account_disabled");
  });

  it("rotates refresh tokens and revokes the session when an old one is reused", async () => {
    const t = await signIn();
    later(60);
    const r1 = await post("/v1/auth/refresh", { refresh_token: t.refresh_token });
    expect(r1.status).toBe(200);
    const t1 = (await r1.json()) as Tokens;
    expect(t1.refresh_token).not.toBe(t.refresh_token);
    expect((await get("/v1/me/profile", bearer(t1.access_token))).status).toBe(200);
    // Reuse of the rotated token: the whole session is revoked, including the newest tokens.
    expect(await errorCode(await post("/v1/auth/refresh", { refresh_token: t.refresh_token }))).toBe("refresh_reused");
    expect(await errorCode(await post("/v1/auth/refresh", { refresh_token: t1.refresh_token }))).toBe("invalid_refresh");
    expect((await get("/v1/me/profile", bearer(t1.access_token))).status).toBe(401);
    expect(db.raw.prepare("SELECT action, result FROM audit_log WHERE action = 'app.refresh_reuse'").get()).toEqual({ action: "app.refresh_reuse", result: "denied" });
    for (const bad of ["", "x", "not-a-session.secret", `${"0".repeat(8)}-0000-7000-8000-${"0".repeat(12)}.${"a".repeat(43)}`]) {
      expect(await errorCode(await post("/v1/auth/refresh", { refresh_token: bad }))).toBe("invalid_refresh");
    }
  });

  it("access tokens last 15 minutes and refresh tokens 30 days", async () => {
    const t = await signIn();
    later(15 * 60 + 31);
    expect((await get("/v1/me/profile", bearer(t.access_token))).status).toBe(401);
    later(30 * 24 * 3600);
    expect(await errorCode(await post("/v1/auth/refresh", { refresh_token: t.refresh_token }))).toBe("invalid_refresh");
  });

  it("logout ends one session; logout-all ends every session of the member", async () => {
    const a = await signIn();
    const b = await signIn();
    expect((await post("/v1/auth/logout", {}, bearer(a.access_token))).status).toBe(204);
    expect((await get("/v1/me/profile", bearer(a.access_token))).status).toBe(401);
    expect(await errorCode(await post("/v1/auth/refresh", { refresh_token: a.refresh_token }))).toBe("invalid_refresh");
    expect((await get("/v1/me/profile", bearer(b.access_token))).status).toBe(200);
    const { token: cookie } = await createSession(db, b.user.member_id, now);
    expect((await post("/v1/auth/logout-all", {}, bearer(b.access_token))).status).toBe(204);
    expect((await get("/v1/me/profile", bearer(b.access_token))).status).toBe(401);
    expect((await get("/v1/me/profile", { cookie: `__Host-hgid_session=${cookie}` })).status).toBe(401);
    expect((await post("/v1/auth/logout", {})).status).toBe(401);
  });
});

describe("status switch", () => {
  it("pausing an App stops sign-in, refresh and its tokens within 30 seconds; active restores them", async () => {
    const sa = await staff("sa", ["super_admin"]);
    const t = await signIn();
    expect((await admin(sa, "PUT", "/v1/admin/apps/learn/status", { status: "paused", reason: "維護" })).status).toBe(200);
    expect(((await (await get("/v1/apps/learn/config")).json()) as { status: string }).status).toBe("paused");
    expect((await get("/v1/me/profile", bearer(t.access_token))).status).toBe(401);
    expect(await errorCode(await post("/v1/auth/nonce", { app_id: "learn" }))).toBe("app_unavailable");
    const r = await post("/v1/auth/refresh", { refresh_token: t.refresh_token });
    expect([r.status, await errorCode(r)]).toEqual([403, "app_unavailable"]);
    expect((await get("/auth/google/start?app_id=learn&nonce=" + "a".repeat(64) + "&return=learn%3A%2F%2Fauth%2Fgoogle")).status).toBe(403);
    expect((await admin(sa, "PUT", "/v1/admin/apps/learn/status", { status: "killed" })).status).toBe(200);
    expect(((await (await get("/v1/apps/learn/config")).json()) as { status: string }).status).toBe("killed");
    expect((await admin(sa, "PUT", "/v1/admin/apps/learn/status", { status: "active" })).status).toBe(200);
    expect((await get("/v1/me/profile", bearer(t.access_token))).status).toBe(200);
    expect((await admin(sa, "PUT", "/v1/admin/apps/nope/status", { status: "paused" })).status).toBe(404);
    expect(db.raw.prepare("SELECT action FROM audit_log WHERE action LIKE 'app.status.%' ORDER BY rowid").all().map((x) => x.action)).toEqual(["app.status.paused", "app.status.killed", "app.status.active"]);
  });

  it("a change made elsewhere is picked up after the 30-second cache", async () => {
    expect(((await (await get("/v1/apps/learn/config")).json()) as { status: string }).status).toBe("active");
    db.raw.prepare("INSERT INTO app_status_overrides (app_id, status, updated_at) VALUES ('learn', 'paused', 'x')").run();
    later(29);
    expect(((await (await get("/v1/apps/learn/config")).json()) as { status: string }).status).toBe("active");
    later(2);
    expect(((await (await get("/v1/apps/learn/config")).json()) as { status: string }).status).toBe("paused");
  });

  it("a damaged registration is never used", async () => {
    db.raw.prepare("UPDATE registered_apps SET definition = '{broken' WHERE app_id = 'learn'").run();
    clearAppCache();
    expect((await get("/v1/apps/learn/config")).status).toBe(404);
    const sa = await staff("sa", ["super_admin"]);
    expect(((await (await admin(sa, "GET", "/v1/admin/apps")).json()) as { invalid: string[] }).invalid).toEqual(["learn"]);
  });
});

describe("sign-in relay", () => {
  const start = (q: Record<string, string>) => get("/auth/google/start?" + new URLSearchParams(q).toString());
  const callback = (q: Record<string, string>) => get("/login/google/callback?" + new URLSearchParams(q).toString());

  it("uses the redirect URI the member site already has, and hands the ID token back to the registered return URL", async () => {
    const hash = "b".repeat(64);
    const r = await start({ app_id: "learn", nonce: hash, return: "learn://auth/google", state: "abc" });
    expect(r.status).toBe(302);
    const u = new URL(r.headers.get("location") as string);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    // No extra Google setup: the relay shares the member site's registered redirect URI.
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: GOOGLE_CLIENT, redirect_uri: `${ISSUER}/login/google/callback`, response_type: "code", nonce: hash });
    const state = u.searchParams.get("state") as string;
    const done = await callback({ code: "good-code", state });
    expect(done.status).toBe(200);
    expect(done.headers.get("cache-control")).toBe("no-store");
    expect(done.headers.get("set-cookie")).toBeNull();
    expect(await done.text()).toContain('href="learn://auth/google?id_token=ID.TOKEN.VALUE&amp;state=abc"');
    expect(exchanges[0]).toMatchObject({ grant_type: "authorization_code", client_id: GOOGLE_CLIENT, redirect_uri: `${ISSUER}/login/google/callback` });
    const denied = await callback({ error: "access_denied", state });
    expect(await denied.text()).toContain('href="learn://auth/google?error=access_denied&amp;state=abc"');
    expect(await (await callback({ code: "bad-code", state })).text()).toContain('href="learn://auth/google?error=sign_in_failed&amp;state=abc"');
    // Web pages get the result in the fragment, which never reaches a server.
    const web = await start({ app_id: "learn", nonce: hash, return: "https://learn.hglobal1985.com/auth/done", state: "s" });
    const webState = new URL(web.headers.get("location") as string).searchParams.get("state") as string;
    expect(await (await callback({ code: "good-code", state: webState })).text()).toContain('href="https://learn.hglobal1985.com/auth/done#id_token=ID.TOKEN.VALUE&amp;state=s"');
    // The state expires after 10 minutes and cannot be forged or altered; the old callback path is gone.
    later(601);
    expect((await callback({ code: "good-code", state })).status).toBe(400);
    expect((await callback({ code: "good-code", state: `${state.slice(0, -4)}AAAA` })).status).toBe(400);
    expect((await app.request("/auth/google/callback", { method: "POST" }, env)).status).toBe(404);
    // A state that is not a relay token still goes to the member site's own sign-in check.
    expect(await (await callback({ code: "good-code", state: "not-a-relay-state" })).text()).toContain("登入失敗");
  });

  it("refuses unregistered return URLs and bad parameters", async () => {
    const hash = "b".repeat(64);
    expect((await start({ app_id: "learn", nonce: hash, return: "https://evil.example/x" })).status).toBe(400);
    expect((await start({ app_id: "learn", nonce: hash, return: "evil://auth/google" })).status).toBe(400);
    expect((await start({ app_id: "nope", nonce: hash, return: "learn://auth/google" })).status).toBe(400);
    expect((await start({ app_id: "learn", nonce: "raw-nonce", return: "learn://auth/google" })).status).toBe(400);
    expect((await start({ app_id: "learn", nonce: hash, return: "learn://auth/google", state: "<script>" })).status).toBe(400);
    const noClient = await app.request("/auth/google/start?" + new URLSearchParams({ app_id: "learn", nonce: hash, return: "learn://auth/google" }).toString(), {}, { ...env, GOOGLE_CLIENT_ID: undefined });
    expect(noClient.status).toBe(503);
  });

  it("a return URL removed from the registration stops working at once", async () => {
    const sa = await staff("sa", ["super_admin"]);
    const r = await start({ app_id: "learn", nonce: "b".repeat(64), return: "https://learn.hglobal1985.com/auth/done" });
    const state = new URL(r.headers.get("location") as string).searchParams.get("state") as string;
    expect((await admin(sa, "PUT", "/v1/admin/apps/learn", { name: "寰宇行動大學", web_origins: ["https://new.hglobal1985.com"], return_urls: ["learn://auth/google"] })).status).toBe(200);
    expect((await callback({ code: "good-code", state })).status).toBe(400);
  });
});

describe("back office", () => {
  it("only the super admin registers and edits; the secretary operates; reviewers see nothing", async () => {
    const sa = await staff("sa", ["super_admin"]);
    const sec = await staff("sec", ["secretary"]);
    const rv = await staff("rv", ["reviewer"]);
    expect((await admin(rv, "GET", "/v1/admin/apps")).status).toBe(403);
    expect((await admin(sec, "POST", "/v1/admin/apps", { app_id: "shop", name: "商店" })).status).toBe(403);
    expect((await admin(sec, "PUT", "/v1/admin/apps/learn", { name: "x" })).status).toBe(403);
    expect((await admin(sec, "PUT", "/v1/admin/apps/learn/status", { status: "paused" })).status).toBe(200);
    expect((await admin(sec, "GET", "/v1/admin/apps/learn/handoff")).status).toBe(200);

    const created = await admin(sa, "POST", "/v1/admin/apps", { app_id: "shop", name: "商店" });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { app: Record<string, unknown> }).app).toMatchObject({ ios_bundle_id: "com.hglobal1985.shop", web_origins: ["https://shop.hglobal1985.com"], return_urls: ["shop://auth/google"] });
    expect(((await (await get("/v1/apps/shop/config")).json()) as { status: string }).status).toBe("active");
    expect(await errorCode(await admin(sa, "POST", "/v1/admin/apps", { app_id: "shop", name: "again" }))).toBe("app_exists");
    expect((await admin(sa, "POST", "/v1/admin/apps", { app_id: "Bad Id", name: "x" })).status).toBe(422);
    expect((await admin(sa, "POST", "/v1/admin/apps", { app_id: "ok2", name: "x", web_origins: ["http://insecure.example.com"] })).status).toBe(422);
    expect((await admin(sa, "DELETE", "/v1/admin/apps/shop")).status).toBe(404); // Apps cannot be deleted

    const list = (await (await admin(sa, "GET", "/v1/admin/apps")).json()) as { apps: { app_id: string; status: string; members: number }[]; handoff_version: string; can_manage: boolean };
    expect(list.apps.map((a) => [a.app_id, a.status])).toEqual([["learn", "paused"], ["shop", "active"]]);
    expect(list.handoff_version).toBe(HANDOFF_VERSION);
    expect(list.can_manage).toBe(true);
    expect(db.raw.prepare("SELECT action, target_id FROM audit_log WHERE action = 'app.register'").get()).toEqual({ action: "app.register", target_id: "shop" });
  });

  it("editing needs a recent sign-in, keeps the status switch, and changes scopes on the next refresh", async () => {
    const stale = await staff("old", ["super_admin"], 11 * 60);
    expect(await errorCode(await admin(stale, "PUT", "/v1/admin/apps/learn", { name: "x" }))).toBe("reauth_required");
    const sa = await staff("sa", ["super_admin"]);
    const t = await signIn();
    await admin(sa, "PUT", "/v1/admin/apps/learn/status", { status: "paused" });
    const saved = await admin(sa, "PUT", "/v1/admin/apps/learn", { name: "寰宇行動大學", ios_bundle_id: "com.hglobal1985.learn", web_origins: ["https://learn.hglobal1985.com"], return_urls: ["learn://auth/google"], scopes: ["profile.read"], min_version: "1.2.0" });
    expect(saved.status).toBe(200);
    expect(await (await get("/v1/apps/learn/config")).json()).toMatchObject({ status: "paused", min_version: "1.2.0" });
    await admin(sa, "PUT", "/v1/admin/apps/learn/status", { status: "active" });
    const t2 = (await (await post("/v1/auth/refresh", { refresh_token: t.refresh_token })).json()) as Tokens;
    expect(t2.scope).toBe("profile.read");
    expect((await post("/v1/eligibility/check", { rule: { audience: "everyone" } }, bearer(t2.access_token))).status).toBe(403);
    expect((await admin(sa, "PUT", "/v1/admin/apps/nope", { name: "x" })).status).toBe(404);
  });

  it("the App's own admin page reads the newest instructions and reports its version (super admin, own App only)", async () => {
    const t = await signIn();
    expect((await get("/v1/apps/learn/handoff", bearer(t.access_token))).status).toBe(403);
    db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, 'super_admin', 'x')").run(t.user.member_id);
    const old = (await (await get("/v1/apps/learn/handoff?integrated=2026-11-10.1", bearer(t.access_token))).json()) as { up_to_date: boolean; version: string; text: string };
    expect(old).toMatchObject({ up_to_date: false, version: HANDOFF_VERSION });
    expect(old.text).toContain(`${ISSUER}/v1/apps/learn/config`);
    const { cookie } = await staff("sa2", ["super_admin"]);
    const row = async () => ((await (await admin({ cookie }, "GET", "/v1/admin/apps")).json()) as { apps: { integrated_version: string | null; up_to_date: boolean; members: number; active_sessions: number }[] }).apps[0];
    expect(await row()).toMatchObject({ integrated_version: "2026-11-10.1", up_to_date: false, members: 1, active_sessions: 1 });
    expect(((await (await get(`/v1/apps/learn/handoff?integrated=${HANDOFF_VERSION}`, bearer(t.access_token))).json()) as { up_to_date: boolean }).up_to_date).toBe(true);
    expect(await row()).toMatchObject({ integrated_version: HANDOFF_VERSION, up_to_date: true });
    expect((await get("/v1/apps/learn/handoff?integrated=latest", bearer(t.access_token))).status).toBe(422);
    // Another App's token, the member site cookie and OIDC tokens are refused.
    db.raw.prepare("INSERT INTO registered_apps (app_id, definition, created_at, updated_at) VALUES ('other', ?, 'x', 'x')").run(JSON.stringify({ app_id: "other", name: "o", status: "active", scopes: [], min_version: "0.0.0" }));
    clearAppCache();
    expect((await get("/v1/apps/other/handoff", bearer(t.access_token))).status).toBe(403);
    expect((await get("/v1/apps/learn/handoff", { cookie: `__Host-hgid_session=${cookie}` })).status).toBe(403);
  });
});

describe("CORS for App web versions", () => {
  it("allows registered web origins with bearer tokens only", async () => {
    const pre = await app.request("/v1/auth/nonce", { method: "OPTIONS", headers: { origin: "https://learn.hglobal1985.com", "access-control-request-method": "POST" } }, env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://learn.hglobal1985.com");
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
    const ok = await post("/v1/auth/nonce", { app_id: "learn" }, { origin: "https://learn.hglobal1985.com" });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://learn.hglobal1985.com");
    const evil = await post("/v1/auth/nonce", { app_id: "learn" }, { origin: "https://evil.example" });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const adminPath = await get("/v1/admin/apps", { origin: "https://learn.hglobal1985.com" });
    expect(adminPath.headers.get("access-control-allow-origin")).toBeNull();
  });
});
