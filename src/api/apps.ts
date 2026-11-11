// Public App configuration, the integration instructions for an App's own admin page, and the back-office
// App management APIs (ADR 0011).
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { APP_SCOPES, APP_STATUSES, AppDefinitionError, appDefinition, definitionFromForm, type AppEntry } from "../apps/registry";
import { HANDOFF_UPDATED, HANDOFF_VERSION, HANDOFF_VERSION_PATTERN, buildHandoff, isUpToDate } from "../apps/handoff";
import { appStats, getApp, isAppWebOrigin, listApps, readStoredApp, reportIntegratedVersion, saveApp, setAppStatus } from "../db/apps";
import { rolesOf } from "../db/staff";
import { REAUTH_MAX_AGE, can, type Permission } from "../admin/roles";
import { resolveIssuer } from "../oidc/config";
import { epochSeconds } from "../lib/time";
import { bearerAuth } from "./auth";

type C = Context<AppBindings>;
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const Any = z.record(z.unknown());
const AppIdParam = z.object({ app_id: z.string().max(32).openapi({ example: "learn" }) });

const configRoute = createRoute({
  method: "get",
  path: "/v1/apps/{app_id}/config",
  tags: ["apps"],
  summary: "Status, minimum version and public settings an App reads at launch",
  description: "Show maintenance when status is paused, stop when killed, and require an update below min_version. Changes take effect within 30 seconds.",
  request: { params: AppIdParam },
  responses: {
    200: {
      description: "App configuration",
      content: json(
        z
          .object({
            app_id: z.string(),
            status: z.enum(["active", "paused", "killed"]),
            min_version: z.string().openapi({ example: "1.0.0" }),
            config: z.record(z.unknown()).openapi({ description: "Public settings only; never secrets." }),
          })
          .openapi("AppConfig"),
      ),
    },
    404: err("app_not_found"),
  },
});

const handoffRoute = createRoute({
  method: "get",
  path: "/v1/apps/{app_id}/handoff",
  tags: ["apps"],
  summary: "Newest integration instructions for this App (super admin only, this App's own sign-in only)",
  description: "Called by the App's own admin page. Send `integrated` (the instruction version the App was last built to); it is recorded. When up_to_date is false, patch ONLY the differences. Never contains keys.",
  security: [{ bearer: [] }],
  request: { params: AppIdParam, query: z.object({ integrated: z.string().regex(HANDOFF_VERSION_PATTERN).optional().openapi({ example: "2026-11-10.2" }) }) },
  responses: {
    200: {
      description: "Newest instructions",
      content: json(z.object({ app_id: z.string(), version: z.string(), updated: z.string(), integrated: z.string().nullable(), up_to_date: z.boolean(), text: z.string() }).openapi("AppHandoff")),
    },
    401: err("unauthenticated"),
    403: err("forbidden"),
    404: err("app_not_found"),
  },
});

// ---------- back office (/v1/admin/apps, central sign-in cookie; see api/admin.ts for the staff check) ----------

const security = [{ session: [] }];
const common = { 401: err("unauthenticated or reauth_required"), 403: err("forbidden") };
const FormSchema = z
  .object({
    name: z.string().max(80),
    ios_bundle_id: z.string().max(150).optional(),
    android_package: z.string().max(150).optional(),
    scheme: z.string().max(31).optional(),
    web_origins: z.array(z.string().max(300)).max(10).optional(),
    return_urls: z.array(z.string().max(200)).max(10).optional(),
    extra_google_audiences: z.array(z.string().max(200)).max(10).optional(),
    min_version: z.string().max(20).optional(),
  })
  .openapi("AppRegistrationForm");

const listRoute = createRoute({ method: "get", path: "/v1/admin/apps", tags: ["admin"], summary: "Registered Apps with statistics and integration-instruction versions", security, responses: { 200: { description: "Apps", content: json(Any) }, ...common } });

