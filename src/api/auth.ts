// Authentication for /v1 APIs (shared error format). Every request is checked on the server.
// - Apps: Bearer access token (signature, expiry, sign-in session, member and app still active).
// - The central site's own pages: the sign-in session cookie, only for same-origin requests, acting as
//   the site itself (client id "central") with every member scope. Apps never get this path.
import type { Context, MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { errorBody } from "../errors";
import { resolveIssuer } from "../oidc/config";
import { checkAccessToken } from "../oidc/tokens";
import { SUPPORTED_SCOPES, hasScopes } from "../oidc/scopes";
import { SESSION_COOKIE, readCookie } from "../auth/cookies";
import { findActiveSessionByToken } from "../db/identity";
import { isSameOriginWrite } from "../auth/csrf";
import { allowed, isWrite } from "../lib/ratelimit";

export const CENTRAL_CLIENT = "central";

export function bearerAuth(deps: Deps): MiddlewareHandler<AppBindings> {
  const inner = authenticate(deps);
  return async (c, next) => {
    let passed = false;
    const res = await inner(c, async () => {
      passed = true;
    });
    if (!passed) return res;
    const write = isWrite(c.req.method, new URL(c.req.url).pathname);
    const key = `${write ? "w" : "r"}:${c.get("auth").memberId}`;
    if (!(await allowed(write ? c.env.RL_WRITE : c.env.RL_READ, key))) {
      c.header("retry-after", "60");
      return c.json(errorBody("rate_limited", "Too many requests", c.get("requestId"), { retry_after: 60 }), 429);
    }
    await next();
  };
}

function authenticate(deps: Deps): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    c.header("cache-control", "no-store");
    const authorization = c.req.header("authorization");
    if (!authorization) {
      const cookie = readCookie(c, SESSION_COOKIE);
      if (cookie) {
        if (!isSameOriginWrite(c)) return c.json(errorBody("forbidden", "Cross-site request refused", c.get("requestId")), 403);
        const s = await findActiveSessionByToken(c.env.DB, cookie, deps.now());
        if (s) {
          c.set("auth", { memberId: s.member_id, clientId: CENTRAL_CLIENT, sessionId: s.id, scope: SUPPORTED_SCOPES.join(" "), authTime: s.auth_time_epoch });
          await next();
          return;
        }
      }
    }
    const r = await checkAccessToken(c.env, deps, resolveIssuer(c.env, c.req.url), authorization);
    if (!r.ok) {
      c.header("www-authenticate", r.reason === "missing" ? 'Bearer realm="hglobal-id"' : 'Bearer realm="hglobal-id", error="invalid_token"');
      return c.json(errorBody("unauthenticated", "A valid access token is required", c.get("requestId")), 401);
    }
    c.set("auth", r.ctx);
    await next();
  };
}

/** Returns a 403 `forbidden` response when the token lacks a scope, otherwise null. */
export function missingScope(c: Parameters<MiddlewareHandler<AppBindings>>[0], scopes: string[]): Response | null {
  if (hasScopes(c.get("auth").scope, scopes)) return null;
  return c.json(errorBody("forbidden", "Insufficient scope", c.get("requestId"), { required_scopes: scopes }), 403);
}

/** Only the central site's own pages (not apps) may use account-level operations such as deletion. */
export function centralOnly(c: Context<AppBindings>): Response | null {
  if (c.get("auth").clientId === CENTRAL_CLIENT) return null;
  return c.json(errorBody("forbidden", "Only available on the member site", c.get("requestId")), 403);
}
