// Admin APIs for staff (super admin, secretary, reviewer) on the central site itself.
// Authentication: the central sign-in session cookie (never app tokens). State-changing requests must come
// from this origin (CSRF protection). Every action is checked against the role matrix and audited.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { SESSION_COOKIE, readCookie } from "../auth/cookies";
import { findActiveSessionByToken, getMember } from "../db/identity";
import { listStaff, rolesOf, setRoles } from "../db/staff";
import { decideReview, listOptions, readAmwayFields, staffAdjust } from "../db/amway";
import { readNumbers } from "../db/member-numbers";
import { getActiveBinding, otherSide } from "../db/spouse";
import { auditStatement } from "../db/audit";
import { AMWAY_FIELDS, OTHER, REVIEWER_ADJUSTABLE, getAmwayField, validateAmwayValue } from "../amway/fields";
import { REAUTH_MAX_AGE, ROLES, ROLE_LABELS, UPLINE_FIELDS, can, permissionsOf, type Permission, type Role } from "../admin/roles";
import { isSameOriginWrite } from "../auth/csrf";
import { epochSeconds, taipeiIso } from "../lib/time";
import { completeDeletion, openRequests } from "../db/deletion";

type C = Context<AppBindings>;
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const common = { 401: err("unauthenticated or reauth_required"), 403: err("forbidden") };
const security = [{ session: [] }];
const Any = z.record(z.unknown());

function staffAuth(deps: Deps): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    c.header("cache-control", "no-store");
    if (!isSameOriginWrite(c)) return c.json(errorBody("forbidden", "Cross-site request refused", c.get("requestId")), 403);
    const token = readCookie(c, SESSION_COOKIE);
    const session = token ? await findActiveSessionByToken(c.env.DB, token, deps.now()) : null;
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const roles = await rolesOf(c.env.DB, session.member_id);
    if (!roles.length) return c.json(errorBody("forbidden", "Staff only", c.get("requestId")), 403);
    c.set("staff", { memberId: session.member_id, roles, authTime: session.auth_time_epoch });
    await next();
  };
}

function deny(c: C, p: Permission): Response | null {
  if (can(c.get("staff").roles, p)) return null;
  return c.json(errorBody("forbidden", "Not permitted for your role", c.get("requestId"), { required_permission: p }), 403);
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

const ctxOf = (c: C, deps: Deps) => ({ appId: null, requestId: c.get("requestId"), now: deps.now() });

// ---------- routes ----------

const meRoute = createRoute({ method: "get", path: "/v1/admin/me", tags: ["admin"], summary: "My staff roles and permissions", security, responses: { 200: { description: "Me", content: json(Any) }, ...common } });

const reviewsRoute = createRoute({ method: "get", path: "/v1/admin/reviews", tags: ["admin"], summary: "Pending review requests (oldest first)", security, responses: { 200: { description: "Queue", content: json(Any) }, ...common } });

const decisionRoute = createRoute({
  method: "post",
  path: "/v1/admin/reviews/{id}/decision",
  tags: ["admin"],
  summary: "Approve or reject a pending request (member is notified)",
  security,
  request: { params: z.object({ id: z.string().max(64) }), body: { required: true, content: json(z.object({ decision: z.enum(["approve", "reject"]) })) } },
  responses: { 200: { description: "Decided", content: json(Any) }, ...common, 404: err("not_found (not pending)") },
});

const membersRoute = createRoute({
  method: "get",
  path: "/v1/admin/members",
  tags: ["admin"],
  summary: "Find members by member number, member id, or display name",
  security,
  request: { query: z.object({ q: z.string().min(1).max(100) }) },
  responses: { 200: { description: "Matches (max 20)", content: json(Any) }, ...common },
});

const memberRoute = createRoute({
  method: "get",
  path: "/v1/admin/members/{member_id}",
  tags: ["admin"],
  summary: "Member detail for staff (numbers, Amway fields, spouse, roles)",
  security,
  request: { params: z.object({ member_id: z.string().max(64) }) },
  responses: { 200: { description: "Member", content: json(Any) }, ...common, 404: err("not_found") },
});

const adjustRoute = createRoute({
  method: "put",
  path: "/v1/admin/members/{member_id}/amway/{field_key}",
  tags: ["admin"],
  summary: "Adjust one of the six reviewed fields (treated as approved; member notified; audited)",
  security,
  request: {
    params: z.object({ member_id: z.string().max(64), field_key: z.string().max(64) }),
    body: { required: true, content: json(z.object({ value: z.union([z.string(), z.object({ option: z.string(), custom_text: z.string().nullable() }), z.null()]) })) },
  },
  responses: { 200: { description: "Adjusted", content: json(Any) }, ...common, 404: err("not_found"), 422: err("invalid_field") },
});

const optionsRoute = createRoute({ method: "get", path: "/v1/admin/amway/options", tags: ["admin"], summary: "All Amway option lists, including inactive ones", security, responses: { 200: { description: "Options", content: json(Any) }, ...common } });

const putOptionRoute = createRoute({
  method: "put",
  path: "/v1/admin/amway/options",
  tags: ["admin"],
  summary: "Create or update one option (rank sort_order = ladder position, low to high)",
  security,
  request: {
    body: {
      required: true,
      content: json(
        z.object({
          field_key: z.string().max(64),
          value: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
          label: z.string().trim().min(1).max(50),
          sort_order: z.number().int().min(0).max(100000),
          active: z.boolean(),
        }),
      ),
    },
  },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 422: err("invalid_field") },
});

