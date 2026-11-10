// App sign-in (ADR 0011): nonce → sign-in relay (browser) → Google ID token → the App's own tokens.
// An App never holds a password or client secret. iOS, Android and the web version share one app_id.
//
//   1. POST /v1/auth/nonce {app_id}                      → single-use nonce (10 minutes, bound to the App)
//   2. GET  /auth/google/start?app_id&nonce=<sha256 hex>&return=<registered URL>&state
//      → Google → POST /auth/google/callback → back to the return URL with id_token
//      (deep link: query string; web page: URL fragment, so it never reaches a server)
//   3. POST /v1/auth/google {app_id, id_token, nonce}    → access token (15 min) + refresh token (30 days)
//   4. POST /v1/auth/refresh {refresh_token}             → rotation; reuse of the previous token revokes the session
//
// Only the nonce hash travels through the browser, so whoever intercepts the return URL cannot sign in.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings, Env } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { allowedReturn, type AppEntry } from "../apps/registry";
import { APP_REFRESH_TTL, NONCE_TTL, consumeNonce, createAppSession, getApp, issueNonce, revokeAppSession, revokeEverything, rotateAppRefresh, type AppSessionRow } from "../db/apps";
import { LIFETIME, upsertMemberByGoogle } from "../db/identity";
import { writeAudit } from "../db/audit";
import { GoogleSignInError, GOOGLE_AUTH_URL, verifyGoogleIdToken } from "../auth/google";
import { randomToken, sha256, timingSafeEqual } from "../lib/crypto";
import { JwtError, signJwt, verifyJwt } from "../lib/jwt";
import { epochSeconds } from "../lib/time";
import { allowed } from "../lib/ratelimit";
import { getSigningKeys, resolveIssuer } from "../oidc/config";
import { bearerAuth } from "./auth";
import { escapeHtml } from "../web/pages";
import { SITE_CSP, sitePage } from "../web/layout";

type C = Context<AppBindings>;
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const fail = <S extends 400 | 401 | 403 | 404 | 429 | 503>(c: C, status: S, code: string, message: string) => c.json(errorBody(code, message, c.get("requestId")), status);

const TokenPairSchema = z
  .object({
    token_type: z.literal("Bearer"),
    access_token: z.string(),
    expires_in: z.number().int().openapi({ example: 900 }),
    refresh_token: z.string().openapi({ description: "Replace the stored one every time; reusing an old one revokes the session." }),
    refresh_expires_in: z.number().int().openapi({ example: 2592000 }),
    scope: z.string().openapi({ example: "profile.read amway.read" }),
  })
  .openapi("AppTokenPair");

const SignInSchema = TokenPairSchema.extend({
  user: z.object({ member_id: z.string(), status: z.string().openapi({ example: "active" }), is_new: z.boolean() }),
}).openapi("AppSignIn");

async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The App a request names, or the reason it cannot be used. Paused and killed Apps cannot sign in. */
async function resolveApp(c: C, deps: Deps, appId: unknown): Promise<AppEntry | "unknown" | "unavailable"> {
  const app = await getApp(c.env.DB, appId, deps.now());
  if (!app) return "unknown";
  return app.status === "active" ? app : "unavailable";
}

/** Sign-in endpoints have no member yet, so they are limited per client address. */
async function limited(c: C): Promise<Response | null> {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (await allowed(c.env.RL_WRITE, `auth:${ip}`)) return null;
  c.header("retry-after", "60");
  return c.json(errorBody("rate_limited", "Too many requests", c.get("requestId"), { retry_after: 60 }), 429);
}

async function tokenPair(env: Env, deps: Deps, issuer: string, session: AppSessionRow, refreshToken: string) {
  const iat = epochSeconds(deps.now());
  const { current } = await getSigningKeys(env);
  const access = await signJwt(
    {
      iss: issuer,
      sub: session.member_id,
      aud: issuer,
      client_id: session.app_id,
      app_id: session.app_id,
      scope: session.scope,
      sid: session.id,
      auth_time: session.auth_time_epoch,
      iat,
      exp: iat + LIFETIME.accessToken,
      jti: randomToken(16),
    },
    current,
    "at+jwt",
  );
  return { token_type: "Bearer" as const, access_token: access, expires_in: LIFETIME.accessToken, refresh_token: refreshToken, refresh_expires_in: APP_REFRESH_TTL, scope: session.scope };
}

