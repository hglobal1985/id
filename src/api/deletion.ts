// Member data deletion requests — only on the member site itself (never through apps), after a fresh sign-in.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { centralOnly } from "./auth";
import { PROCESSING_DAYS, cancelDeletion, listMemberRequests, requestDeletion } from "../db/deletion";
import { REAUTH_MAX_AGE } from "../admin/roles";
import { epochSeconds } from "../lib/time";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const security = [{ session: [] }];
const RequestSchema = z
  .object({ id: z.string(), scope: z.enum(["amway", "account"]), status: z.enum(["requested", "completed", "cancelled"]), requested_at: z.string(), due_at: z.string(), completed_at: z.string().nullable() })
  .openapi("DeletionRequest");

const listRoute = createRoute({
  method: "get",
  path: "/v1/me/deletion-requests",
  tags: ["deletion"],
  summary: "My data deletion requests (member site only)",
  security,
  responses: { 200: { description: "Requests", content: json(z.object({ requests: z.array(RequestSchema), processing_days: z.number().int() })) }, 401: err("unauthenticated"), 403: err("forbidden") },
});
const createRouteDef = createRoute({
  method: "post",
  path: "/v1/me/deletion-requests",
  tags: ["deletion"],
  summary: "Ask for deletion of the Amway area data or the whole account (needs a sign-in within 10 minutes)",
  security,
  request: { body: { required: true, content: json(z.object({ scope: z.enum(["amway", "account"]) })) } },
  responses: { 200: { description: "Requested", content: json(RequestSchema) }, 401: err("unauthenticated or reauth_required"), 403: err("forbidden"), 422: err("invalid_field") },
});
const cancelRoute = createRoute({
  method: "post",
  path: "/v1/me/deletion-requests/{id}/cancel",
  tags: ["deletion"],
  summary: "Cancel a request that has not been carried out yet",
  security,
  request: { params: z.object({ id: z.string().max(64) }) },
  responses: { 200: { description: "Cancelled", content: json(z.object({ cancelled: z.literal(true) })) }, 401: err("unauthenticated"), 403: err("forbidden"), 404: err("not_found") },
});

export function registerDeletionRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(listRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const rows = await listMemberRequests(c.env.DB, c.get("auth").memberId);
    return c.json({ requests: rows.map(({ id, scope, status, requested_at, due_at, completed_at }) => ({ id, scope, status, requested_at, due_at, completed_at })), processing_days: PROCESSING_DAYS }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const auth = c.get("auth");
    if (epochSeconds(deps.now()) - auth.authTime > REAUTH_MAX_AGE) {
      return c.json(errorBody("reauth_required", "為了確認是您本人，請重新登入後再送出", c.get("requestId"), { login_url: "/login?return_to=%2Fme" }), 401);
    }
    const r = await requestDeletion(c.env.DB, auth.memberId, c.req.valid("json").scope, deps.now(), c.get("requestId"));
    const { id, scope, status, requested_at, due_at, completed_at } = r;
    return c.json({ id, scope, status, requested_at, due_at, completed_at }, 200);
  });

  app.openapi(cancelRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const ok = await cancelDeletion(c.env.DB, c.get("auth").memberId, c.req.valid("param").id, deps.now(), c.get("requestId"));
    if (!ok) return c.json(errorBody("not_found", "No open request", c.get("requestId")), 404);
    return c.json({ cancelled: true as const }, 200);
  });
}
