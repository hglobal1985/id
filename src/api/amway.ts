// Amway area APIs (integration instruction pack, section 4) and in-site notifications.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { getMember } from "../db/identity";
import { consentIsCurrent, latestConsent, listOptions, readAmwayFields, setAmwayEnabled, writeAmwayField } from "../db/amway";
import { AMWAY_FIELDS, getAmwayField, validateAmwayValue, type AmwayValue } from "../amway/fields";
import { CONSENT_DOCUMENT, CONSENT_SHORT, CONSENT_VERSION } from "../amway/consent";
import { resolveIssuer } from "../oidc/config";
import { bearerAuth, missingScope } from "./auth";
import { taipeiIso } from "../lib/time";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const security = [{ bearer: [] }];
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const common = { 401: err("unauthenticated"), 403: err("forbidden (scope) or consent_required") };

const AmwayValueSchema = z
  .union([z.string(), z.object({ option: z.string(), custom_text: z.string().nullable() }), z.null()])
  .openapi("AmwayValue");
const StatusSchema = z.enum(["pending", "approved", "rejected", "not_required"]);
const FieldStateSchema = z.object({ value: AmwayValueSchema, pending_value: AmwayValueSchema, status: StatusSchema, updated_at: z.string().nullable() });

const definitionsRoute = createRoute({
  method: "get",
  path: "/v1/amway/field-definitions",
  tags: ["amway"],
  summary: "Amway field definitions and option lists (cache up to 1 hour). Rank options are in ladder order.",
  security,
  responses: { 200: { description: "Definitions", content: json(z.record(z.unknown()).openapi("AmwayFieldDefinitions")) }, ...common },
});
const consentRoute = createRoute({
  method: "get",
  path: "/v1/amway/consent",
  tags: ["amway"],
  summary: "Consent text (short version) and version. Render as given; never hard-code (cache up to 1 hour).",
  security,
  responses: { 200: { description: "Consent", content: json(z.record(z.unknown()).openapi("AmwayConsent")) }, ...common },
});
const meRoute = createRoute({
  method: "get",
  path: "/v1/me/amway",
  tags: ["amway"],
  summary: "My Amway data and review status (do not cache)",
  security,
  responses: {
    200: {
      description: "State",
      content: json(
        z
          .object({
            enabled: z.boolean(),
            consent: z.object({ version: z.string(), accepted_at: z.string(), current: z.boolean() }).nullable(),
            current_consent_version: z.string(),
            fields: z.record(FieldStateSchema),
          })
          .openapi("MyAmway"),
      ),
    },
    ...common,
  },
});
const enabledRoute = createRoute({
  method: "put",
  path: "/v1/me/amway/enabled",
  tags: ["amway"],
  summary: "Turn 「我是Amway會員」 on (needs the current consent_version) or off (data kept, eligibility paused)",
  security,
  request: { body: { required: true, content: json(z.object({ enabled: z.boolean(), consent_version: z.string().max(20).optional() })) } },
  responses: { 200: { description: "Saved", content: json(z.object({ enabled: z.boolean() })) }, ...common, 422: err("invalid_field") },
});
const fieldRoute = createRoute({
  method: "put",
  path: "/v1/me/amway/fields/{field_key}",
  tags: ["amway"],
  summary: "Write one Amway field. Reviewed fields stay pending (old value effective) until approved.",
  security,
  request: { params: z.object({ field_key: z.string().max(64) }), body: { required: true, content: json(z.object({ value: AmwayValueSchema })) } },
  responses: { 200: { description: "Saved", content: json(FieldStateSchema.extend({ field_key: z.string() })) }, ...common, 404: err("not_found"), 422: err("invalid_field") },
});

const NotificationSchema = z
  .object({ id: z.string(), kind: z.string(), title: z.string(), body: z.string(), created_at: z.string(), read: z.boolean(), actions: z.array(z.string()) })
  .openapi("Notification");
