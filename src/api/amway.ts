// Amway area APIs (integration instruction pack, section 4) and in-site notifications.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { getMember } from "../db/identity";
import { isHglobalMember, listOptions, readAmwayFields, setAmwayEnabled, writeAmwayField } from "../db/amway";
import { canonicalTerms, recordTerms } from "../db/vocab";
import { resetRandomNumber } from "../db/member-numbers";
import { getActiveBinding, unbindSpouse } from "../db/spouse";
import { amwayDefault, isForcedPublic, visibilityOf } from "../profile/visibility";
import { readProfile } from "../db/profile";
import { isPool } from "../vocab/terms";
import { loadLayout } from "../db/layout";
import { AMWAY_FIELDS, getAmwayField, validateAmwayValue, type AmwayValue } from "../amway/fields";
import { bearerAuth, missingScope } from "./auth";
import { taipeiIso } from "../lib/time";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const security = [{ bearer: [] }];
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const common = { 401: err("unauthenticated"), 403: err("forbidden (scope) or amway_disabled") };

const AmwayValueSchema = z
  .union([z.string(), z.object({ option: z.string(), custom_text: z.string().nullable() }), z.null()])
  .openapi("AmwayValue");
const StatusSchema = z.enum(["pending", "approved", "rejected", "not_required"]);
const FieldStateSchema = z.object({ value: AmwayValueSchema, pending_value: AmwayValueSchema, status: StatusSchema, updated_at: z.string().nullable() });

