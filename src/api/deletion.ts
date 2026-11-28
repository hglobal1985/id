// Delete my account, at once, after a fresh sign-in: on the member site (session cookie, sign-in within 10 minutes) or from inside a
// registered App (the member's own App access token plus a reauth token from POST /v1/auth/reauth, ADR 0037).
import { kickDelivery } from "../webhooks/notify";
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { CENTRAL_CLIENT } from "./auth";
import { deleteAccount } from "../db/deletion";
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
  request: { body: { required: false, content: json(z.object({ reauth_token: z.string().max(4096).optional().openapi({ description: "Deprecated and ignored since 2026-11-28 (no second sign-in any more; the App asks the member to type ok instead)." }) })) } },
  responses: {
    200: { description: "Deleted", content: json(z.object({ deleted: z.literal(true) })) },
    401: err("unauthenticated"),
    403: err("forbidden (a paused or unregistered App, or an OIDC client)"),
    409: err("last_super_admin (hand the role over first)"),
  },
});

export function registerDeletionRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(deleteRoute, async (c) => {
    const auth = c.get("auth");
    const now = deps.now();
    let appId: string | null = null;
    // 杜杜龍 2026-11-28：全生態系統永久取消「二次登入」；確認改在畫面上手動輸入 ok。會員自己的登入（會員網站的 session 或 App 的 Access Token，
    // 每個請求都已驗證會員與 App 是登記且啟用的）就夠了；舊版 App 還會帶的 reauth_token 不再檢查。
    if (auth.clientId === CENTRAL_CLIENT) {
      // 會員網站自己的登入階段
    } else if (auth.appId) {
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