const notificationsRoute = createRoute({
  method: "get",
  path: "/v1/me/notifications",
  tags: ["notifications"],
  summary: "My in-site notifications (latest 50)",
  security,
  responses: { 200: { description: "Notifications", content: json(z.object({ notifications: z.array(NotificationSchema), unread: z.number().int() })) }, ...common },
});
const readRoute = createRoute({
  method: "post",
  path: "/v1/me/notifications/{id}/read",
  tags: ["notifications"],
  summary: "Mark a notification as read",
  security,
  request: { params: z.object({ id: z.string().max(64) }) },
  responses: { 200: { description: "Marked", content: json(z.object({ read: z.literal(true) })) }, ...common, 404: err("not_found") },
});

export function registerAmwayRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/amway/*", bearerAuth(deps));

  app.openapi(definitionsRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const options = await listOptions(c.env.DB);
    c.header("cache-control", "private, max-age=3600");
    return c.json(
      {
        enabled_label: "我是Amway會員",
        fields: AMWAY_FIELDS.map((f) => ({
          key: f.key,
          order: f.order,
          label: f.label,
          ...(f.help ? { help: f.help } : {}),
          type: f.type,
          ...(f.max_length ? { max_length: f.max_length } : {}),
          ...(f.type !== "text" ? { options: options.get(f.key) ?? [] } : {}),
          visible_when: f.visible_when,
          read_only: false,
          scope: "amway.write",
          status_labels: { pending: "等待審核中", approved: "已審核", rejected: "未通過審核", not_required: "" },
        })),
      },
      200,
    );
  });

  app.openapi(consentRoute, (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    c.header("cache-control", "private, max-age=3600");
    const { full_privacy_path, ...text } = CONSENT_SHORT;
    return c.json({ document: CONSENT_DOCUMENT, version: CONSENT_VERSION, ...text, full_privacy_url: `${resolveIssuer(c.env, c.req.url)}${full_privacy_path}` }, 200);
  });

  app.openapi(meRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const { memberId } = c.get("auth");
    const member = await getMember(c.env.DB, memberId);
    const consent = await latestConsent(c.env.DB, memberId);
    const rows = await readAmwayFields(c.env.DB, memberId);
    const fields: Record<string, { value: AmwayValue; pending_value: AmwayValue; status: string; updated_at: string | null }> = {};
    for (const f of AMWAY_FIELDS) {
      const r = rows.get(f.key);
      fields[f.key] = r ? { value: r.value, pending_value: r.pending_value, status: r.status, updated_at: r.updated_at } : { value: null, pending_value: null, status: "not_required", updated_at: null };
    }
    return c.json(
      {
        enabled: member?.amway_enabled === 1,
        consent: consent ? { ...consent, current: consentIsCurrent(consent) } : null,
        current_consent_version: CONSENT_VERSION,
        fields,
      },
      200,
    );
  });

  app.openapi(enabledRoute, async (c) => {
    const denied = missingScope(c, ["amway.write"]);
    if (denied) return denied as never;
    const { enabled, consent_version } = c.req.valid("json");
    const { memberId, clientId } = c.get("auth");
    if (enabled && consent_version !== CONSENT_VERSION) {
      return c.json(errorBody("consent_required", "請閱讀並同意最新的同意說明", c.get("requestId"), { current_version: CONSENT_VERSION }), 403);
    }
    await setAmwayEnabled(c.env.DB, memberId, enabled, { appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    return c.json({ enabled }, 200);
  });

  app.openapi(fieldRoute, async (c) => {
    const { field_key } = c.req.valid("param");
    const def = getAmwayField(field_key);
    if (!def) return c.json(errorBody("not_found", "Unknown field", c.get("requestId"), { field_key }), 404);
    const denied = missingScope(c, ["amway.write"]);
    if (denied) return denied as never;
    const { memberId, clientId } = c.get("auth");
    const member = await getMember(c.env.DB, memberId);
    if (member?.amway_enabled !== 1 || !consentIsCurrent(await latestConsent(c.env.DB, memberId))) {
      return c.json(errorBody("consent_required", "請先勾選「我是Amway會員」並同意說明", c.get("requestId"), { current_version: CONSENT_VERSION }), 403);
    }
    const options = (await listOptions(c.env.DB)).get(field_key) ?? [];
    const v = validateAmwayValue(def, c.req.valid("json").value, options);
    if (!v.ok) return c.json(errorBody("invalid_field", v.message, c.get("requestId"), { field_key, reason: v.reason }), 422);
    const r = await writeAmwayField(c.env.DB, memberId, field_key, v.value, { appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    if (!r.ok) return c.json(errorBody("invalid_field", r.message, c.get("requestId"), { field_key, reason: r.reason }), 422);
    return c.json({ field_key, value: r.row.value, pending_value: r.row.pending_value, status: r.row.status, updated_at: r.row.updated_at }, 200);
  });

  app.openapi(notificationsRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    const { memberId } = c.get("auth");
    const rows = await c.env.DB.prepare("SELECT id, kind, payload, created_at, read_at FROM notifications WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 50")
      .bind(memberId)
      .all<{ id: string; kind: string; payload: string | null; created_at: string; read_at: string | null }>();
    const list = await Promise.all((rows.results ?? []).map((r) => renderNotification(c.env.DB, memberId, r)));
    const unread = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL").bind(memberId).first<{ n: number }>();
    return c.json({ notifications: list, unread: unread?.n ?? 0 }, 200);
  });

  app.openapi(readRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    const res = await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND member_id = ?")
      .bind(taipeiIso(deps.now()), c.req.valid("param").id, c.get("auth").memberId)
      .run();
    if (!res.meta.changes) return c.json(errorBody("not_found", "Not found", c.get("requestId")), 404);
    return c.json({ read: true as const }, 200);
  });
}

/** Member-facing text. Never names another system. */
async function renderNotification(
  db: D1Database,
  memberId: string,
  r: { id: string; kind: string; payload: string | null; created_at: string; read_at: string | null },
) {
  let payload: Record<string, string> = {};
  try {
    payload = r.payload ? (JSON.parse(r.payload) as Record<string, string>) : {};
  } catch {
    payload = {};
  }
  const label = payload.field_key ? (getAmwayField(payload.field_key)?.label ?? "資料") : "資料";
  let title = "通知";
  let body = "";
  let actions: string[] = [];
  switch (r.kind) {
    case "spouse.bound": {
      const b = await db.prepare("SELECT initiator_id, ended_at FROM spouse_bindings WHERE id = ?").bind(payload.binding_id ?? "").first<{ initiator_id: string; ended_at: string | null }>();
      const name = b ? await displayName(db, b.initiator_id) : null;
      title = "夫妻綁定";
      body = `${name ?? "一位會員"} 已將您綁定為夫妻，雙方將共用獎銜與會員編號。若非本人意願，可一鍵解除。`;
      actions = b && !b.ended_at ? ["unbind_spouse"] : [];
      break;
    }
    case "spouse.unbound":
      title = "夫妻綁定已解除";
      body = "您的夫妻綁定已解除。";
      break;
    case "amway.review.approved":
      title = "審核通過";
      body = `您的「${label}」已審核通過。`;
      break;
    case "amway.review.rejected":
      title = "審核未通過";
      body = `您的「${label}」未通過審核，已維持原本的資料。`;
      break;
    case "staff.review.requested":
      title = "新的審核申請";
      body = "有會員送出需要審核的資料，請到後台處理。";
      actions = ["open_review_queue"];
      break;
    case "amway.review.adjusted":
      title = "資料已調整";
      body = `管理人員已調整您的「${label}」。`;
      break;
  }
  void memberId;
  return { id: r.id, kind: r.kind, title, body, created_at: r.created_at, read: r.read_at !== null, actions };
}

async function displayName(db: D1Database, memberId: string): Promise<string | null> {
  const dn = await db.prepare("SELECT value FROM profile_field_values WHERE member_id = ? AND field_key = 'display_name'").bind(memberId).first<{ value: string }>();
  if (dn) {
    try {
      return JSON.parse(dn.value) as string;
    } catch {
      /* fall through */
    }
  }
  return (await getMember(db, memberId))?.display_name ?? null;
}
