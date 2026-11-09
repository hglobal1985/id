// OpenID Connect provider: discovery, JWKS, authorize (code + PKCE S256), token, userinfo, logout.
// /oauth/* endpoints use the standard OAuth error shape ({ error, error_description }) required by
// RFC 6749 / 6750 so standard client libraries work; /v1 APIs keep the shared error format.
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import {
  createAuthorizationCode,
  findActiveSessionByToken,
  getActiveClient,
  redeemAuthorizationCode,
  revokeRefreshFamily,
  revokeRefreshForSessionClient,
  revokeSession,
  useRefreshToken,
  isSessionActive,
  type ClientRow,
} from "../db/identity";
import { writeAudit } from "../db/audit";
import { hashSecret, isValidCodeChallenge, timingSafeEqual, verifyPkceS256 } from "../lib/crypto";
import { JwtError, verifyJwt } from "../lib/jwt";
import { epochSeconds } from "../lib/time";
import { SESSION_COOKIE, clearCookie, readCookie } from "../auth/cookies";
import { html, redirectToLogin } from "../auth/routes";
import { messagePage } from "../web/pages";
import { getSigningKeys, resolveIssuer } from "./config";
import { SUPPORTED_SCOPES, checkRequestedScope, formatScope, hasScopes, parseScope } from "./scopes";
import { checkAccessToken, issueTokens, profileClaims } from "./tokens";
import { matchRegisteredUri, parseUriList } from "./uris";

type C = Context<AppBindings>;

function oauthError(c: C, status: 400 | 401, error: string, description: string, basicChallenge = false) {
  c.header("cache-control", "no-store");
  if (basicChallenge) c.header("www-authenticate", 'Basic realm="hglobal-id"');
  return c.json({ error, error_description: description }, status);
}

function redirectWith(c: C, redirectUri: string, params: Record<string, string | undefined>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  c.header("cache-control", "no-store");
  return c.redirect(u.toString(), 302);
}

function invalidRequestPage(c: C) {
  return html(c, messagePage("無法登入", "登入要求無效，請回到原本的 app 重新操作。"), 400);
}

async function authenticateClient(
  c: C,
  form: Record<string, string>,
): Promise<{ ok: true; client: ClientRow } | { ok: false; res: Response }> {
  let clientId = form.client_id;
  let secret: string | undefined;
  let usedBasic = false;
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Basic ")) {
    usedBasic = true;
    let decoded = "";
    try {
      decoded = atob(auth.slice(6).trim());
    } catch {
      return { ok: false, res: oauthError(c, 401, "invalid_client", "Client authentication failed", true) };
    }
    const i = decoded.indexOf(":");
    if (i < 0) return { ok: false, res: oauthError(c, 401, "invalid_client", "Client authentication failed", true) };
    try {
      const id = decodeURIComponent(decoded.slice(0, i));
      if (clientId && clientId !== id) return { ok: false, res: oauthError(c, 400, "invalid_request", "client_id mismatch") };
      clientId = id;
      secret = decodeURIComponent(decoded.slice(i + 1));
    } catch {
      return { ok: false, res: oauthError(c, 401, "invalid_client", "Client authentication failed", true) };
    }
  } else if (form.client_secret !== undefined) {
    secret = form.client_secret;
  }

  const client = await getActiveClient(c.env.DB, clientId);
  const fail = { ok: false as const, res: oauthError(c, 401, "invalid_client", "Client authentication failed", usedBasic) };
  if (!client) return fail;
  const method = client.token_endpoint_auth_method;
  if (method === "none") return secret === undefined ? { ok: true, client } : fail;
  if (method === "client_secret_basic" && !usedBasic) return fail;
  if (method === "client_secret_post" && (usedBasic || form.client_secret === undefined)) return fail;
  if (!secret || !client.client_secret_hash || !timingSafeEqual(await hashSecret(secret), client.client_secret_hash)) return fail;
  return { ok: true, client };
}

async function readForm(c: C): Promise<Record<string, string> | null> {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const params = new URLSearchParams(await c.req.text());
  const out: Record<string, string> = {};
  for (const [k, v] of params) {
    if (k in out) return null; // RFC 6749 §3.2: parameters must not be repeated
    out[k] = v;
  }
  return out;
}

