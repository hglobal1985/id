import type { Context } from "hono";
import type { AppBindings } from "../env";
import { resolveIssuer } from "../oidc/config";

/** Cookie-authenticated writes must come from this site: Origin must match, or the browser says same-origin. */
export function isSameOriginWrite(c: Context<AppBindings>): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return true;
  const origin = c.req.header("origin");
  if (origin) return origin === new URL(resolveIssuer(c.env, c.req.url)).origin;
  return c.req.header("sec-fetch-site") === "same-origin";
}
