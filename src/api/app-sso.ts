// Shared sign-in (single sign-on) across H-Global1985 Apps (ADR 0012).
//
// Device: after a member signs in to any App, that App calls /v1/auth/sso/start and keeps the returned sso_token
// in storage shared by all H-Global1985 Apps on the device (iOS keychain group). Other Apps exchange it for their
// own session, and check /status when they come to the foreground to notice a sign-out or a switch of member.
//
// Web (one browser): browsers cannot share storage across sites, so the central site keeps a cookie and each web
// version asks it by a top-level redirect:
//   /auth/sso/adopt?c=<code from POST /v1/auth/sso/web-code>&app_id&return=<App page>   after an App signs in
//   /auth/sso/check?app_id&nonce=<sha256 hex>&return=<App page>&state=                  who is signed in?
//   /auth/sso/logout?app_id&return=<App page>                                           sign out every web version
// check answers `#sso_code=…&sso_member=…&state=` (then POST /v1/auth/sso/web-exchange with the raw nonce) or
// `#sso_none=1&state=`. Only pages on the App's registered web origins can be returned to.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema } from "../errors";
import { allowedReturn, type AppEntry } from "../apps/registry";
import { consumeNonce, createAppSession, getApp } from "../db/apps";
import { adoptBrowser, createSsoCode, liveSso, liveSsoById, logoutSso, startSso, touchSso, useSsoCode, type SsoRow } from "../db/sso";
import { timingSafeEqual } from "../lib/crypto";
import { resolveIssuer } from "../oidc/config";
import { clearCookie, readCookie, writeCookie } from "../auth/cookies";
import { bearerAuth } from "./auth";
import { APP_STATE, NONCE_HASH, SignInSchema, fail, limited, resolveApp, sha256Hex, tokenPair } from "./app-auth";
import { escapeHtml } from "../web/pages";
import { SITE_CSP, sitePage } from "../web/layout";

type C = Context<AppBindings>;
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const SsoToken = z.object({ sso_token: z.string().max(200) });
export const SSO_COOKIE = "hgid_sso";
const COOKIE_MAX_AGE = 30 * 24 * 3600;

const startRoute = createRoute({
  method: "post",
  path: "/v1/auth/sso/start",
  tags: ["shared sign-in"],
  summary: "After signing in: create the shared sign-in token to keep in storage shared by all H-Global1985 Apps",
  security: [{ bearer: [] }],
  request: { body: { required: true, content: json(z.object({ previous_sso_token: z.string().max(200).optional() })) } },
  responses: { 200: { description: "Store sso_token in the shared storage", content: json(z.object({ sso_token: z.string() })) }, 401: err("unauthenticated"), 403: err("forbidden (not an App sign-in token)") },
});

const exchangeRoute = createRoute({
  method: "post",
  path: "/v1/auth/sso/exchange",
  tags: ["shared sign-in"],
  summary: "Sign in to this App with the shared sign-in token another H-Global1985 App stored on the device",
  request: { body: { required: true, content: json(z.object({ app_id: z.string().max(32), sso_token: z.string().max(200), device_label: z.string().max(80).optional() })) } },
  responses: { 200: { description: "Signed in as the same member", content: json(SignInSchema) }, 401: err("invalid_sso"), 403: err("app_unavailable"), 404: err("app_not_found"), 429: err("rate_limited"), 503: err("server_error") },
});

const statusRoute = createRoute({
  method: "post",
  path: "/v1/auth/sso/status",
  tags: ["shared sign-in"],
  summary: "Who is signed in on this device (call when the App comes to the foreground)",
  request: { body: { required: true, content: json(SsoToken) } },
  responses: { 200: { description: "active=false: signed out on this device", content: json(z.object({ active: z.boolean(), member_id: z.string().nullable() })) }, 429: err("rate_limited") },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/v1/auth/sso/logout",
  tags: ["shared sign-in"],
  summary: "Sign out of every H-Global1985 App on this device (can be repeated)",
  request: { body: { required: true, content: json(SsoToken) } },
  responses: { 204: { description: "Signed out everywhere on this device" }, 429: err("rate_limited") },
});

