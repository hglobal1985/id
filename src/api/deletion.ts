// Delete my account, at once, after a fresh sign-in: on the member site (session cookie, sign-in within 10 minutes) or from inside a
// registered App (the member's own App access token plus a reauth token from POST /v1/auth/reauth, ADR 0037).
import { kickDelivery } from "../webhooks/notify";
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { CENTRAL_CLIENT } from "./auth";
import { checkReauthToken } from "../auth/reauth";
import { resolveIssuer } from "../oidc/config";
import { deleteAccount } from "../db/deletion";
import { REAUTH_MAX_AGE } from "../admin/roles";
import { epochSeconds } from "../lib/time";
import { avatarKey, dropFiles } from "../lib/files";
import { SESSION_COOKIE, clearCookie } from "../auth/cookies";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });

const deleteRoute = createRoute({
  method: "post",
  path: "/v1/me/delete-account",
  tags: ["deletion"],
  summary: "Delete my account at once. The member site needs a sign-in within 10 minutes; an App sends the member's own access token plus `reauth_token` (from POST /v1/auth/reauth, valid 10 minutes). The account is anonymized, every device is signed out, the Google account is released, and every connected App gets member.deleted.",
  security: [{ session: [] }, { bearer: [] }],
  request: { body: { required: false, content: json(z.object({ reauth_token: z.string().max(4096).optional().openapi({ description: "Required from an App; ignored on the member site." }) })) } },
  responses: {
    200: { description: "Deleted", content: json(z.object({ deleted: z.literal(true) })) },
    401: err("unauthenticated or reauth_required (App: sign the member in again, then POST /v1/auth/reauth)"),
    403: err("forbidden (a paused or unregistered App, or an OIDC client)"),
    409: err("last_super_admin (hand the role over first)"),
  },
});

export function registerDeletionRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(deleteRoute, async (c) => {
    const auth = c.get("auth");
    const now = deps.now();
    let appId: string | null = null;
    if (auth.clientId === CENTRAL_CLIENT) {
      if (epochSeconds(now) - auth.authTime > REAUTH_MAX_AGE) {
        return c.json(errorBody("reauth_required", "為了確認是您本人，請重新登入後再刪除帳號", c.get("requestId"), { login_url: "/login?return_to=%2Fmy%2Fedit" }), 401);
      }
    } else if (auth.appId) {
      // From an App: the access token already proved the member and that the App is registered and active (checked on every request);
      // the reauth token proves a Google sign-in within the last 10 minutes, for this very App session.
      const body = (await c.req.json().catch(() => null)) as { reauth_token?: unknown } | null;
      const token = typeof body?.reauth_token === "string" ? body.reauth_token : "";
      if (!token || !(await checkReauthToken(c.env, resolveIssuer(c.env, c.req.url), token, { memberId: auth.memberId, appId: auth.appId, sessionId: auth.sessionId }, now))) {
        return c.json(errorBody("reauth_required", "為了確認是您本人，請再用 Google 登入一次，確認後即可刪除帳號", c.get("requestId"), { reauth: "POST /v1/auth/reauth" }), 401);
      }
      appId = auth.appId;
    } else {
      return c.json(errorBody("forbidden", "這個登入方式不能刪除帳號", c.get("requestId")), 403);
    }
    const r = await deleteAccount(c.env.DB, auth.memberId, now, c.get("requestId"), appId);
    if (r === "last_super_admin") return c.json(errorBody("last_super_admin", "系統至少要保留一位超級管理員，請先把角色交給其他人。", c.get("requestId")), 409);
    if (r === "not_found") return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    await dropFiles(c.env.FILES, [avatarKey(auth.memberId)]);
    clearCookie(c, SESSION_COOKIE);
    kickDelivery(c, deps);
    return c.json({ deleted: true as const }, 200);
  });
}