const definitionsRoute = createRoute({
  method: "get",
  path: "/v1/amway/field-definitions",
  tags: ["amway"],
  summary: "Amway field definitions and option lists in the order the super admin set (cache up to 5 minutes). Rank options are in ladder order.",
  security,
  responses: { 200: { description: "Definitions", content: json(z.record(z.unknown()).openapi("AmwayFieldDefinitions")) }, ...common },
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
            hglobal: z.boolean().openapi({ description: "The training system (effective or pending) is a term marked as H-Global1985: the regional education center offers its own related words (field definition suggest_when_hglobal)." }),
            fields: z.record(FieldStateSchema.extend({ visibility: z.enum(["public", "private"]) })),
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
  summary: "Turn 「我是Amway會員」 on or off at once, no confirmation step (off keeps the data, pauses eligibility and gives the member a new random member number)",
  security,
  request: { body: { required: true, content: json(z.object({ enabled: z.boolean() })) } },
  responses: { 200: { description: "Saved", content: json(z.object({ enabled: z.boolean(), member_number: z.array(z.object({ country: z.string(), number: z.string() })).optional().openapi({ description: "Present when turned off: the new random member number (only Amway members keep a number of their own choosing; a bound spouse is unbound first)." }) })) }, ...common, 422: err("invalid_field") },
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

const readAllRoute = createRoute({
  method: "post",
  path: "/v1/me/notifications/read-all",
  tags: ["notifications"],
  summary: "Mark all my notifications as read",
  security,
  responses: { 200: { description: "Marked", content: json(z.object({ read: z.literal(true) })) }, ...common },
});

export function registerAmwayRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/amway/*", bearerAuth(deps));

  app.openapi(definitionsRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const options = await listOptions(c.env.DB);
    const layout = await loadLayout(c.env.DB);
    c.header("cache-control", "private, max-age=300");
    return c.json(
      {
        enabled_label: "我是Amway會員",
        fields: AMWAY_FIELDS.map((f) => ({
          key: f.key,
          order: layout.get(f.key) ?? f.order,
          label: f.label,
          ...(f.help ? { help: f.help } : {}),
          type: f.type,
          ...(f.max_length ? { max_length: f.max_length } : {}),
          ...(f.type !== "text" ? { options: options.get(f.key) ?? [] } : {}),
          ...(f.suggest ? { suggest: f.suggest } : {}),
          ...(f.suggest_when_hglobal ? { suggest_when_hglobal: true } : {}),
          visible_when: f.visible_when,
          read_only: false,
          scope: "amway.write",
          visibility: isForcedPublic(f.key) ? { configurable: false, default: "public" } : { configurable: true, default: amwayDefault(f.key) },
          status_labels: { pending: "等待審核中", approved: "已審核", rejected: "未通過審核", not_required: "" },
        })),
      },
      200,
    );
  });

  app.openapi(meRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const { memberId } = c.get("auth");
    const member = await getMember(c.env.DB, memberId);
    const rows = await readAmwayFields(c.env.DB, memberId);
    const { visibility } = await readProfile(c.env.DB, memberId);
    const fields: Record<string, { value: AmwayValue; pending_value: AmwayValue; status: string; updated_at: string | null; visibility: "public" | "private" }> = {};
    for (const f of AMWAY_FIELDS) {
      const r = rows.get(f.key);
      const vis = visibilityOf(f.key, visibility.get(f.key), amwayDefault(f.key));
      fields[f.key] = r ? { value: r.value, pending_value: r.pending_value, status: r.status, updated_at: r.updated_at, visibility: vis } : { value: null, pending_value: null, status: "not_required", updated_at: null, visibility: vis };
    }
    const hglobal = await isHglobalMember(c.env.DB, memberId);
    return c.json({ enabled: member?.amway_enabled === 1, hglobal, fields }, 200);
  });

  app.openapi(enabledRoute, async (c) => {
    const denied = missingScope(c, ["amway.write"]);
    if (denied) return denied as never;
    const { enabled } = c.req.valid("json");
    const { memberId, clientId } = c.get("auth");
    const now = deps.now();
    await setAmwayEnabled(c.env.DB, memberId, enabled, { appId: clientId, requestId: c.get("requestId"), now });
    if (enabled) return c.json({ enabled }, 200);
    // Turning it off: the member number becomes a fresh random one (a couple bound by an Amway number is unbound first).
    const binding = await getActiveBinding(c.env.DB, memberId);
    if (binding) await unbindSpouse(c.env.DB, { memberId, binding, fallbackCountry: "TW", appId: clientId, requestId: c.get("requestId"), now });
    const member_number = await resetRandomNumber(c.env.DB, memberId, now, c.get("requestId"));
    return c.json({ enabled, member_number }, 200);
  });

  app.openapi(fieldRoute, async (c) => {
    const { field_key } = c.req.valid("param");
    const def = getAmwayField(field_key);
    if (!def) return c.json(errorBody("not_found", "Unknown field", c.get("requestId"), { field_key }), 404);
    const denied = missingScope(c, ["amway.write"]);
    if (denied) return denied as never;
    const { memberId, clientId } = c.get("auth");
    const member = await getMember(c.env.DB, memberId);
    if (member?.amway_enabled !== 1) {
      return c.json(errorBody("amway_disabled", "請先勾選「我是Amway會員」", c.get("requestId")), 403);
    }
    const options = (await listOptions(c.env.DB)).get(field_key) ?? [];
    const v = validateAmwayValue(def, c.req.valid("json").value, options);
    if (!v.ok) return c.json(errorBody("invalid_field", v.message, c.get("requestId"), { field_key, reason: v.reason }), 422);
    // Free-text fields: an existing spelling in the vocabulary wins, and the typed word is remembered.
    const pool = def.suggest && isPool(def.suggest) ? def.suggest : null;
    // The regional center vocabulary belongs to H-Global1985 members only; for everyone else the field is plain text.
    if (pool && typeof v.value === "string" && (!def.suggest_when_hglobal || (await isHglobalMember(c.env.DB, memberId)))) {
      v.value = (await canonicalTerms(c.env.DB, pool, [v.value]))[0] ?? v.value;
      await recordTerms(c.env.DB, pool, [v.value], deps.now());
    }
    const r = await writeAmwayField(c.env.DB, memberId, field_key, v.value, { appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    if (!r.ok) return c.json(errorBody("invalid_field", r.message, c.get("requestId"), { field_key, reason: r.reason }), 422);
    return c.json({ field_key, value: r.row.value, pending_value: r.row.pending_value, status: r.row.status, updated_at: r.row.updated_at }, 200);
  });

  app.openapi(notificationsRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    const { memberId } = c.get("auth");
    const rows = await c.env.DB.prepare("SELECT id, kind, payload, created_at, read_at FROM notifications WHERE member_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50")
      .bind(memberId)
      .all<{ id: string; kind: string; payload: string | null; created_at: string; read_at: string | null }>();
    const list = await Promise.all((rows.results ?? []).map((r) => renderNotification(c.env.DB, memberId, r)));
    const unread = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL").bind(memberId).first<{ n: number }>();
    return c.json({ notifications: list, unread: unread?.n ?? 0 }, 200);
  });

  app.openapi(readAllRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL").bind(taipeiIso(deps.now()), c.get("auth").memberId).run();
    return c.json({ read: true as const }, 200);
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