const webCodeRoute = createRoute({
  method: "post",
  path: "/v1/auth/sso/web-code",
  tags: ["shared sign-in"],
  summary: "Web versions: a single-use 2-minute code that lets the central site remember this browser as signed in",
  request: { body: { required: true, content: json(SsoToken) } },
  responses: { 200: { description: "Send the browser to /auth/sso/adopt?c=<code>", content: json(z.object({ code: z.string() })) }, 401: err("invalid_sso"), 429: err("rate_limited") },
});

const webExchangeRoute = createRoute({
  method: "post",
  path: "/v1/auth/sso/web-exchange",
  tags: ["shared sign-in"],
  summary: "Web versions: sign in with the code the browser got from /auth/sso/check",
  request: { body: { required: true, content: json(z.object({ app_id: z.string().max(32), code: z.string().max(200), nonce: z.string().min(16).max(128), device_label: z.string().max(80).optional() })) } },
  responses: { 200: { description: "Signed in as the member of this browser", content: json(SignInSchema) }, 401: err("invalid_sso or invalid_nonce"), 403: err("app_unavailable"), 404: err("app_not_found"), 429: err("rate_limited"), 503: err("server_error") },
});

export function registerAppSsoRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  /** Gives `a` its own session for the member of a live shared sign-in. */
  async function signInFromSso(c: C, sso: SsoRow, a: AppEntry, label: string | undefined) {
    if (!c.env.OIDC_SIGNING_JWK) return fail(c, 503, "server_error", "Sign-in is not configured");
    const now = deps.now();
    const deviceLabel = label?.replace(/\p{Cc}/gu, "").trim().slice(0, 80) || null;
    const { session, refreshToken } = await createAppSession(c.env.DB, { memberId: sso.member_id, appId: a.app_id, scope: a.scopes.join(" "), deviceLabel, requestId: c.get("requestId"), ssoId: sso.id, method: "sso" }, now);
    await touchSso(c.env.DB, sso.id, now);
    const tokens = await tokenPair(c.env, deps, resolveIssuer(c.env, c.req.url), session, refreshToken);
    return c.json({ ...tokens, user: { member_id: sso.member_id, status: "active", is_new: false } }, 200);
  }

  app.use("/v1/auth/sso/start", bearerAuth(deps));
  app.openapi(startRoute, async (c) => {
    const auth = c.get("auth");
    if (!auth.appId) return fail(c, 403, "forbidden", "Only for App sign-in tokens");
    const now = deps.now();
    const previous = await liveSso(c.env.DB, c.req.valid("json").previous_sso_token, "token", now);
    const token = await startSso(c.env.DB, { memberId: auth.memberId, sessionId: auth.sessionId, appId: auth.appId, previous, requestId: c.get("requestId") }, now);
    return c.json({ sso_token: token }, 200);
  });

  app.openapi(exchangeRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    c.header("cache-control", "no-store");
    const body = c.req.valid("json");
    const a = await resolveApp(c, deps, body.app_id);
    if (a === "unknown") return fail(c, 404, "app_not_found", "Unknown app");
    if (a === "unavailable") return fail(c, 403, "app_unavailable", "This app is not available");
    const sso = await liveSso(c.env.DB, body.sso_token, "token", deps.now());
    if (!sso) return fail(c, 401, "invalid_sso", "Please sign in again");
    return signInFromSso(c, sso, a, body.device_label);
  });

  app.openapi(statusRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    c.header("cache-control", "no-store");
    const sso = await liveSso(c.env.DB, c.req.valid("json").sso_token, "token", deps.now());
    return c.json({ active: sso !== null, member_id: sso?.member_id ?? null }, 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    const sso = await liveSso(c.env.DB, c.req.valid("json").sso_token, "token", deps.now());
    if (sso) await logoutSso(c.env.DB, sso, null, c.get("requestId"), deps.now());
    return c.body(null, 204);
  });

  app.openapi(webCodeRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    c.header("cache-control", "no-store");
    const now = deps.now();
    const sso = await liveSso(c.env.DB, c.req.valid("json").sso_token, "token", now);
    if (!sso) return fail(c, 401, "invalid_sso", "Please sign in again");
    return c.json({ code: await createSsoCode(c.env.DB, { kind: "adopt", ssoId: sso.id }, now) }, 200);
  });

  app.openapi(webExchangeRoute, async (c) => {
    const busy = await limited(c);
    if (busy) return busy as never;
    c.header("cache-control", "no-store");
    const body = c.req.valid("json");
    const now = deps.now();
    const a = await resolveApp(c, deps, body.app_id);
    if (a === "unknown") return fail(c, 404, "app_not_found", "Unknown app");
    if (a === "unavailable") return fail(c, 403, "app_unavailable", "This app is not available");
    // The code is bound to this App and to a nonce only this App instance knows, and works once.
    const code = await useSsoCode(c.env.DB, body.code, "check", now);
    if (!code || code.app_id !== a.app_id || !code.nonce_hash || !timingSafeEqual(code.nonce_hash, await sha256Hex(body.nonce))) return fail(c, 401, "invalid_sso", "Please sign in again");
    if (!(await consumeNonce(c.env.DB, body.nonce, a.app_id, now))) return fail(c, 401, "invalid_nonce", "Sign-in expired, please try again");
    const sso = await liveSsoById(c.env.DB, code.sso_id, now);
    if (!sso) return fail(c, 401, "invalid_sso", "Please sign in again");
    return signInFromSso(c, sso, a, body.device_label);
  });

  // ---------- web relay (top-level redirects; the cookie never leaves the central site) ----------

  const problem = (c: C, text: string) => {
    c.header("content-security-policy", SITE_CSP);
    c.header("cache-control", "no-store");
    return c.html(sitePage({ title: "共用登入", body: `<section class="card"><h2>共用登入</h2><p>${escapeHtml(text)}</p><p class="help">請回到 App 再試一次。</p></section>` }), 400);
  };

  /** The active App and a page on one of its registered web origins, or null. */
  async function target(c: C): Promise<{ app: AppEntry; ret: string } | null> {
    const ret = c.req.query("return") ?? "";
    const a = await getApp(c.env.DB, c.req.query("app_id"), deps.now());
    return a && a.status === "active" && allowedReturn(a, ret) === "web" ? { app: a, ret } : null;
  }

  function back(c: C, ret: string, fragment: Record<string, string>) {
    c.header("cache-control", "no-store");
    return c.redirect(`${ret}#${new URLSearchParams(fragment).toString()}`, 302);
  }

  app.get("/auth/sso/adopt", async (c) => {
    const t = await target(c);
    if (!t) return problem(c, "這個 App 沒有登記這個回傳網址。");
    const now = deps.now();
    const code = await useSsoCode(c.env.DB, c.req.query("c"), "adopt", now);
    const sso = code ? await liveSsoById(c.env.DB, code.sso_id, now) : null;
    if (!sso) return back(c, t.ret, { sso_none: "1", state: "" });
    writeCookie(c, SSO_COOKIE, await adoptBrowser(c.env.DB, sso.id), COOKIE_MAX_AGE);
    return back(c, t.ret, { sso_adopted: "1", state: "" });
  });

  app.get("/auth/sso/check", async (c) => {
    const t = await target(c);
    const nonceHash = c.req.query("nonce") ?? "";
    const state = c.req.query("state") ?? "";
    if (!t || !NONCE_HASH.test(nonceHash) || !APP_STATE.test(state)) return problem(c, "共用登入參數不正確。");
    const now = deps.now();
    const sso = await liveSso(c.env.DB, readCookie(c, SSO_COOKIE), "cookie", now);
    if (!sso) return back(c, t.ret, { sso_none: "1", state });
    const code = await createSsoCode(c.env.DB, { kind: "check", ssoId: sso.id, appId: t.app.app_id, nonceHash }, now);
    return back(c, t.ret, { sso_code: code, sso_member: sso.member_id, state });
  });

  app.get("/auth/sso/logout", async (c) => {
    const t = await target(c);
    if (!t) return problem(c, "這個 App 沒有登記這個回傳網址。");
    const sso = await liveSso(c.env.DB, readCookie(c, SSO_COOKIE), "cookie", deps.now());
    clearCookie(c, SSO_COOKIE);
    if (sso) await logoutSso(c.env.DB, sso, t.app.app_id, c.get("requestId"), deps.now());
    return back(c, t.ret, { sso_none: "1", state: "" });
  });
}