const customUplinesRoute = createRoute({
  method: "get",
  path: "/v1/admin/amway/uplines/custom",
  tags: ["admin"],
  summary: "Merge page: custom upline names typed by members, with counts",
  security,
  responses: { 200: { description: "Custom names", content: json(Any) }, ...common },
});

const mergeRoute = createRoute({
  method: "post",
  path: "/v1/admin/amway/uplines/merge",
  tags: ["admin"],
  summary: "Merge page: fold one custom upline name into an existing option for every member",
  security,
  request: { body: { required: true, content: json(z.object({ field_key: z.enum(UPLINE_FIELDS), custom_text: z.string().min(1).max(50), into: z.string().max(32) })) } },
  responses: { 200: { description: "Merged", content: json(Any) }, ...common, 422: err("invalid_field") },
});

const staffRoute = createRoute({ method: "get", path: "/v1/admin/staff", tags: ["admin"], summary: "Staff and their roles", security, responses: { 200: { description: "Staff", content: json(Any) }, ...common } });

const putStaffRoute = createRoute({
  method: "put",
  path: "/v1/admin/staff/{member_id}",
  tags: ["admin"],
  summary: "Set a member's roles (super admin; needs a sign-in within 10 minutes)",
  security,
  request: { params: z.object({ member_id: z.string().max(64) }), body: { required: true, content: json(z.object({ roles: z.array(z.enum(ROLES)).max(3) })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("not_found"), 422: err("invalid_field") },
});

const auditRoute = createRoute({
  method: "get",
  path: "/v1/admin/audit",
  tags: ["admin"],
  summary: "Audit log (newest first). Contains no tokens, secrets, names, emails or Amway values.",
  security,
  request: {
    query: z.object({
      target_id: z.string().max(64).optional(),
      actor_id: z.string().max(64).optional(),
      action: z.string().max(64).optional(),
      before: z.string().max(40).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: { 200: { description: "Entries", content: json(Any) }, ...common },
});

const deletionsRoute = createRoute({
  method: "get",
  path: "/v1/admin/deletion-requests",
  tags: ["admin"],
  summary: "Open data deletion requests (due within 15 days of the request)",
  security,
  responses: { 200: { description: "Requests", content: json(Any) }, ...common },
});

const completeDeletionRoute = createRoute({
  method: "post",
  path: "/v1/admin/deletion-requests/{id}/complete",
  tags: ["admin"],
  summary: "Carry out a deletion request (account: anonymize and close; amway: remove Amway data). Needs a sign-in within 10 minutes.",
  security,
  request: { params: z.object({ id: z.string().max(64) }) },
  responses: { 200: { description: "Done", content: json(Any) }, ...common, 404: err("not_found") },
});

export function registerAdminRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/admin/*", staffAuth(deps));
  app.openAPIRegistry.registerComponent("securitySchemes", "session", { type: "apiKey", in: "cookie", name: "__Host-hgid_session" });

  app.openapi(meRoute, (c) => {
    const s = c.get("staff");
    return c.json({ member_id: s.memberId, roles: s.roles.map((r) => ({ role: r, label: ROLE_LABELS[r] })), permissions: permissionsOf(s.roles) }, 200);
  });

  app.openapi(reviewsRoute, async (c) => {
    const d = deny(c, "review");
    if (d) return d as never;
    const db = c.env.DB;
    const r = await db
      .prepare("SELECT id, member_id, field_key, requested_value, created_at, app_id FROM amway_review_requests WHERE status = 'pending' ORDER BY created_at LIMIT 200")
      .all<{ id: string; member_id: string; field_key: string; requested_value: string; created_at: string; app_id: string | null }>();
    const items = [];
    for (const x of r.results ?? []) {
      const current = (await readAmwayFields(db, x.member_id)).get(x.field_key);
      items.push({
        id: x.id,
        member_id: x.member_id,
        display_name: await displayName(db, x.member_id),
        member_number: (await readNumbers(db, x.member_id))[0] ?? null,
        field_key: x.field_key,
        field_label: getAmwayField(x.field_key)?.label ?? x.field_key,
        current_value: current?.value ?? null,
        requested_value: JSON.parse(x.requested_value) as unknown,
        created_at: x.created_at,
        app_id: x.app_id,
      });
    }
    return c.json({ reviews: items }, 200);
  });

  app.openapi(decisionRoute, async (c) => {
    const d = deny(c, "review");
    if (d) return d as never;
    const ok = await decideReview(c.env.DB, c.req.valid("param").id, c.req.valid("json").decision, c.get("staff").memberId, ctxOf(c, deps));
    if (!ok) return c.json(errorBody("not_found", "No pending request", c.get("requestId")), 404);
    return c.json({ decided: c.req.valid("json").decision }, 200);
  });

  app.openapi(membersRoute, async (c) => {
    const d = deny(c, "members.read");
    if (d) return d as never;
    const q = c.req.valid("query").q.trim();
    const db = c.env.DB;
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const r = await db
      .prepare(
        `SELECT DISTINCT m.id FROM members m
         LEFT JOIN member_numbers n ON n.member_id = m.id
         LEFT JOIN profile_field_values v ON v.member_id = m.id AND v.field_key = 'display_name'
         WHERE m.id = ? OR n.number = ? OR m.display_name LIKE ? ESCAPE '\\' OR v.value LIKE ? ESCAPE '\\'
         LIMIT 20`,
      )
      .bind(q, q.toUpperCase(), like, like)
      .all<{ id: string }>();
    const out = [];
    for (const x of r.results ?? []) {
      const m = await getMember(db, x.id);
      out.push({ member_id: x.id, display_name: await displayName(db, x.id), member_number: (await readNumbers(db, x.id))[0] ?? null, status: m?.status, amway_enabled: m?.amway_enabled === 1 });
    }
    return c.json({ members: out }, 200);
  });

  app.openapi(memberRoute, async (c) => {
    const d = deny(c, "members.read");
    if (d) return d as never;
    const db = c.env.DB;
    const id = c.req.valid("param").member_id;
    const m = await getMember(db, id);
    if (!m) return c.json(errorBody("not_found", "Member not found", c.get("requestId")), 404);
    const binding = await getActiveBinding(db, id);
    const fields = Object.fromEntries([...(await readAmwayFields(db, id))].map(([k, v]) => [k, v]));
    return c.json(
      {
        member_id: m.id,
        display_name: await displayName(db, id),
        status: m.status,
        registration_country: m.registration_country,
        created_at: m.created_at,
        amway_enabled: m.amway_enabled === 1,
        member_numbers: await readNumbers(db, id),
        amway: fields,
        spouse: binding ? { member_id: otherSide(binding, id), display_name: await displayName(db, otherSide(binding, id)), bound_at: binding.created_at, bound_by_this_member: binding.initiator_id === id } : null,
        staff_roles: await rolesOf(db, id),
      },
      200,
    );
  });

  app.openapi(adjustRoute, async (c) => {
    const d = deny(c, "adjust");
    if (d) return d as never;
    const { member_id, field_key } = c.req.valid("param");
    const def = getAmwayField(field_key);
    if (!def || !REVIEWER_ADJUSTABLE.includes(field_key)) return c.json(errorBody("not_found", "Field cannot be adjusted", c.get("requestId"), { field_key }), 404);
    if (!(await getMember(c.env.DB, member_id))) return c.json(errorBody("not_found", "Member not found", c.get("requestId")), 404);
    const options = (await listOptions(c.env.DB)).get(field_key) ?? [];
    const v = validateAmwayValue(def, c.req.valid("json").value, options);
    if (!v.ok) return c.json(errorBody("invalid_field", v.message, c.get("requestId"), { field_key, reason: v.reason }), 422);
    await staffAdjust(c.env.DB, member_id, field_key, v.value, c.get("staff").memberId, ctxOf(c, deps));
    return c.json({ member_id, field_key, value: v.value, status: "approved" }, 200);
  });

  app.openapi(optionsRoute, async (c) => {
    const d = deny(c, "options.manage");
    if (d) return d as never;
    const r = await c.env.DB.prepare("SELECT field_key, value, label, sort_order, active FROM amway_options ORDER BY field_key, sort_order, value").all();
    return c.json({ options: r.results ?? [], fields: AMWAY_FIELDS.filter((f) => f.type !== "text").map((f) => ({ key: f.key, label: f.label })) }, 200);
  });

  app.openapi(putOptionRoute, async (c) => {
    const d = deny(c, "options.manage");
    if (d) return d as never;
    const o = c.req.valid("json");
    const def = getAmwayField(o.field_key);
    const bad = (reason: string, message: string) => c.json(errorBody("invalid_field", message, c.get("requestId"), { field_key: o.field_key, reason }), 422);
    if (!def || def.type === "text") return bad("unknown_field", "此欄位沒有選項");
    if (o.value === OTHER) return bad("reserved", "「其他」是系統保留選項");
    if (o.field_key === "education_system" && o.value === "hglobal" && !o.active) return bad("reserved", "此選項不能停用");
    const now = deps.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO amway_options (field_key, value, label, sort_order, active) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (field_key, value) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order, active = excluded.active`,
      ).bind(o.field_key, o.value, o.label, o.sort_order, o.active ? 1 : 0),
      auditStatement(c.env.DB, { actorType: "staff", actorId: c.get("staff").memberId, action: "amway.option.set", targetType: "amway_option", targetId: `${o.field_key}:${o.value}`, result: "success", requestId: c.get("requestId"), detail: { sort_order: o.sort_order, active: o.active } }, now),
    ]);
    return c.json(o, 200);
  });

  app.openapi(customUplinesRoute, async (c) => {
    const d = deny(c, "uplines.merge");
    if (d) return d as never;
    const r = await c.env.DB.prepare(
      `SELECT field_key, json_extract(value, '$.custom_text') AS custom_text, COUNT(*) AS members FROM amway_field_values
       WHERE field_key IN ('upline_crown_ambassador','upline_diamond','upline_platinum') AND json_extract(value, '$.option') = 'other'
       GROUP BY field_key, custom_text ORDER BY field_key, members DESC, custom_text`,
    ).all();
    return c.json({ custom: r.results ?? [] }, 200);
  });

  app.openapi(mergeRoute, async (c) => {
    const d = deny(c, "uplines.merge");
    if (d) return d as never;
    const { field_key, custom_text, into } = c.req.valid("json");
    const options = (await listOptions(c.env.DB)).get(field_key) ?? [];
    if (into === OTHER || !options.some((o) => o.value === into)) {
      return c.json(errorBody("invalid_field", "請選擇現有的選項", c.get("requestId"), { field_key: "into", reason: "not_an_option" }), 422);
    }
    const now = deps.now();
    const [res] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE amway_field_values SET value = json_object('option', ?, 'custom_text', NULL), updated_at = ?
         WHERE field_key = ? AND json_extract(value, '$.option') = 'other' AND json_extract(value, '$.custom_text') = ?`,
      ).bind(into, taipeiIso(now), field_key, custom_text),
      auditStatement(c.env.DB, { actorType: "staff", actorId: c.get("staff").memberId, action: "amway.upline.merge", targetType: "amway_option", targetId: `${field_key}:${into}`, result: "success", requestId: c.get("requestId") }, now),
    ]);
    return c.json({ field_key, into, members_updated: res?.meta.changes ?? 0 }, 200);
  });

  app.openapi(staffRoute, async (c) => {
    const d = deny(c, "staff.manage");
    if (d) return d as never;
    const list = await listStaff(c.env.DB);
    return c.json({ staff: await Promise.all(list.map(async (s) => ({ ...s, display_name: await displayName(c.env.DB, s.member_id) }))), roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] })) }, 200);
  });

  app.openapi(putStaffRoute, async (c) => {
    const d = deny(c, "staff.manage");
    if (d) return d as never;
    const staff = c.get("staff");
    if (epochSeconds(deps.now()) - staff.authTime > REAUTH_MAX_AGE) {
      return c.json(errorBody("reauth_required", "請重新登入後再試", c.get("requestId"), { login_url: "/login?return_to=%2F" }), 401);
    }
    const { member_id } = c.req.valid("param");
    if (!(await getMember(c.env.DB, member_id))) return c.json(errorBody("not_found", "Member not found", c.get("requestId")), 404);
    const roles = [...new Set(c.req.valid("json").roles)] as Role[];
    const ok = await setRoles(c.env.DB, member_id, roles, staff.memberId, c.get("requestId"), deps.now());
    if (!ok) return c.json(errorBody("invalid_field", "至少要保留一位超級管理員", c.get("requestId"), { field_key: "roles", reason: "last_super_admin" }), 422);
    return c.json({ member_id, roles }, 200);
  });

  app.openapi(deletionsRoute, async (c) => {
    const d = deny(c, "deletion.execute");
    if (d) return d as never;
    const rows = await openRequests(c.env.DB);
    return c.json({ requests: await Promise.all(rows.map(async (r) => ({ ...r, display_name: await displayName(c.env.DB, r.member_id) }))) }, 200);
  });

  app.openapi(completeDeletionRoute, async (c) => {
    const d = deny(c, "deletion.execute");
    if (d) return d as never;
    const staff = c.get("staff");
    if (epochSeconds(deps.now()) - staff.authTime > REAUTH_MAX_AGE) {
      return c.json(errorBody("reauth_required", "請重新登入後再試", c.get("requestId"), { login_url: "/login?return_to=%2Fadmin" }), 401);
    }
    const ok = await completeDeletion(c.env.DB, c.req.valid("param").id, staff.memberId, deps.now(), c.get("requestId"));
    if (!ok) return c.json(errorBody("not_found", "No open request", c.get("requestId")), 404);
    return c.json({ completed: true }, 200);
  });

  app.openapi(auditRoute, async (c) => {
    const d = deny(c, "audit.read");
    if (d) return d as never;
    const q = c.req.valid("query");
    const where: string[] = [];
    const args: (string | number)[] = [];
    const filters: [string, string | undefined][] = [
      ["target_id = ?", q.target_id],
      ["actor_id = ?", q.actor_id],
      ["action = ?", q.action],
      ["occurred_at < ?", q.before],
    ];
    for (const [cond, v] of filters) {
      if (v === undefined) continue;
      where.push(cond);
      args.push(v);
    }
    const sql = `SELECT id, occurred_at, actor_type, actor_id, action, target_type, target_id, result, app_id, request_id, detail FROM audit_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY occurred_at DESC, id DESC LIMIT ?`;
    const r = await c.env.DB.prepare(sql).bind(...args, q.limit ?? 50).all();
    return c.json({ entries: r.results ?? [] }, 200);
  });
}