const createAppRoute = createRoute({
  method: "post",
  path: "/v1/admin/apps",
  tags: ["admin"],
  summary: "Register a new App (blank platform fields are derived from the app_id). Apps cannot be deleted; use status killed.",
  security,
  request: { body: { required: true, content: json(FormSchema.extend({ app_id: z.string().max(32) })) } },
  responses: { 201: { description: "Registered", content: json(Any) }, ...common, 409: err("app_exists"), 422: err("invalid_field") },
});

const updateAppRoute = createRoute({
  method: "put",
  path: "/v1/admin/apps/{app_id}",
  tags: ["admin"],
  summary: "Edit an App registration (needs a sign-in within 10 minutes: it can change who may sign in)",
  security,
  request: { params: AppIdParam, body: { required: true, content: json(FormSchema) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("app_not_found"), 422: err("invalid_field") },
});

const statusRoute = createRoute({
  method: "put",
  path: "/v1/admin/apps/{app_id}/status",
  tags: ["admin"],
  summary: "Set an App to active, paused or killed (takes effect within 30 seconds)",
  security,
  request: { params: AppIdParam, body: { required: true, content: json(z.object({ status: z.enum(["active", "paused", "killed"]), reason: z.string().max(200).optional() })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("app_not_found") },
});

const adminHandoffRoute = createRoute({
  method: "get",
  path: "/v1/admin/apps/{app_id}/handoff",
  tags: ["admin"],
  summary: "Integration instructions to paste to the AI that builds this App (public values only)",
  security,
  request: { params: AppIdParam },
  responses: { 200: { description: "Instructions", content: json(Any) }, ...common, 404: err("app_not_found") },
});

function deny(c: C, p: Permission): Response | null {
  if (can(c.get("staff").roles, p)) return null;
  return c.json(errorBody("forbidden", "Not permitted for your role", c.get("requestId"), { required_permission: p }), 403);
}

const notFound = (c: C) => c.json(errorBody("app_not_found", "Unknown app", c.get("requestId")), 404);

function invalid(c: C, e: unknown) {
  if (!(e instanceof AppDefinitionError)) throw e;
  return c.json(errorBody("invalid_field", e.message, c.get("requestId")), 422);
}

/** CORS for the web versions of registered Apps. Bearer tokens only: cookies are never allowed cross-site. */
export function registerAppCors(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/*", async (c, next) => {
    const origin = c.req.header("origin");
    const path = new URL(c.req.url).pathname;
    if (!origin || path.startsWith("/v1/admin/") || origin === new URL(c.req.url).origin) return next();
    let ok = false;
    try {
      ok = await isAppWebOrigin(c.env.DB, origin, deps.now());
    } catch {
      ok = false;
    }
    if (!ok) return next();
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
          vary: "origin",
        },
      });
    }
    await next();
    c.header("access-control-allow-origin", origin);
    c.header("access-control-expose-headers", "x-request-id, retry-after");
    c.header("vary", "origin", { append: true });
  });
}

export function registerAppRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(configRoute, async (c) => {
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    c.header("cache-control", "no-store");
    return c.json({ app_id: a.app_id, status: a.status, min_version: a.min_version, config: { ...a.config } }, 200);
  });

  app.use("/v1/apps/:app_id/handoff", bearerAuth(deps));
  app.openapi(handoffRoute, async (c) => {
    const auth = c.get("auth");
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    // Checked on every request: a hidden button is not authorization.
    if (auth.appId !== a.app_id) return c.json(errorBody("forbidden", "Only this App's own sign-in can read this", c.get("requestId")), 403);
    if (!(await rolesOf(c.env.DB, auth.memberId)).includes("super_admin")) return c.json(errorBody("forbidden", "Super admin only", c.get("requestId")), 403);
    const integrated = c.req.valid("query").integrated ?? null;
    if (integrated) await reportIntegratedVersion(c.env.DB, a.app_id, integrated, auth.memberId, deps.now());
    return c.json({ app_id: a.app_id, version: HANDOFF_VERSION, updated: HANDOFF_UPDATED, integrated, up_to_date: isUpToDate(integrated), text: buildHandoff(a, resolveIssuer(c.env, c.req.url)) }, 200);
  });

  // Registered after registerAdminRoutes, so the staff check on /v1/admin/* already ran.
  app.openapi(listRoute, async (c) => {
    const d = deny(c, "apps.operate");
    if (d) return d as never;
    const now = deps.now();
    const [{ apps, invalid: broken }, stats] = await Promise.all([listApps(c.env.DB, now), appStats(c.env.DB, now)]);
    const row = (a: AppEntry) => {
      const s = stats.get(a.app_id);
      return {
        ...appDefinition(a),
        members: s?.members ?? 0,
        active_sessions: s?.active_sessions ?? 0,
        last_sign_in_at: s?.last_sign_in_at ?? null,
        status_reason: a.status === "active" ? null : (s?.status_reason ?? null),
        status_updated_at: s?.status_updated_at ?? null,
        integrated_version: s?.integrated_version ?? null,
        integrated_reported_at: s?.integrated_reported_at ?? null,
        up_to_date: isUpToDate(s?.integrated_version),
      };
    };
    return c.json(
      { apps: apps.map(row), invalid: broken, handoff_version: HANDOFF_VERSION, handoff_updated: HANDOFF_UPDATED, scopes: APP_SCOPES, statuses: APP_STATUSES, can_manage: can(c.get("staff").roles, "apps.manage") },
      200,
    );
  });

  app.openapi(createAppRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    let entry: AppEntry;
    try {
      entry = definitionFromForm(c.req.valid("json"), { defaults: true });
    } catch (e) {
      return invalid(c, e) as never;
    }
    const r = await saveApp(c.env.DB, entry, "create", { memberId: c.get("staff").memberId, requestId: c.get("requestId") }, deps.now());
    if (r === "exists") return c.json(errorBody("app_exists", "這個 app_id 已經登記過了。", c.get("requestId")), 409);
    return c.json({ app: appDefinition(entry) }, 201);
  });

  app.openapi(updateAppRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const staff = c.get("staff");
    if (epochSeconds(deps.now()) - staff.authTime > REAUTH_MAX_AGE) {
      return c.json(errorBody("reauth_required", "請重新登入後再試", c.get("requestId"), { login_url: "/login?return_to=%2Fadmin" }), 401);
    }
    const appId = c.req.valid("param").app_id;
    const stored = await readStoredApp(c.env.DB, appId);
    if (!stored) return notFound(c);
    let entry: AppEntry;
    try {
      entry = definitionFromForm({ ...c.req.valid("json"), app_id: appId }, { keep: stored });
    } catch (e) {
      return invalid(c, e) as never;
    }
    await saveApp(c.env.DB, entry, "update", { memberId: staff.memberId, requestId: c.get("requestId") }, deps.now());
    return c.json({ app: appDefinition(entry) }, 200);
  });

  app.openapi(statusRoute, async (c) => {
    const d = deny(c, "apps.operate");
    if (d) return d as never;
    const { status, reason } = c.req.valid("json");
    const ok = await setAppStatus(c.env.DB, c.req.valid("param").app_id, status, reason?.trim() || null, { memberId: c.get("staff").memberId, requestId: c.get("requestId") }, deps.now());
    if (!ok) return notFound(c);
    return c.json({ status }, 200);
  });

  app.openapi(adminHandoffRoute, async (c) => {
    const d = deny(c, "apps.operate");
    if (d) return d as never;
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    return c.json({ app_id: a.app_id, version: HANDOFF_VERSION, updated: HANDOFF_UPDATED, text: buildHandoff(a, resolveIssuer(c.env, c.req.url)) }, 200);
  });
}