const nonceRoute = createRoute({
  method: "post",
  path: "/v1/auth/nonce",
  tags: ["app sign-in"],
  summary: "Get a single-use sign-in nonce (10 minutes, bound to the App)",
  request: { body: { required: true, content: json(z.object({ app_id: z.string().max(32).openapi({ example: "learn" }) })) } },
  responses: {
    200: { description: "Nonce. Send its SHA-256 (hex) to the sign-in relay and the raw value to POST /v1/auth/google.", content: json(z.object({ nonce: z.string(), expires_in: z.number().int() })) },
    403: err("app_unavailable"),
    404: err("app_not_found"),
    429: err("rate_limited"),
  },
});

const googleRoute = createRoute({
  method: "post",
  path: "/v1/auth/google",
  tags: ["app sign-in"],
  summary: "Sign in (or sign up) with the Google ID token returned by the sign-in relay",
  request: {
    body: {
      required: true,
      content: json(
        z.object({
          app_id: z.string().max(32).openapi({ example: "learn" }),
          id_token: z.string().min(1).max(8192),
          nonce: z.string().min(16).max(128).openapi({ description: "The raw nonce from POST /v1/auth/nonce" }),
          device_label: z.string().max(80).optional(),
        }),
      ),
    },
  },
  responses: {
    200: { description: "Signed in", content: json(SignInSchema) },
    401: err("invalid_token or invalid_nonce"),
    403: err("app_unavailable or account_disabled"),
    404: err("app_not_found"),
    429: err("rate_limited"),
    503: err("server_error (sign-in is not configured)"),
  },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/v1/auth/refresh",
  tags: ["app sign-in"],
  summary: "Rotate tokens; reusing an old refresh token revokes the session",
  request: { body: { required: true, content: json(z.object({ refresh_token: z.string().max(200) })) } },
  responses: {
    200: { description: "New token pair; replace the stored refresh token", content: json(TokenPairSchema) },
    401: err("invalid_refresh or refresh_reused"),
    403: err("app_unavailable or account_disabled"),
    429: err("rate_limited"),
  },
});

const security = [{ bearer: [] }];
const logoutRoute = createRoute({
  method: "post",
  path: "/v1/auth/logout",
  tags: ["app sign-in"],
  summary: "End the current App session",
  security,
  responses: { 204: { description: "Signed out" }, 401: err("unauthenticated"), 403: err("forbidden (not an App sign-in token)") },
});

const logoutAllRoute = createRoute({
  method: "post",
  path: "/v1/auth/logout-all",
  tags: ["app sign-in"],
  summary: "End every session of the member: every App, every device and the member site",
  security,
  responses: { 204: { description: "All sessions ended" }, 401: err("unauthenticated"), 403: err("forbidden (not an App sign-in token)") },
});

// ---------- sign-in relay ----------

const NONCE_HASH = /^[a-f0-9]{64}$/;
const APP_STATE = /^[A-Za-z0-9._~-]{0,256}$/;
const RELAY_TYP = "relay+jwt";
const RELAY_TTL = 10 * 60;

function relayPage(c: C, title: string, body: string, status: 200 | 400 | 403 | 503 = 200, script = false) {
  c.header("content-security-policy", SITE_CSP);
  c.header("cache-control", "no-store");
  return c.html(sitePage({ title, body, script: script ? "/assets/relay.js" : undefined }), status);
}

const problem = (c: C, text: string, status: 400 | 403 | 503 = 400) =>
  relayPage(c, "Google 登入", `<section class="card"><h2>登入沒有完成</h2><p>${escapeHtml(text)}</p><p class="help">請回到 App 再試一次。</p></section>`, status);

export const RELAY_JS = 'location.replace(document.getElementById("back").href);\n';

