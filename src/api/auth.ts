// Bearer authentication for /v1 APIs (shared error format). Every request is checked on the server:
// token signature and expiry, sign-in session, member and app still active (fail closed).
import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { errorBody } from "../errors";
import { resolveIssuer } from "../oidc/config";
import { checkAccessToken } from "../oidc/tokens";
import { hasScopes } from "../oidc/scopes";

export function bearerAuth(deps: Deps): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const r = await checkAccessToken(c.env, deps, resolveIssuer(c.env, c.req.url), c.req.header("authorization"));
    if (!r.ok) {
      c.header("www-authenticate", r.reason === "missing" ? 'Bearer realm="hglobal-id"' : 'Bearer realm="hglobal-id", error="invalid_token"');
      return c.json(errorBody("unauthenticated", "A valid access token is required", c.get("requestId")), 401);
    }
    c.set("auth", r.ctx);
    c.header("cache-control", "no-store");
    await next();
  };
}

/** Returns a 403 `forbidden` response when the token lacks a scope, otherwise null. */
export function missingScope(c: Parameters<MiddlewareHandler<AppBindings>>[0], scopes: string[]): Response | null {
  if (hasScopes(c.get("auth").scope, scopes)) return null;
  return c.json(errorBody("forbidden", "Insufficient scope", c.get("requestId"), { required_scopes: scopes }), 403);
}