export function registerOidcRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  // ---------- discovery & keys ----------
  app.get("/.well-known/openid-configuration", (c) => {
    const iss = resolveIssuer(c.env, c.req.url);
    c.header("cache-control", "public, max-age=3600");
    c.header("access-control-allow-origin", "*");
    return c.json({
      issuer: iss,
      authorization_endpoint: `${iss}/oauth/authorize`,
      token_endpoint: `${iss}/oauth/token`,
      userinfo_endpoint: `${iss}/oauth/userinfo`,
      jwks_uri: `${iss}/oauth/jwks`,
      end_session_endpoint: `${iss}/oauth/logout`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [...SUPPORTED_SCOPES],
      claims_supported: ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "sid", "azp", "name", "picture", "updated_at"],
      prompt_values_supported: ["none", "login", "consent", "select_account"],
      authorization_response_iss_parameter_supported: true,
      frontchannel_logout_supported: false,
      backchannel_logout_supported: false,
    });
  });

  app.get("/oauth/jwks", async (c) => {
    const { publicKeys } = await getSigningKeys(c.env);
    c.header("cache-control", "public, max-age=900");
    c.header("access-control-allow-origin", "*");
    return c.json({ keys: publicKeys });
  });

  // ---------- authorize ----------
  app.get("/oauth/authorize", async (c) => {
    const now = deps.now();
    const q = c.req.query();
    if (new URL(c.req.url).searchParams.getAll("client_id").length > 1) return invalidRequestPage(c);
    const client = await getActiveClient(c.env.DB, q.client_id);
    // Unknown client or unregistered redirect_uri: never redirect (open-redirect protection).
    if (!client || !matchRegisteredUri(q.redirect_uri, parseUriList(client.redirect_uris))) return invalidRequestPage(c);
    const redirectUri = q.redirect_uri as string;
    const iss = resolveIssuer(c.env, c.req.url);
    const fail = (error: string, description: string) =>
      redirectWith(c, redirectUri, { error, error_description: description, state: q.state, iss });

    if (q.request || q.request_uri) return fail("request_not_supported", "Request objects are not supported");
    if (q.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
    if (q.response_mode && q.response_mode !== "query") return fail("invalid_request", "Only response_mode=query is supported");
    const scope = checkRequestedScope(q.scope, client.allowed_scopes);
    if (!scope.ok) return fail("invalid_scope", scope.reason === "missing_openid" ? "openid scope is required" : `Scope not allowed: ${scope.scope}`);
    if (!q.code_challenge || !isValidCodeChallenge(q.code_challenge) || q.code_challenge_method !== "S256") {
      return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    if (!q.state || q.state.length > 512) return fail("invalid_request", "state is required");
    if (q.nonce !== undefined && q.nonce.length > 512) return fail("invalid_request", "nonce is too long");

    const prompts = parseScope(q.prompt);
    if (prompts.some((p) => !["none", "login", "consent", "select_account"].includes(p)) || (prompts.includes("none") && prompts.length > 1)) {
      return fail("invalid_request", "Unsupported prompt value");
    }
    let maxAge: number | undefined;
    if (q.max_age !== undefined) {
      if (!/^\d{1,9}$/.test(q.max_age)) return fail("invalid_request", "max_age must be a non-negative integer");
      maxAge = Number(q.max_age);
    }

    const cookie = readCookie(c, SESSION_COOKIE);
    const session = cookie ? await findActiveSessionByToken(c.env.DB, cookie, now) : null;
    const forceLogin = prompts.includes("login") || prompts.includes("select_account");
    const tooOld = session && maxAge !== undefined && epochSeconds(now) - session.auth_time_epoch > maxAge;

    if (!session || forceLogin || tooOld) {
      if (prompts.includes("none")) return fail("login_required", "Sign-in is required");
      // Resume this same request after sign-in, without prompt/max_age so it does not loop.
      const resume = new URL(c.req.url);
      resume.searchParams.delete("prompt");
      resume.searchParams.delete("max_age");
      return redirectToLogin(c, deps, `${resume.pathname}${resume.search}`);
    }

    // First-party apps registered by an administrator: no separate consent screen.
    const code = await createAuthorizationCode(
      c.env.DB,
      {
        client_id: client.client_id,
        member_id: session.member_id,
        session_id: session.id,
        redirect_uri: redirectUri,
        scope: formatScope(scope.scopes),
        code_challenge: q.code_challenge,
        nonce: q.nonce ?? null,
        auth_time_epoch: session.auth_time_epoch,
      },
      now,
    );
    return redirectWith(c, redirectUri, { code, state: q.state, iss });
  });

  // ---------- token ----------
  app.post("/oauth/token", async (c) => {
    const now = deps.now();
    const form = await readForm(c);
    if (!form) return oauthError(c, 400, "invalid_request", "Use application/x-www-form-urlencoded without repeated parameters");
    const auth = await authenticateClient(c, form);
    if (!auth.ok) return auth.res;
    const client = auth.client;
    const iss = resolveIssuer(c.env, c.req.url);
    c.header("cache-control", "no-store");
    c.header("pragma", "no-cache");

    if (form.grant_type === "authorization_code") {
      if (!form.code || !form.code_verifier || !form.redirect_uri) {
        return oauthError(c, 400, "invalid_request", "code, code_verifier and redirect_uri are required");
      }
      const r = await redeemAuthorizationCode(c.env.DB, form.code, now);
      if (r.kind === "replayed") {
        // Code replay: revoke what was issued from it (RFC 6749 §4.1.2).
        await revokeRefreshForSessionClient(c.env.DB, r.row.session_id, r.row.client_id, now);
        await writeAudit(c.env.DB, { actorType: "app", actorId: client.client_id, action: "oauth.code.replay", targetType: "member", targetId: r.row.member_id, result: "denied", appId: client.client_id, requestId: c.get("requestId") }, now);
        return oauthError(c, 400, "invalid_grant", "Authorization code is invalid");
      }
      if (r.kind === "invalid") return oauthError(c, 400, "invalid_grant", "Authorization code is invalid");
      const row = r.row;
      if (row.client_id !== client.client_id || row.redirect_uri !== form.redirect_uri) {
        return oauthError(c, 400, "invalid_grant", "Authorization code is invalid");
      }
      if (!(await verifyPkceS256(form.code_verifier, row.code_challenge))) return oauthError(c, 400, "invalid_grant", "PKCE verification failed");
      if (!(await isSessionActive(c.env.DB, row.session_id, row.member_id, now))) return oauthError(c, 400, "invalid_grant", "Sign-in session has ended");
      const tokens = await issueTokens(c.env, deps, iss, {
        clientId: client.client_id,
        memberId: row.member_id,
        sessionId: row.session_id,
        scope: row.scope,
        authTime: row.auth_time_epoch,
        nonce: row.nonce,
      });
      return c.json(tokens, 200);
    }

    if (form.grant_type === "refresh_token") {
      if (!form.refresh_token) return oauthError(c, 400, "invalid_request", "refresh_token is required");
      const r = await useRefreshToken(c.env.DB, form.refresh_token, now);
      if (r.kind === "reused") {
        await revokeRefreshFamily(c.env.DB, r.row.family_id, now);
        await writeAudit(c.env.DB, { actorType: "app", actorId: client.client_id, action: "oauth.refresh.reuse", targetType: "member", targetId: r.row.member_id, result: "denied", appId: client.client_id, requestId: c.get("requestId") }, now);
        return oauthError(c, 400, "invalid_grant", "Refresh token is invalid");
      }
      if (r.kind === "invalid" || r.row.client_id !== client.client_id) return oauthError(c, 400, "invalid_grant", "Refresh token is invalid");
      const row = r.row;
      if (!(await isSessionActive(c.env.DB, row.session_id, row.member_id, now))) {
        await revokeRefreshFamily(c.env.DB, row.family_id, now);
        return oauthError(c, 400, "invalid_grant", "Sign-in session has ended");
      }
      let scope = row.scope;
      if (form.scope !== undefined) {
        const asked = parseScope(form.scope);
        if (!asked.includes("openid") || !hasScopes(row.scope, asked)) return oauthError(c, 400, "invalid_scope", "Scope exceeds the original grant");
        scope = formatScope(asked);
      }
      // Scopes the client is no longer registered for are dropped.
      const allowed = new Set(parseScope(client.allowed_scopes));
      scope = formatScope(parseScope(scope).filter((s) => allowed.has(s)));
      if (!parseScope(scope).includes("openid")) return oauthError(c, 400, "invalid_scope", "openid scope is no longer allowed");
      const tokens = await issueTokens(c.env, deps, iss, {
        clientId: client.client_id,
        memberId: row.member_id,
        sessionId: row.session_id,
        scope,
        authTime: row.auth_time_epoch,
        familyId: row.family_id,
      });
      return c.json(tokens, 200);
    }

    return oauthError(c, 400, "unsupported_grant_type", "Supported: authorization_code, refresh_token");
  });

  // ---------- userinfo ----------
  const userinfo = async (c: C) => {
    const iss = resolveIssuer(c.env, c.req.url);
    const r = await checkAccessToken(c.env, deps, iss, c.req.header("authorization"));
    c.header("cache-control", "no-store");
    if (!r.ok) {
      c.header("www-authenticate", r.reason === "missing" ? 'Bearer realm="hglobal-id"' : 'Bearer realm="hglobal-id", error="invalid_token"');
      return c.json({ error: r.reason === "missing" ? "invalid_request" : "invalid_token", error_description: "A valid access token is required" }, 401);
    }
    if (!hasScopes(r.ctx.scope, ["openid"])) {
      c.header("www-authenticate", 'Bearer realm="hglobal-id", error="insufficient_scope", scope="openid"');
      return c.json({ error: "insufficient_scope", error_description: "openid scope is required" }, 403);
    }
    const body: Record<string, unknown> = { sub: r.ctx.memberId };
    if (hasScopes(r.ctx.scope, ["profile"])) Object.assign(body, await profileClaims(c.env, r.ctx.memberId));
    return c.json(body, 200);
  };
  app.get("/oauth/userinfo", userinfo);
  app.post("/oauth/userinfo", userinfo);

  // ---------- logout (RP-initiated) ----------
  app.get("/oauth/logout", async (c) => {
    const now = deps.now();
    const q = c.req.query();
    const iss = resolveIssuer(c.env, c.req.url);

    let clientId = q.client_id;
    if (q.id_token_hint) {
      try {
        const { publicKeys } = await getSigningKeys(c.env);
        const claims = await verifyJwt(q.id_token_hint, publicKeys, { issuer: iss, ignoreExpiry: true, now: epochSeconds(now) });
        const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
        if (clientId && aud !== clientId) return invalidRequestPage(c);
        clientId = typeof aud === "string" ? aud : clientId;
      } catch (e) {
        if (!(e instanceof JwtError)) throw e;
        return invalidRequestPage(c);
      }
    }

    let target: string | undefined;
    if (q.post_logout_redirect_uri) {
      const client = await getActiveClient(c.env.DB, clientId);
      if (!client || !matchRegisteredUri(q.post_logout_redirect_uri, parseUriList(client.post_logout_redirect_uris))) {
        return invalidRequestPage(c);
      }
      target = q.post_logout_redirect_uri;
    }

    const cookie = readCookie(c, SESSION_COOKIE);
    if (cookie) {
      const session = await findActiveSessionByToken(c.env.DB, cookie, now);
      if (session) {
        await revokeSession(c.env.DB, session.id, now);
        await writeAudit(c.env.DB, { actorType: "member", actorId: session.member_id, action: "member.logout", result: "success", appId: clientId ?? null, requestId: c.get("requestId") }, now);
      }
    }
    clearCookie(c, SESSION_COOKIE);
    if (target) return redirectWith(c, target, { state: q.state });
    return html(c, messagePage("已登出", "您已安全登出。", { href: "/login", label: "重新登入" }));
  });
}

