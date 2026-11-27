// 後台「生態系統功能」（杜杜龍 2026-11-27）：看每個 App 有沒有參與每一項系統功能，並可自訂。
// 全部是 /v1/admin/*（中央登入的 cookie；先由 api/admin.ts 檢查是職員）。App 本身只讀 GET /v1/apps/{app_id}/config 的 eco_features。
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { can, type Permission } from "../admin/roles";
import { listApps } from "../db/apps";
import { loadEcoAppRows, loadEcoSettings, saveEcoSettings, setEcoParticipation } from "../db/eco-features";
import { ECO_CATALOG, ECO_FEATURES, EcoError, MAX_KEEP, MAX_SITES, UPTIME_INTERVALS, isEcoFeature, normalizeSettings } from "../platform/eco-features";

type C = Context<AppBindings>;
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const Any = z.record(z.string(), z.unknown());
const security = [{ session: [] }];
const common = { 401: err("unauthenticated or reauth_required"), 403: err("forbidden") };
const FeatureParam = z.object({ feature_key: z.string().max(40).openapi({ example: "uptime_watch" }) });
const FeatureAppParam = FeatureParam.extend({ app_id: z.string().max(32) });

const listRoute = createRoute({ method: "get", path: "/v1/admin/eco-features", tags: ["admin"], summary: "Ecosystem features: settings of each feature and which Apps take part", security, responses: { 200: { description: "Features", content: json(Any) }, ...common } });
const saveRoute = createRoute({
  method: "put",
  path: "/v1/admin/eco-features/{feature_key}",
  tags: ["admin"],
  summary: "Save the settings of one ecosystem feature (on/off, frequency, who is notified; replaces the earlier settings)",
  security,
  request: { params: FeatureParam, body: { required: true, content: json(Any) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("feature_not_found"), 422: err("invalid_field") },
});
const participationRoute = createRoute({
  method: "put",
  path: "/v1/admin/eco-features/{feature_key}/apps/{app_id}",
  tags: ["admin"],
  summary: "Switch one App in or out of an ecosystem feature",
  security,
  request: { params: FeatureAppParam, body: { required: true, content: json(z.object({ participating: z.boolean() })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("feature_not_found or app_not_found") },
});

function deny(c: C, p: Permission): Response | null {
  const st = c.get("staff");
  if (can(st.roles, p, st.grants)) return null;
  return c.json(errorBody("forbidden", "Not permitted for your role", c.get("requestId"), { required_permission: p }), 403);
}

export function registerEcoFeatureRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(listRoute, async (c) => {
    const d = deny(c, "apps.operate");
    if (d) return d as never;
    const [settings, rows, { apps }] = await Promise.all([loadEcoSettings(c.env.DB), loadEcoAppRows(c.env.DB), listApps(c.env.DB, deps.now())]);
    const features = ECO_FEATURES.map((key) => {
      const info = ECO_CATALOG[key];
      const s = settings[key];
      return {
        key,
        label: info.label,
        summary: info.summary,
        app_duty: info.app_duty,
        fields: info.fields,
        settings: s,
        defaults: info.defaults,
        apps: apps.map((a) => {
          const r = rows.find((x) => x.feature_key === key && x.app_id === a.app_id);
          const participating = r?.participating ?? true;
          return { app_id: a.app_id, name: a.name, participating, effective: s.enabled && participating, last_status: r?.last_status ?? null, last_checked_at: r?.last_checked_at ?? null, last_note: r?.last_note ?? null };
        }),
      };
    });
    return c.json({ features, limits: { intervals: UPTIME_INTERVALS, max_sites: MAX_SITES, max_keep: MAX_KEEP }, can_manage: can(c.get("staff").roles, "apps.manage", c.get("staff").grants) }, 200) as never;
  });

  app.openapi(saveRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const key = c.req.valid("param").feature_key;
    if (!isEcoFeature(key)) return c.json(errorBody("feature_not_found", "沒有這個功能。", c.get("requestId")), 404) as never;
    let settings;
    try {
      settings = normalizeSettings(key, c.req.valid("json"));
    } catch (e) {
      if (!(e instanceof EcoError)) throw e;
      return c.json(errorBody("invalid_field", e.message, c.get("requestId")), 422) as never;
    }
    await saveEcoSettings(c.env.DB, key, settings, { memberId: c.get("staff").memberId, requestId: c.get("requestId") }, deps.now());
    return c.json({ feature_key: key, settings }, 200);
  });

  app.openapi(participationRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const { feature_key: key, app_id: appId } = c.req.valid("param");
    if (!isEcoFeature(key)) return c.json(errorBody("feature_not_found", "沒有這個功能。", c.get("requestId")), 404) as never;
    const { apps } = await listApps(c.env.DB, deps.now());
    if (!apps.some((a) => a.app_id === appId)) return c.json(errorBody("app_not_found", "Unknown app", c.get("requestId")), 404) as never;
    const { participating } = c.req.valid("json");
    await setEcoParticipation(c.env.DB, key, appId, participating, { memberId: c.get("staff").memberId, requestId: c.get("requestId") }, deps.now());
    return c.json({ feature_key: key, app_id: appId, participating }, 200);
  });
}
