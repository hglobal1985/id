// Social links on the member's card: the platform list, my links, and the super admin's platform management.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { bearerAuth, missingScope } from "./auth";
import { can } from "../admin/roles";
import { resolveIssuer } from "../oidc/config";
import { sniffImage } from "../db/profile";
import { addLink, addPlatform, deletePlatform, listLinks, listPlatforms, removeLink, renamePlatform, reorderPlatforms, setLinkIcon, setPlatformIcon } from "../db/social";
import { LINK_ICON_MAX_BYTES, PLATFORM_ICON_MAX_BYTES, cleanLabel, platformKeyOf, validateSocialUrl } from "../social/rules";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const security = [{ bearer: [] }];
const common = { 401: err("unauthenticated"), 403: err("forbidden (scope)") };
const adminSecurity = [{ session: [] }];
const adminCommon = { 401: err("unauthenticated"), 403: err("forbidden") };
const Any = z.record(z.unknown());
const IdParam = z.object({ id: z.string().max(64) });
const KeyParam = z.object({ key: z.string().max(40) });

const PlatformSchema = z.object({ key: z.string(), name: z.string(), icon_url: z.string(), custom: z.boolean() }).openapi("SocialPlatform");
const LinkSchema = z
  .object({ id: z.string(), platform_key: z.string(), platform_name: z.string().nullable(), url: z.string(), label: z.string().nullable(), icon_url: z.string(), custom: z.boolean() })
  .openapi("SocialLink");

const platformsRoute = createRoute({
  method: "get",
  path: "/v1/social/platforms",
  tags: ["social"],
  summary: "Social platforms a member can add (in the order the super admin set), with their icons",
  security,
  responses: { 200: { description: "Platforms", content: json(z.object({ platforms: z.array(PlatformSchema) })) }, ...common },
});
const linksRoute = createRoute({
  method: "get",
  path: "/v1/me/social-links",
  tags: ["social"],
  summary: "My social links (shown as icons on my card, in the order I added them)",
  security,
  responses: { 200: { description: "Links", content: json(z.object({ links: z.array(LinkSchema), max: z.number().int() })) }, ...common },
});
const addRoute = createRoute({
  method: "post",
  path: "/v1/me/social-links",
  tags: ["social"],
  summary: "Add a social link (any platform may be added several times). For 自定義 an optional name; its icon is uploaded with PUT /v1/me/social-links/{id}/icon.",
  security,
  request: { body: { required: true, content: json(z.object({ platform_key: z.string().max(40), url: z.string().max(400), label: z.string().max(60).optional() })) } },
  responses: { 200: { description: "Added", content: json(LinkSchema) }, ...common, 422: err("invalid_field"), 409: err("too_many (at most 30 links)") },
});
const iconRoute = createRoute({
  method: "put",
  path: "/v1/me/social-links/{id}/icon",
  tags: ["social"],
  summary: "Set the icon of a 自定義 link: the raw image bytes (PNG, JPEG or WebP, at most 16 KB; shrink to about 64 px first)",
  security,
  request: { params: IdParam },
  responses: { 200: { description: "Saved", content: json(z.object({ icon_url: z.string() })) }, ...common, 404: err("not_found"), 413: err("too_large"), 422: err("invalid_field") },
});
const removeRoute = createRoute({
  method: "delete",
  path: "/v1/me/social-links/{id}",
  tags: ["social"],
  summary: "Remove one of my social links",
  security,
  request: { params: IdParam },
  responses: { 200: { description: "Removed", content: json(z.object({ removed: z.literal(true) })) }, ...common, 404: err("not_found") },
});