export function registerAppAuthRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/auth/logout", bearerAuth(deps));
  app.use("/v1/auth/logout-all", bearerAuth(deps));

  app.openapi(nonceRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    c.header("cache-control", "no-store");
    const a = await resolveApp(c, deps, c.req.valid("json").app_id);
    if (a === "unknown") return fail(c, 404, "app_not_found", "Unknown app");
    if (a === "unavailable") return fail(c, 403, "app_unavailable", "This app is not available");
    return c.json({ nonce: await issueNonce(c.env.DB, a.app_id, deps.now()), expires_in: NONCE_TTL }, 200);
  });

  app.openapi(googleRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    c.header("cache-control", "no-store");
    const body = c.req.valid("json");
    const now = deps.now();
    const requestId = c.get("requestId");
    const a = await resolveApp(c, deps, body.app_id);
    if (a === "unknown") return fail(c, 404, "app_not_found", "Unknown app");
    if (a === "unavailable") return fail(c, 403, "app_unavailable", "This app is not available");
    const relayClient = c.env.GOOGLE_CLIENT_ID?.trim();
    // Fail closed: without the Google client or the signing key nothing is issued.
    if (!relayClient || !c.env.OIDC_SIGNING_JWK) return fail(c, 503, "server_error", "Sign-in is not configured");

    let identity;
    try {
      identity = await verifyGoogleIdToken({ ...deps, now: () => now }, body.id_token, [relayClient, ...a.auth.google_audiences]);
    } catch (e) {
      if (!(e instanceof GoogleSignInError)) throw e;
      await writeAudit(c.env.DB, { actorType: "app", action: "app.login", appId: a.app_id, result: "denied", requestId, detail: { reason: "id_token" } }, now);
      // One answer for every failed check, so nothing reveals which check failed.
      return fail(c, 401, "invalid_token", "Sign-in could not be verified");
    }
    // The ID token carries the nonce as sent to Google: the SHA-256 hex (relay) or the raw value (native SDKs).
    const tokenNonce = identity.nonce ?? "";
    if (!timingSafeEqual(tokenNonce, body.nonce) && !timingSafeEqual(tokenNonce, await sha256Hex(body.nonce))) {
      return fail(c, 401, "invalid_token", "Sign-in could not be verified");
    }
    if (!(await consumeNonce(c.env.DB, body.nonce, a.app_id, now))) return fail(c, 401, "invalid_nonce", "Sign-in expired, please try again");

    const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;
    const { member, created } = await upsertMemberByGoogle(c.env.DB, identity, cf?.country ?? "TW", now, requestId);
    if (member.status !== "active") {
      await writeAudit(c.env.DB, { actorType: "member", actorId: member.id, action: "app.login", appId: a.app_id, result: "denied", requestId, detail: { reason: member.status } }, now);
      return fail(c, 403, "account_disabled", "This account cannot sign in");
    }
    const label = body.device_label?.replace(/\p{Cc}/gu, "").trim().slice(0, 80) || null;
    const { session, refreshToken } = await createAppSession(c.env.DB, { memberId: member.id, appId: a.app_id, scope: a.scopes.join(" "), deviceLabel: label, requestId }, now);
    const tokens = await tokenPair(c.env, deps, resolveIssuer(c.env, c.req.url), session, refreshToken);
    return c.json({ ...tokens, user: { member_id: member.id, status: member.status, is_new: created } }, 200);
  });

  app.openapi(refreshRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    c.header("cache-control", "no-store");
    const r = await rotateAppRefresh(c.env.DB, c.req.valid("json").refresh_token, c.get("requestId"), deps.now());
    if (r.kind === "invalid") return fail(c, 401, "invalid_refresh", "Please sign in again");
    if (r.kind === "reused") return fail(c, 401, "refresh_reused", "Please sign in again");
    if (r.kind === "disabled") return fail(c, 403, "account_disabled", "This account cannot sign in");
    const a = await getApp(c.env.DB, r.session.app_id, deps.now());
    if (a?.status !== "active") return fail(c, 403, "app_unavailable", "This app is not available");
    // The App's scopes are read again on every refresh, so a registration change applies within 15 minutes.
    const session = { ...r.session, scope: a.scopes.join(" ") };
    if (session.scope !== r.session.scope) await c.env.DB.prepare("UPDATE app_sessions SET scope = ? WHERE id = ?").bind(session.scope, session.id).run();
    return c.json(await tokenPair(c.env, deps, resolveIssuer(c.env, c.req.url), session, r.refreshToken), 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const auth = c.get("auth");
    if (!auth.appId) return fail(c, 403, "forbidden", "Only for App sign-in tokens");
    await revokeAppSession(c.env.DB, { sessionId: auth.sessionId, memberId: auth.memberId, appId: auth.appId, requestId: c.get("requestId") }, deps.now());
    return c.body(null, 204);
  });

  app.openapi(logoutAllRoute, async (c) => {
    const auth = c.get("auth");
    if (!auth.appId) return fail(c, 403, "forbidden", "Only for App sign-in tokens");
    await revokeEverything(c.env.DB, { memberId: auth.memberId, appId: auth.appId, requestId: c.get("requestId") }, deps.now());
    return c.body(null, 204);
  });

  app.get("/assets/relay.js", (c) => {
    c.header("content-type", "text/javascript; charset=utf-8");
    c.header("cache-control", "no-cache");
    return c.body(RELAY_JS, 200);
  });

  // GET /auth/google/start?app_id&nonce=<sha256 hex>&return=<URL>&state=<optional>
  app.get("/auth/google/start", async (c) => {
    const now = deps.now();
    const returnUrl = c.req.query("return") ?? "";
    const nonceHash = c.req.query("nonce") ?? "";
    const appState = c.req.query("state") ?? "";
    const a = await getApp(c.env.DB, c.req.query("app_id"), now);
    if (!a || !allowedReturn(a, returnUrl)) return problem(c, "這個 App 沒有登記這個登入回傳網址。");
    if (!NONCE_HASH.test(nonceHash) || !APP_STATE.test(appState)) return problem(c, "登入參數不正確。");
    if (a.status !== "active") return problem(c, "這個 App 目前無法使用。", 403);
    const client = c.env.GOOGLE_CLIENT_ID?.trim();
    if (!client || !c.env.OIDC_SIGNING_JWK) return problem(c, "Google 登入尚未設定。", 503);
    const issuer = resolveIssuer(c.env, c.req.url);
    const iat = epochSeconds(now);
    // The state is signed (not secret): it only has to come back unchanged.
    const state = await signJwt({ iss: issuer, aud: issuer, app: a.app_id, ret: returnUrl, st: appState, iat, exp: iat + RELAY_TTL }, (await getSigningKeys(c.env)).current, RELAY_TYP);
    const u = new URL(GOOGLE_AUTH_URL);
    u.search = new URLSearchParams({
      client_id: client,
      redirect_uri: `${issuer}/auth/google/callback`,
      response_type: "id_token",
      response_mode: "form_post",
      scope: "openid email profile",
      nonce: nonceHash,
      state,
      prompt: "select_account",
    }).toString();
    c.header("cache-control", "no-store");
    return c.redirect(u.toString(), 302);
  });

  // POST /auth/google/callback — Google's cross-site form post (no cookie involved); hands the result to the App.
  app.post("/auth/google/callback", async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const field = (k: string) => (typeof form[k] === "string" ? (form[k] as string) : "");
    const issuer = resolveIssuer(c.env, c.req.url);
    let state: Record<string, unknown> | null = null;
    try {
      const raw = field("state");
      if (raw && raw.length <= 4096) state = await verifyJwt(raw, (await getSigningKeys(c.env)).publicKeys, { issuer, audience: issuer, now: epochSeconds(deps.now()), typ: RELAY_TYP, clockSkew: 0 });
    } catch (e) {
      if (!(e instanceof JwtError)) throw e;
    }
    const ret = typeof state?.ret === "string" ? state.ret : "";
    const a = state ? await getApp(c.env.DB, state.app, deps.now()) : undefined;
    // The return URL must still be registered: a registration change takes effect at once.
    const kind = a && a.status === "active" ? allowedReturn(a, ret) : null;
    if (!state || !kind) return problem(c, "登入逾時，請回到 App 再試一次。");
    const idToken = field("id_token");
    const appState = typeof state.st === "string" ? state.st : "";
    const result = new URLSearchParams(idToken ? { id_token: idToken, state: appState } : { error: (field("error") || "unknown_error").slice(0, 64), state: appState });
    const target = `${ret}${kind === "web" ? "#" : "?"}${result.toString()}`;
    return relayPage(
      c,
      "Google 登入",
      `<section class="card"><h2>${idToken ? "登入完成" : "登入未完成"}</h2><p>正在回到 App…</p><p><a id="back" href="${escapeHtml(target)}">回到 App</a></p></section>`,
      200,
      true,
    );
  });
}
