// Delete my account — only on the member site itself (never through apps), after a fresh sign-in. Effective at once.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { centralOnly } from "./auth";
import { deleteAccount } from "../db/deletion";
import { REAUTH_MAX_AGE } from "../admin/roles";
import { epochSeconds } from "../lib/time";
import { SESSION_COOKIE, clearCookie } from "../auth/cookies";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });

const deleteRoute = createRoute({
  method: "post",
  path: "/v1/me/delete-account",
  tags: ["deletion"],
  summary: "Delete my account at once (member site only; needs a sign-in within 10 minutes). The account is anonymized, every device is signed out, and the Google account is released.",
  security: [{ session: [] }],
  responses: {
    200: { description: "Deleted", content: json(z.object({ deleted: z.literal(true) })) },
    401: err("unauthenticated or reauth_required"),
    403: err("forbidden"),
    409: err("last_super_admin (hand the role over first)"),
  },
});

export function registerDeletionRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(deleteRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const auth = c.get("auth");
    if (epochSeconds(deps.now()) - auth.authTime > REAUTH_MAX_AGE) {
      return c.json(errorBody("reauth_required", "為了確認是您本人，請重新登入後再刪除帳號", c.get("requestId"), { login_url: "/login?return_to=%2Fme%2Fedit" }), 401);
    }
    const r = await deleteAccount(c.env.DB, auth.memberId, deps.now(), c.get("requestId"));
    if (r === "last_super_admin") return c.json(errorBody("last_super_admin", "系統至少要保留一位超級管理員，請先把角色交給其他人。", c.get("requestId")), 409);
    if (r === "not_found") return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    clearCookie(c, SESSION_COOKIE);
    return c.json({ deleted: true as const }, 200);
  });
}