// ---- super admin ----
const adminListRoute = createRoute({ method: "get", path: "/v1/admin/social-platforms", tags: ["admin"], summary: "Social platforms with the number of links made with each (super admin)", security: adminSecurity, responses: { 200: { description: "Platforms", content: json(Any) }, ...adminCommon } });
const adminAddRoute = createRoute({
  method: "post",
  path: "/v1/admin/social-platforms",
  tags: ["admin"],
  summary: "Add a platform (its icon is the generic link icon until one is uploaded)",
  security: adminSecurity,
  request: { body: { required: true, content: json(z.object({ name: z.string().min(1).max(30) })) } },
  responses: { 200: { description: "Added", content: json(Any) }, ...adminCommon, 422: err("invalid_field") },
});
const adminRenameRoute = createRoute({
  method: "put",
  path: "/v1/admin/social-platforms/{key}",
  tags: ["admin"],
  summary: "Rename a platform",
  security: adminSecurity,
  request: { params: KeyParam, body: { required: true, content: json(z.object({ name: z.string().min(1).max(30) })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...adminCommon, 404: err("not_found"), 422: err("invalid_field") },
});
const adminDeleteRoute = createRoute({
  method: "delete",
  path: "/v1/admin/social-platforms/{key}",
  tags: ["admin"],
  summary: "Delete a platform (not 自定義). Links already made with it stay and show the generic link icon.",
  security: adminSecurity,
  request: { params: KeyParam },
  responses: { 200: { description: "Deleted", content: json(Any) }, ...adminCommon, 404: err("not_found") },
});
const adminReorderRoute = createRoute({
  method: "post",
  path: "/v1/admin/social-platforms/reorder",
  tags: ["admin"],
  summary: "Save the order of all platforms (top to bottom; every platform exactly once)",
  security: adminSecurity,
  request: { body: { required: true, content: json(z.object({ keys: z.array(z.string().max(40)).max(200) })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...adminCommon, 422: err("invalid_field") },
});
const adminIconRoute = createRoute({
  method: "put",
  path: "/v1/admin/social-platforms/{key}/icon",
  tags: ["admin"],
  summary: "Replace a platform's icon: the raw image bytes (PNG, JPEG or WebP, at most 32 KB; shrink to about 96 px first)",
  security: adminSecurity,
  request: { params: KeyParam },
  responses: { 200: { description: "Saved", content: json(Any) }, ...adminCommon, 404: err("not_found"), 413: err("too_large"), 422: err("invalid_field") },
});
const adminIconResetRoute = createRoute({
  method: "delete",
  path: "/v1/admin/social-platforms/{key}/icon",
  tags: ["admin"],
  summary: "Go back to the built-in icon of a platform",
  security: adminSecurity,
  request: { params: KeyParam },
  responses: { 200: { description: "Reset", content: json(Any) }, ...adminCommon, 404: err("not_found") },
});

export function registerSocialRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/social/*", bearerAuth(deps));
  const iconUrl = (issuer: string, key: string, version: number) => `${issuer}/icons/social/platform/${encodeURIComponent(key)}?v=${version}`;

  app.openapi(platformsRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    const issuer = resolveIssuer(c.env, c.req.url);
    const list = await listPlatforms(c.env.DB);
    return c.json({ platforms: list.map((p) => ({ key: p.key, name: p.name, icon_url: iconUrl(issuer, p.key, p.icon_version), custom: p.custom })) }, 200);
  });

  const shape = async (c: { env: AppBindings["Bindings"]; req: { url: string } }, memberId: string) => {
    const issuer = resolveIssuer(c.env, c.req.url);
    const platforms = new Map((await listPlatforms(c.env.DB)).map((p) => [p.key, p]));
    return (await listLinks(c.env.DB, memberId)).map((l) => ({
      id: l.id,
      platform_key: l.platform_key,
      platform_name: l.platform_name,
      url: l.url,
      label: l.label,
      icon_url: l.own_icon ? `${issuer}/icons/social/link/${l.id}` : iconUrl(issuer, l.platform_key, platforms.get(l.platform_key)?.icon_version ?? 1),
      custom: platforms.get(l.platform_key)?.custom ?? false,
    }));
  };

  app.openapi(linksRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    return c.json({ links: await shape(c, c.get("auth").memberId), max: 30 }, 200);
  });

  app.openapi(addRoute, async (c) => {
    const denied = missingScope(c, ["profile.basic.write"]);
    if (denied) return denied as never;
    const { platform_key, url, label } = c.req.valid("json");
    const u = validateSocialUrl(url);
    if (!u.ok) return c.json(errorBody("invalid_field", u.message, c.get("requestId"), { field_key: "url", reason: "format" }), 422);
    const cleanedLabel = label === undefined || label.trim() === "" ? null : cleanLabel(label);
    if (label !== undefined && label.trim() !== "" && cleanedLabel === null) return c.json(errorBody("invalid_field", "名稱最多 30 字", c.get("requestId"), { field_key: "label", reason: "format" }), 422);
    const { memberId } = c.get("auth");
    const r = await addLink(c.env.DB, memberId, platform_key, u.url, cleanedLabel, deps.now(), c.get("requestId"));
    if (!r.ok) {
      return r.reason === "too_many"
        ? (c.json(errorBody("too_many", "最多 30 個社群連結", c.get("requestId")), 409) as never)
        : (c.json(errorBody("invalid_field", "沒有這個社群平台", c.get("requestId"), { field_key: "platform_key", reason: "unknown" }), 422) as never);
    }
    const link = (await shape(c, memberId)).find((l) => l.id === r.id);
    return c.json(link as z.infer<typeof LinkSchema>, 200);
  });

  app.openapi(iconRoute, async (c) => {
    const denied = missingScope(c, ["profile.basic.write"]);
    if (denied) return denied as never;
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > LINK_ICON_MAX_BYTES) return c.json(errorBody("too_large", "圖示太大（上限 16 KB）", c.get("requestId")), 413) as never;
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > LINK_ICON_MAX_BYTES) return c.json(errorBody("too_large", "圖示太大（上限 16 KB）", c.get("requestId")), 413) as never;
    const mime = sniffImage(bytes);
    if (!mime) return c.json(errorBody("invalid_field", "請上傳 PNG、JPEG 或 WebP 圖片", c.get("requestId"), { field_key: "icon", reason: "not_an_image" }), 422) as never;
    const { id } = c.req.valid("param");
    const { memberId } = c.get("auth");
    if (!(await setLinkIcon(c.env.DB, memberId, id, mime, bytes))) return c.json(errorBody("not_found", "找不到這個連結，或它不是自定義", c.get("requestId")), 404) as never;
    return c.json({ icon_url: `${resolveIssuer(c.env, c.req.url)}/icons/social/link/${id}` }, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const denied = missingScope(c, ["profile.basic.write"]);
    if (denied) return denied as never;
    const ok = await removeLink(c.env.DB, c.get("auth").memberId, c.req.valid("param").id, deps.now(), c.get("requestId"));
    if (!ok) return c.json(errorBody("not_found", "找不到這個連結", c.get("requestId")), 404) as never;
    return c.json({ removed: true as const }, 200);
  });

  // ---- super admin (the staff check of /v1/admin/* runs first) ----
  const allowed = (c: { get: (k: "staff") => { roles: string[] } }) => can(c.get("staff").roles, "social.manage");
  const forbidden = (c: { get: (k: "requestId") => string; json: (b: unknown, s: 403) => Response }) => c.json(errorBody("forbidden", "Not permitted for your role", c.get("requestId"), { required_permission: "social.manage" }), 403);
  const actor = (c: { get: (k: "staff" | "requestId") => never }) => ({ memberId: (c.get("staff") as { memberId: string }).memberId, requestId: c.get("requestId") as string, now: deps.now() });

  app.openapi(adminListRoute, async (c) => {
    if (!allowed(c)) return forbidden(c) as never;
    const counts = await c.env.DB.prepare("SELECT platform_key, COUNT(*) AS n FROM social_links GROUP BY platform_key").all<{ platform_key: string; n: number }>();
    const n = new Map((counts.results ?? []).map((r) => [r.platform_key, r.n]));
    const issuer = resolveIssuer(c.env, c.req.url);
    return c.json({ platforms: (await listPlatforms(c.env.DB)).map((p) => ({ key: p.key, name: p.name, custom: p.custom, links: n.get(p.key) ?? 0, uploaded_icon: p.has_upload, icon_url: iconUrl(issuer, p.key, p.icon_version) })) }, 200);
  });

  app.openapi(adminAddRoute, async (c) => {
    if (!allowed(c)) return forbidden(c) as never;
    const name = c.req.valid("json").name.trim();
    if (!name) return c.json(errorBody("invalid_field", "名稱不可空白", c.get("requestId"), { field_key: "name", reason: "required" }), 422);
    const taken = new Set((await listPlatforms(c.env.DB)).map((p) => p.key));
    const key = platformKeyOf(name, (k) => taken.has(k));
    await addPlatform(c.env.DB, key, name, actor(c as never));
    return c.json({ key, name }, 200);
  });

  app.openapi(adminRenameRoute, async (c) => {
    if (!allowed(c)) return forbidden(c) as never;
    const name = c.req.valid("json").name.trim();
    if (!name) return c.json(errorBody("invalid_field", "名稱不可空白", c.get("requestId"), { field_key: "name", reason: "required" }), 422);
    if (!(await renamePlatform(c.env.DB, c.req.valid("param").key, name, actor(c as never)))) return c.json(errorBody("not_found", "找不到這個平台", c.get("requestId")), 404) as never;
    return c.json({ name }, 200);
  });

  app.openapi(adminDeleteRoute, async (c) => {
    if (!allowed(c)) return forbidden(c) as never;
    if (!(await deletePlatform(c.env.DB, c.req.valid("param").key, actor(c as never)))) return c.json(errorBody("not_found", "找不到這個平台（自定義不能刪除）", c.get("requestId")), 404) as never;
    return c.json({ deleted: true }, 200);
  });

  app.openapi(adminReorderRoute, async (c) => {
    if (!allowed(c)) return forbidden(c) as never;
    const { keys } = c.req.valid("json");
    const have = (await listPlatforms(c.env.DB)).map((p) => p.key).sort();
    if (keys.length !== have.length || new Set(keys).size !== keys.length || [...keys].sort().join("|") !== have.join("|")) {
      return c.json(errorBody("invalid_field", "順序必須包含每個平台各一次", c.get("requestId"), { field_key: "keys", reason: "incomplete" }), 422);
    }
    await reorderPlatforms(c.env.DB, keys, actor(c as never));
    return c.json({ saved: true }, 200);
  });

  app.openapi(adminIconRoute, async (c) => {
    if (!allowed(c)) return forbidden(c) as never;
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > PLATFORM_ICON_MAX_BYTES) return c.json(errorBody("too_large", "圖示太大（上限 32 KB）", c.get("requestId")), 413) as never;
    const mime = sniffImage(bytes);
    if (!mime) return c.json(errorBody("invalid_field", "請上傳 PNG、JPEG 或 WebP 圖片", c.get("requestId"), { field_key: "icon", reason: "not_an_image" }), 422) as never;
    if (!(await setPlatformIcon(c.env.DB, c.req.valid("param").key, mime, bytes, actor(c as never)))) return c.json(errorBody("not_found", "找不到這個平台", c.get("requestId")), 404) as never;
    return c.json({ saved: true }, 200);
  });

  app.openapi(adminIconResetRoute, async (c) => {
    if (!allowed(c)) return forbidden(c) as never;
    if (!(await setPlatformIcon(c.env.DB, c.req.valid("param").key, null, null, actor(c as never)))) return c.json(errorBody("not_found", "找不到這個平台", c.get("requestId")), 404) as never;
    return c.json({ reset: true }, 200);
  });
}

