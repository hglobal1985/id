import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { base64url, hashSecret, randomToken, s256Challenge } from "../src/lib/crypto";
import { importSigningKey, signJwt, verifyJwt, type PublicJwk } from "../src/lib/jwt";
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, resetGoogleKeyCache } from "../src/auth/google";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const RP = "https://elearning.hglobal1985.com";
const REDIRECT = `${RP}/auth/callback`;
const POST_LOGOUT = `${RP}/`;
const CLIENT_SECRET = "test-client-secret-value-0123456789";
const ALL_SCOPES = "openid profile profile.read amway.read amway.write";

async function newPrivateJwk(kid: string): Promise<string> {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", privateKey)) as JsonWebKey;
  return JSON.stringify({ ...jwk, kid });
}

const providerJwk = await newPrivateJwk("test-provider-1");
const googleKey = await importSigningKey(await newPrivateJwk("google-1"));

/** Fake Google: issues an id_token for whatever identity the test sets, with the nonce from the authorize URL. */
class FakeGoogle {
  identity: Record<string, unknown> = { sub: "google-sub-1", email: "member@example.com", email_verified: true, name: "測試會員", picture: "https://lh3.googleusercontent.com/a/x" };
  lastNonce = "";
  tokenCalls = 0;
  clock = () => Date.now();
  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === GOOGLE_JWKS_URL) return Response.json({ keys: [googleKey.publicJwk] }, { headers: { "cache-control": "max-age=3600" } });
    if (url === GOOGLE_TOKEN_URL) {
      this.tokenCalls++;
      const body = new URLSearchParams(String(init?.body));
      if (body.get("code") !== "google-code" || !body.get("code_verifier")) return new Response("bad", { status: 400 });
      const now = Math.floor(this.clock() / 1000);
      const idToken = await signJwt(
        { iss: "https://accounts.google.com", aud: "google-client", iat: now, exp: now + 3600, nonce: this.lastNonce, ...this.identity },
        googleKey,
      );
      return Response.json({ id_token: idToken, access_token: "g", token_type: "Bearer" });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

class Jar {
  cookies = new Map<string, string>();
  take(res: Response) {
    for (const line of (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie()) {
      const [pair] = line.split(";");
      const i = (pair ?? "").indexOf("=");
      const name = (pair ?? "").slice(0, i);
      const value = (pair ?? "").slice(i + 1);
      if (/max-age=0/i.test(line) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

let db: TestD1;
let env: Env;
let google: FakeGoogle;
let app: ReturnType<typeof createApp>;

async function seedClients() {
  const ts = "2026-11-10T08:00:00.000+08:00";
  db.raw
    .prepare(
      `INSERT INTO oauth_clients (client_id, name, client_secret_hash, token_endpoint_auth_method, redirect_uris, post_logout_redirect_uris, allowed_scopes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run("elearning", "elearning", await hashSecret(CLIENT_SECRET), "client_secret_basic", JSON.stringify([REDIRECT]), JSON.stringify([POST_LOGOUT]), ALL_SCOPES, ts, ts);
  db.raw
    .prepare(
      `INSERT INTO oauth_clients (client_id, name, client_secret_hash, token_endpoint_auth_method, redirect_uris, post_logout_redirect_uris, allowed_scopes, status, created_at, updated_at)
       VALUES (?, ?, NULL, 'none', ?, '[]', 'openid profile', 'active', ?, ?)`,
    )
    .run("public-app", "public", JSON.stringify(["https://app.hglobal1985.com/cb"]), ts, ts);
}

beforeEach(async () => {
  db = createTestD1();
  google = new FakeGoogle();
  resetGoogleKeyCache();
  env = {
    DB: db,
    ENVIRONMENT: "test",
    ISSUER,
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    OIDC_SIGNING_JWK: providerJwk,
  };
  app = createApp({ fetch: google.fetch });
  await seedClients();
});

const req = (path: string, init: RequestInit = {}, jar?: Jar) => {
  const headers = new Headers(init.headers);
  if (jar && jar.cookies.size) headers.set("cookie", jar.header());
  return app.request(path, { ...init, headers, redirect: "manual" }, env);
};

const basic = (id: string, secret: string) => `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`;

async function authorizeUrl(extra: Record<string, string> = {}) {
  const verifier = randomToken(48);
  const params = new URLSearchParams({
    client_id: "elearning",
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: "openid profile amway.read",
    state: "rp-state-123",
    nonce: "rp-nonce-456",
    code_challenge: await s256Challenge(verifier),
    code_challenge_method: "S256",
    ...extra,
  });
  return { url: `/oauth/authorize?${params}`, verifier };
}

/** Runs the whole browser sign-in and returns the code delivered to the app. */
async function signInAndGetCode(jar: Jar, extra: Record<string, string> = {}) {
  const { url, verifier } = await authorizeUrl(extra);
  let res = await req(url, {}, jar);
  expect(res.status).toBe(302);
  jar.take(res);
  let loc = res.headers.get("location") ?? "";
  if (loc.startsWith("/login")) {
    res = await req(loc, {}, jar);
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("使用 Google 帳號登入");
    expect(page).toContain("H-Global1985");
    const start = /href="([^"]+)"/.exec(page.slice(page.indexOf("<main>")))?.[1]?.replace(/&amp;/g, "&") ?? "";
    res = await req(start, {}, jar);
    expect(res.status).toBe(302);
    const g = new URL(res.headers.get("location") ?? "");
    expect(g.origin).toBe("https://accounts.google.com");
    expect(g.searchParams.get("code_challenge_method")).toBe("S256");
    expect(g.searchParams.get("redirect_uri")).toBe(`${ISSUER}/login/google/callback`);
    google.lastNonce = g.searchParams.get("nonce") ?? "";
    res = await req(`/login/google/callback?code=google-code&state=${encodeURIComponent(g.searchParams.get("state") ?? "")}`, {}, jar);
    expect(res.status).toBe(302);
    jar.take(res);
    loc = res.headers.get("location") ?? "";
    expect(loc.startsWith("/oauth/authorize?")).toBe(true);
    res = await req(loc, {}, jar);
    expect(res.status).toBe(302);
    loc = res.headers.get("location") ?? "";
  }
  const back = new URL(loc);
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  return { code: back.searchParams.get("code") ?? "", state: back.searchParams.get("state"), iss: back.searchParams.get("iss"), back, verifier };
}

async function exchange(code: string, verifier: string, auth = basic("elearning", CLIENT_SECRET)) {
  return req("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: auth },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT }).toString(),
  });
}

async function refresh(token: string) {
  return req("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic("elearning", CLIENT_SECRET) },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }).toString(),
  });
}

describe("discovery and keys", () => {
  it("publishes the provider metadata", async () => {
    const res = await req("/.well-known/openid-configuration");
    expect(res.status).toBe(200);
    const d = (await res.json()) as Record<string, unknown>;
    expect(d.issuer).toBe(ISSUER);
    expect(d.authorization_endpoint).toBe(`${ISSUER}/oauth/authorize`);
    expect(d.token_endpoint).toBe(`${ISSUER}/oauth/token`);
    expect(d.userinfo_endpoint).toBe(`${ISSUER}/oauth/userinfo`);
    expect(d.end_session_endpoint).toBe(`${ISSUER}/oauth/logout`);
    expect(d.jwks_uri).toBe(`${ISSUER}/oauth/jwks`);
    expect(d.code_challenge_methods_supported).toEqual(["S256"]);
    expect(d.response_types_supported).toEqual(["code"]);
    expect(d.scopes_supported).toContain("amway.write");
  });

  it("JWKS contains only public key material", async () => {
    const res = await req("/oauth/jwks");
    const { keys } = (await res.json()) as { keys: Record<string, unknown>[] };
    expect(keys).toHaveLength(1);
    expect(keys[0]?.kid).toBe("test-provider-1");
    for (const k of ["d", "p", "q", "dp", "dq", "qi"]) expect(keys[0]).not.toHaveProperty(k);
  });

  it("production without ISSUER fails closed with 503", async () => {
    env = { ...env, ENVIRONMENT: "production", ISSUER: undefined };
    const res = await req("/.well-known/openid-configuration");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("server_error");
  });
});

describe("authorize", () => {
  it("never redirects to an unknown client or unregistered redirect_uri", async () => {
    const a = await authorizeUrl({ client_id: "nope" });
    let res = await req(a.url);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    const b = await authorizeUrl({ redirect_uri: "https://evil.example/cb" });
    res = await req(b.url);
    expect(res.status).toBe(400);
    const c = await authorizeUrl({ redirect_uri: `${REDIRECT}/extra` });
    res = await req(c.url);
    expect(res.status).toBe(400);
  });

  it("requires PKCE S256", async () => {
    for (const extra of [{ code_challenge_method: "plain" }, { code_challenge: "short" }] as Record<string, string>[]) {
      const { url } = await authorizeUrl(extra);
      const res = await req(url);
      const loc = new URL(res.headers.get("location") ?? "");
      expect(loc.searchParams.get("error")).toBe("invalid_request");
      expect(loc.searchParams.get("state")).toBe("rp-state-123");
    }
  });

  it("rejects scopes the client is not registered for, and requires openid", async () => {
    let res = await req((await authorizeUrl({ scope: "openid profile.spouse.write" })).url);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_scope");
    res = await req((await authorizeUrl({ scope: "profile" })).url);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_scope");
  });

  it("prompt=none without a session returns login_required", async () => {
    const res = await req((await authorizeUrl({ prompt: "none" })).url);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe("login_required");
  });

  it("rejects response_type other than code", async () => {
    const res = await req((await authorizeUrl({ response_type: "token" })).url);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("error")).toBe("unsupported_response_type");
  });
});

describe("Google sign-in and the code flow", () => {
  it("signs in with Google, issues a code, and exchanges it for tokens", async () => {
    const jar = new Jar();
    const { code, state, iss, verifier } = await signInAndGetCode(jar);
    expect(state).toBe("rp-state-123");
    expect(iss).toBe(ISSUER);
    expect(jar.cookies.has("__Host-hgid_session")).toBe(true);

    const res = await exchange(code, verifier);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const t = (await res.json()) as Record<string, string | number>;
    expect(t.token_type).toBe("Bearer");
    expect(t.expires_in).toBe(900);
    expect(t.scope).toBe("openid profile amway.read");

    const { publicKeys } = { publicKeys: [(await importSigningKey(providerJwk)).publicJwk] as PublicJwk[] };
    const idt = await verifyJwt(String(t.id_token), publicKeys, { issuer: ISSUER, audience: "elearning" });
    expect(idt.nonce).toBe("rp-nonce-456");
    expect(idt.name).toBe("測試會員");
    expect(idt).not.toHaveProperty("email");

    const member = db.raw.prepare("SELECT * FROM members").all();
    expect(member).toHaveLength(1);
    expect(member[0]?.google_sub).toBe("google-sub-1");
    expect(idt.sub).toBe(member[0]?.id);
    expect(String(member[0]?.created_at)).toMatch(/\+08:00$/);

    const ui = await req("/oauth/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } });
    expect(ui.status).toBe(200);
    const info = (await ui.json()) as Record<string, unknown>;
    expect(info.sub).toBe(member[0]?.id);
    expect(info.name).toBe("測試會員");
    expect(info).not.toHaveProperty("email");

    const actions = db.raw.prepare("SELECT action, result FROM audit_log ORDER BY rowid").all().map((r) => `${r.action}:${r.result}`);
    expect(actions).toEqual(["member.create:success", "member_number.assign:success", "member.login:success"]);
    const auditText = JSON.stringify(db.raw.prepare("SELECT * FROM audit_log").all());
    expect(auditText).not.toContain("member@example.com");
    expect(auditText).not.toContain("測試會員");
  });

  it("stores only hashes of codes, tokens and sessions", async () => {
    const jar = new Jar();
    const { code, verifier } = await signInAndGetCode(jar);
    const t = (await (await exchange(code, verifier)).json()) as Record<string, string>;
    const dump = JSON.stringify([
      db.raw.prepare("SELECT * FROM oauth_authorization_codes").all(),
      db.raw.prepare("SELECT * FROM oauth_refresh_tokens").all(),
      db.raw.prepare("SELECT * FROM login_sessions").all(),
    ]);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(String(t.refresh_token));
    expect(dump).not.toContain(jar.cookies.get("__Host-hgid_session"));
  });

  it("reuses an existing session without asking Google again", async () => {
    const jar = new Jar();
    await signInAndGetCode(jar);
    expect(google.tokenCalls).toBe(1);
    const second = await signInAndGetCode(jar);
    expect(second.code).toBeTruthy();
    expect(google.tokenCalls).toBe(1);
  });

  it("prompt=login forces a fresh Google sign-in", async () => {
    const jar = new Jar();
    await signInAndGetCode(jar);
    await signInAndGetCode(jar, { prompt: "login" });
    expect(google.tokenCalls).toBe(2);
  });

  it("binds members by Google sub only, never by email", async () => {
    await signInAndGetCode(new Jar());
    await signInAndGetCode(new Jar());
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members").get()?.n).toBe(1);
    google.identity = { ...google.identity, sub: "google-sub-2" }; // same email, different Google account
    await signInAndGetCode(new Jar());
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members").get()?.n).toBe(2);
  });

  it("rejects a callback from a different browser (login CSRF)", async () => {
    const jar = new Jar();
    const { url } = await authorizeUrl();
    let res = await req(url, {}, jar);
    jar.take(res);
    res = await req(res.headers.get("location") ?? "", {}, jar);
    const page = await res.text();
    const start = /href="([^"]+)"/.exec(page.slice(page.indexOf("<main>")))?.[1]?.replace(/&amp;/g, "&") ?? "";
    res = await req(start, {}, jar);
    const g = new URL(res.headers.get("location") ?? "");
    google.lastNonce = g.searchParams.get("nonce") ?? "";
    res = await req(`/login/google/callback?code=google-code&state=${g.searchParams.get("state")}`, {}, new Jar());
    expect(res.status).toBe(400);
    expect(google.tokenCalls).toBe(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members").get()?.n).toBe(0);
  });

  it("rejects a Google id_token with the wrong nonce", async () => {
    const jar = new Jar();
    const { url } = await authorizeUrl();
    let res = await req(url, {}, jar);
    jar.take(res);
    res = await req(res.headers.get("location") ?? "", {}, jar);
    const page = await res.text();
    const start = /href="([^"]+)"/.exec(page.slice(page.indexOf("<main>")))?.[1]?.replace(/&amp;/g, "&") ?? "";
    res = await req(start, {}, jar);
    const g = new URL(res.headers.get("location") ?? "");
    google.lastNonce = "attacker-nonce";
    res = await req(`/login/google/callback?code=google-code&state=${g.searchParams.get("state")}`, {}, jar);
    expect(res.status).toBe(400);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members").get()?.n).toBe(0);
  });

  it("disabled members cannot sign in", async () => {
    await signInAndGetCode(new Jar());
    db.raw.prepare("UPDATE members SET status = 'disabled'").run();
    const jar = new Jar();
    const { url } = await authorizeUrl();
    let res = await req(url, {}, jar);
    jar.take(res);
    res = await req(res.headers.get("location") ?? "", {}, jar);
    const page = await res.text();
    const start = /href="([^"]+)"/.exec(page.slice(page.indexOf("<main>")))?.[1]?.replace(/&amp;/g, "&") ?? "";
    res = await req(start, {}, jar);
    const g = new URL(res.headers.get("location") ?? "");
    google.lastNonce = g.searchParams.get("nonce") ?? "";
    res = await req(`/login/google/callback?code=google-code&state=${g.searchParams.get("state")}`, {}, jar);
    expect(res.status).toBe(403);
    expect(jar.cookies.has("__Host-hgid_session")).toBe(false);
  });
});

describe("token endpoint", () => {
  it("rejects a wrong code_verifier", async () => {
    const { code } = await signInAndGetCode(new Jar());
    const res = await exchange(code, randomToken(48));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("a code works once; replay is rejected and revokes its tokens", async () => {
    const { code, verifier } = await signInAndGetCode(new Jar());
    const first = (await (await exchange(code, verifier)).json()) as Record<string, string>;
    const again = await exchange(code, verifier);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_grant");
    const r = await refresh(String(first.refresh_token));
    expect(r.status).toBe(400);
  });

  it("expired codes are rejected", async () => {
    let now = new Date("2026-11-10T00:00:00Z");
    app = createApp({ fetch: google.fetch, now: () => now });
    google.clock = () => now.getTime();
    const { code, verifier } = await signInAndGetCode(new Jar());
    now = new Date(now.getTime() + 61_000);
    const res = await exchange(code, verifier);
    expect(res.status).toBe(400);
  });

  it("authenticates clients by their registered method", async () => {
    const { code, verifier } = await signInAndGetCode(new Jar());
    let res = await exchange(code, verifier, basic("elearning", "wrong-secret"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_client");
    res = await req("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: "elearning" }).toString(),
    });
    expect(res.status).toBe(401);
    res = await req("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: "public-app", client_secret: "x" }).toString(),
    });
    expect(res.status).toBe(401);
  });

  it("rejects JSON bodies and unknown grant types", async () => {
    let res = await req("/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(400);
    res = await req("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: basic("elearning", CLIENT_SECRET) },
      body: "grant_type=password",
    });
    expect(((await res.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const { code, verifier } = await signInAndGetCode(new Jar());
    const t1 = (await (await exchange(code, verifier)).json()) as Record<string, string>;
    const r2 = await refresh(String(t1.refresh_token));
    expect(r2.status).toBe(200);
    const t2 = (await r2.json()) as Record<string, string>;
    expect(t2.refresh_token).not.toBe(t1.refresh_token);
    const reuse = await refresh(String(t1.refresh_token));
    expect(reuse.status).toBe(400);
    const afterReuse = await refresh(String(t2.refresh_token));
    expect(afterReuse.status).toBe(400);
  });
});

describe("userinfo", () => {
  it("requires a valid bearer token", async () => {
    let res = await req("/oauth/userinfo");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    res = await req("/oauth/userinfo", { headers: { authorization: "Bearer not.a.jwt" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("rejects an ID token used as an access token", async () => {
    const { code, verifier } = await signInAndGetCode(new Jar());
    const t = (await (await exchange(code, verifier)).json()) as Record<string, string>;
    const res = await req("/oauth/userinfo", { headers: { authorization: `Bearer ${t.id_token}` } });
    expect(res.status).toBe(401);
  });

  it("rejects tokens signed by another key", async () => {
    const { code, verifier } = await signInAndGetCode(new Jar());
    const t = (await (await exchange(code, verifier)).json()) as Record<string, string>;
    const [h, p] = String(t.access_token).split(".");
    const forged = `${h}.${p}.${base64url(new Uint8Array(256))}`;
    const res = await req("/oauth/userinfo", { headers: { authorization: `Bearer ${forged}` } });
    expect(res.status).toBe(401);
  });
});

describe("logout", () => {
  it("ends the session for every app and redirects to a registered URI", async () => {
    const jar = new Jar();
    const { code, verifier } = await signInAndGetCode(jar);
    const t = (await (await exchange(code, verifier)).json()) as Record<string, string>;
    const res = await req(
      `/oauth/logout?${new URLSearchParams({ id_token_hint: String(t.id_token), post_logout_redirect_uri: POST_LOGOUT, state: "bye" })}`,
      {},
      jar,
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(`${loc.origin}${loc.pathname}`).toBe(POST_LOGOUT);
    expect(loc.searchParams.get("state")).toBe("bye");
    jar.take(res);
    expect(jar.cookies.has("__Host-hgid_session")).toBe(false);

    const ui = await req("/oauth/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } });
    expect(ui.status).toBe(401);
    expect((await refresh(String(t.refresh_token))).status).toBe(400);
    const actions = db.raw.prepare("SELECT action FROM audit_log").all().map((r) => r.action);
    expect(actions).toContain("member.logout");
  });

  it("does not redirect to an unregistered post_logout_redirect_uri", async () => {
    const jar = new Jar();
    const { code, verifier } = await signInAndGetCode(jar);
    const t = (await (await exchange(code, verifier)).json()) as Record<string, string>;
    const res = await req(
      `/oauth/logout?${new URLSearchParams({ id_token_hint: String(t.id_token), post_logout_redirect_uri: "https://evil.example/" })}`,
      {},
      jar,
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("without a redirect shows the signed-out page", async () => {
    const res = await req("/oauth/logout");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("已登出");
  });
});

describe("pages", () => {
  it("member-facing pages use only the H-Global1985 brand", async () => {
    const jar = new Jar();
    let res = await req("/login", {}, jar);
    jar.take(res);
    res = await req(res.headers.get("location") ?? "", {}, jar);
    const page = await res.text();
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    for (const banned of ["starry", "繁星", "寰宇", "安麗", "Echo", "回聲"]) expect(page).not.toContain(banned);
  });

  it("/login ignores unsafe return_to values", async () => {
    const jar = new Jar();
    const res = await req("/login?return_to=//evil.example/x", {}, jar);
    expect(res.status).toBe(302);
    const flow = db.raw.prepare("SELECT return_to FROM login_flows").get();
    expect(flow?.return_to).toBe("/");
  });
});
