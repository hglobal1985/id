// The member site's own account operations: signed-in devices, sign out everywhere, and "download my data".
// Only the member site itself may call these (never Apps, which have their own /v1/auth/logout*).
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { SESSION_COOKIE, clearCookie } from "../auth/cookies";
import { centralOnly } from "./auth";
import { exportMemberData, listDevices } from "../db/account";
import { getApp, revokeAppSession, revokeEverything } from "../db/apps";
import { revokeSession } from "../db/identity";
import { auditStatement } from "../db/audit";
import { taipeiIso } from "../lib/time";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const security = [{ session: [] }];
const common = { 401: err("unauthenticated"), 403: err("forbidden") };

const DeviceSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["web", "app"]),
    app_id: z.string().openapi({ description: "central for the member site itself" }),
    app_name: z.string(),
    device_label: z.string().nullable(),
    last_used_at: z.string(),
    current: z.boolean(),
  })
  .openapi("SignedInDevice");

const listRoute = createRoute({
  method: "get",
  path: "/v1/me/sessions",
  tags: ["account"],
  summary: "Where I am signed in (member site only)",
  security,
  responses: { 200: { description: "Devices", content: json(z.object({ sessions: z.array(DeviceSchema) })) }, ...common },
});
const revokeRoute = createRoute({
  method: "post",
  path: "/v1/me/sessions/{id}/revoke",
  tags: ["account"],
  summary: "Sign out one of my other sign-ins",
  security,
  request: { params: z.object({ id: z.string().max(64) }) },
  responses: { 200: { description: "Signed out", content: json(z.object({ revoked: z.literal(true) })) }, ...common, 404: err("not_found"), 409: err("current_session") },
});
const logoutAllRoute = createRoute({
  method: "post",
  path: "/v1/me/logout-all",
  tags: ["account"],
  summary: "Sign out of every device and every App, including this browser",
  security,
  responses: { 200: { description: "Signed out", content: json(z.object({ logged_out: z.literal(true) })) }, ...common },
});
const exportRoute = createRoute({
  method: "get",
  path: "/v1/me/export",
  tags: ["account"],
  summary: "Download everything the system holds about me, as JSON (member site only)",
  security,
  responses: { 200: { description: "My data", content: json(z.record(z.unknown())) }, ...common },
});

const IndexingSchema = z.object({ allowed: z.boolean() }).openapi("SearchIndexing");
const getIndexingRoute = createRoute({
  method: "get",
  path: "/v1/me/search-indexing",
  tags: ["account"],
  summary: "Do I agree that search engines may list my public page? (member site only)",
  security,
  responses: { 200: { description: "Setting", content: json(IndexingSchema) }, ...common },
});
const putIndexingRoute = createRoute({
  method: "put",
  path: "/v1/me/search-indexing",
  tags: ["account"],
  summary: "Agree or withdraw: search engines may list my public page (member site only)",
  security,
  request: { body: { required: true, content: json(IndexingSchema) } },
  responses: { 200: { description: "Saved", content: json(IndexingSchema) }, ...common },
});

export function registerAccountRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  // Sign-in is checked by the shared /v1/me/* middleware (api/profile.ts); centralOnly keeps Apps out.
  app.openapi(listRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const auth = c.get("auth");
    const rows = await listDevices(c.env.DB, auth.memberId, deps.now());
    const names = new Map<string, string>();
    for (const r of rows) {
      if (r.kind === "app" && !names.has(r.app_id)) names.set(r.app_id, (await getApp(c.env.DB, r.app_id, deps.now()))?.name ?? r.app_id);
    }
    return c.json(
      {
        sessions: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          app_id: r.app_id,
          app_name: r.kind === "web" ? "會員網站" : (names.get(r.app_id) ?? r.app_id),
          device_label: r.device_label,
          last_used_at: r.last_used_at,
          current: r.kind === "web" && r.id === auth.sessionId,
        })),
      },
      200,
    );
  });

  app.openapi(getIndexingRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const row = await c.env.DB.prepare("SELECT search_indexable FROM members WHERE id = ?").bind(c.get("auth").memberId).first<{ search_indexable: number }>();
    return c.json({ allowed: row?.search_indexable === 1 }, 200);
  });

  app.openapi(putIndexingRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const auth = c.get("auth");
    const { allowed } = c.req.valid("json");
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE members SET search_indexable = ?, updated_at = ? WHERE id = ?").bind(allowed ? 1 : 0, taipeiIso(deps.now()), auth.memberId),
      auditStatement(c.env.DB, { actorType: "member", actorId: auth.memberId, action: "member.search_indexing", targetType: "member", targetId: auth.memberId, appId: null, result: "success", requestId: c.get("requestId") }, deps.now()),
    ]);
    return c.json({ allowed }, 200);
  });

  app.openapi(revokeRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const auth = c.get("auth");
    const id = c.req.valid("param").id;
    if (id === auth.sessionId) return c.json(errorBody("current_session", "這是目前使用的登入，請用「登出」。", c.get("requestId")), 409);
    const device = (await listDevices(c.env.DB, auth.memberId, deps.now())).find((r) => r.id === id);
    if (!device) return c.json(errorBody("not_found", "找不到這個登入", c.get("requestId")), 404);
    if (device.kind === "web") {
      await c.env.DB.batch([
        auditStatement(c.env.DB, { actorType: "member", actorId: auth.memberId, action: "session.revoke", targetType: "login_session", targetId: id, appId: null, result: "success", requestId: c.get("requestId") }, deps.now()),
      ]);
      await revokeSession(c.env.DB, id, deps.now());
    } else {
      await revokeAppSession(c.env.DB, { sessionId: id, memberId: auth.memberId, appId: device.app_id, requestId: c.get("requestId") }, deps.now());
    }
    return c.json({ revoked: true as const }, 200);
  });

  app.openapi(logoutAllRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    await revokeEverything(c.env.DB, { memberId: c.get("auth").memberId, appId: null, requestId: c.get("requestId") }, deps.now());
    clearCookie(c, SESSION_COOKIE);
    return c.json({ logged_out: true as const }, 200);
  });

  app.openapi(exportRoute, async (c) => {
    const d = centralOnly(c);
    if (d) return d as never;
    const auth = c.get("auth");
    const data = await exportMemberData(c.env.DB, auth.memberId, deps.now());
    await c.env.DB.batch([
      auditStatement(c.env.DB, { actorType: "member", actorId: auth.memberId, action: "member.export", targetType: "member", targetId: auth.memberId, appId: null, result: "success", requestId: c.get("requestId") }, deps.now()),
    ]);
    c.header("content-disposition", 'attachment; filename="my-data.json"');
    return c.json(data, 200);
  });
}
