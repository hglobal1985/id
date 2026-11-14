// Admin APIs for staff (super admin, secretary, reviewer) on the central site itself.
// Authentication: the central sign-in session cookie (never app tokens). State-changing requests must come
// from this origin (CSRF protection). Every action is checked against the role matrix and audited.
import { kickDelivery } from "../webhooks/notify";
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { SESSION_COOKIE, readCookie } from "../auth/cookies";
import { getMember } from "../db/identity";
import { centerNormOfMember, grantsOfMember, listStaff, rolesOf, setRoles, staffContextByToken } from "../db/staff";
import { avatarKey, dropFiles } from "../lib/files";
import { memberBriefs, type MemberBrief } from "../db/member-bulk";
import { hasDiamondRank, memberInScope, memberScopeOf, searchMemberIds } from "../db/member-scope";
import { deleteAccount } from "../db/deletion";
import { auditStatement } from "../db/audit";
import { decideReview, listOptions, readAmwayFields, staffAdjust } from "../db/amway";
import { readNumbers } from "../db/member-numbers";
import { getActiveBinding, otherSide } from "../db/spouse";
import { REVIEWER_ADJUSTABLE, getAmwayField, isNone, validateAmwayValue } from "../amway/fields";
import { FEATURES, PERMISSION_INFO, PERMISSIONS, ROLE_GRANTS, ROLES, ROLE_LABELS, SCOPE_LABELS, can, grantsOf, hasGrant, permissionsOf, validateGrants, type Permission, type Role } from "../admin/roles";
import { isSameOriginWrite } from "../auth/csrf";
import { epochSeconds, taipeiIso } from "../lib/time";
import { addTerm, deleteTerm, listTerms, mergeTerms, moveTerm, renameTerm, setHglobalTerm } from "../db/vocab";
import { CLOSED_POOLS, ORDERED_POOLS, POOLS, POOL_KEYS, isPool } from "../vocab/terms";
import { loadOverview } from "../db/overview";
import { loadLayout, saveLayout } from "../db/layout";
import { BLOCK_PREFIX, LAYOUT_GROUPS, LAYOUT_GROUP_LABELS, defaultLayout, validateLayout } from "../profile/layout";

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
    const found = token ? await staffContextByToken(c.env.DB, token, deps.now()) : null;
    if (!found) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const { session, roles, grants } = found;
    if (!roles.length && !grants.length) return c.json(errorBody("forbidden", "Staff only", c.get("requestId")), 403);
    c.set("staff", { memberId: session.member_id, roles, grants, authTime: session.auth_time_epoch });
    await next();
  };
}

function deny(c: C, p: Permission): Response | null {
  const st = c.get("staff");
  if (can(st.roles, p, st.grants)) return null;
  return c.json(errorBody("forbidden", "Not permitted for your role", c.get("requestId"), { required_permission: p }), 403);
}

async function centerTextOf(db: D1Database, memberId: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM amway_field_values WHERE member_id = ? AND field_key = 'education_center'").bind(memberId).first<{ value: string | null }>();
  try {
    const v = r?.value ? (JSON.parse(r.value) as unknown) : null;
    return typeof v === "string" && !isNone(v) ? v : null;
  } catch {
    return null;
  }
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

const overviewRoute = createRoute({ method: "get", path: "/v1/admin/overview", tags: ["admin"], summary: "Back-office home: counts and traffic lights (any staff role)", security, responses: { 200: { description: "Overview", content: json(Any) }, ...common } });

const reviewsRoute = createRoute({ method: "get", path: "/v1/admin/reviews", tags: ["admin"], summary: "Pending review requests (oldest first)", security, responses: { 200: { description: "Queue", content: json(Any) }, ...common } });

const historyRoute = createRoute({ method: "get", path: "/v1/admin/reviews/history", tags: ["admin"], summary: "Decided review requests with the name of the person who decided (newest first; a reviewer sees only the own center)", security, responses: { 200: { description: "History", content: json(Any) }, ...common } });

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
  summary: "Look up members (read only). Without any filter it lists the members the staff member may see, newest first. What is visible depends on the position: own regional center, 寰宇 for 會長, everyone for the head office and for 鑽石級以上獎銜.",
  security,
  request: {
    query: z.object({
      q: z.string().max(100).optional(),
      system: z.string().max(60).optional(),
      center: z.string().max(60).optional(),
      rank: z.string().max(40).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      amway: z.enum(["yes", "no"]).optional(),
      country: z.string().max(4).optional(),
      offset: z.coerce.number().int().min(0).max(100000).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: { 200: { description: "Members, total and the scope", content: json(Any) }, ...common },
});

const filtersRoute = createRoute({ method: "get", path: "/v1/admin/member-filters", tags: ["admin"], summary: "Choices for the member filters (systems, centers, ranks, countries)", security, responses: { 200: { description: "Choices", content: json(Any) }, ...common } });

const permissionsRoute = createRoute({ method: "get", path: "/v1/admin/permissions", tags: ["admin"], summary: "The permission table (who may do what) for the 權限 page", security, responses: { 200: { description: "Dot chart data", content: json(Any) }, ...common } });

const catalogRoute = createRoute({ method: "get", path: "/v1/admin/permission-catalog", tags: ["admin"], summary: "Permissions (with the scopes each can have) and the default permissions of every position, for the position-and-permission screen", security, responses: { 200: { description: "Catalog", content: json(Any) }, ...common } });

const memberStatusRoute = createRoute({
  method: "post",
  path: "/v1/admin/members/{member_id}/status",
  tags: ["admin"],
  summary: "Suspend (disabled) or reinstate (active) a member; a suspended member is signed out everywhere (head office)",
  security,
  request: { params: z.object({ member_id: z.string().max(64) }), body: { required: true, content: json(z.object({ status: z.enum(["active", "disabled"]) })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("not_found"), 409: err("last_super_admin or self") },
});

const memberDeleteRoute = createRoute({
  method: "post",
  path: "/v1/admin/members/{member_id}/delete",
  tags: ["admin"],
  summary: "Delete a member (anonymizes and closes the account at once; head office)",
  security,
  request: { params: z.object({ member_id: z.string().max(64) }) },
  responses: { 200: { description: "Deleted", content: json(Any) }, ...common, 404: err("not_found"), 409: err("last_super_admin or self") },
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

const layoutGetRoute = createRoute({ method: "get", path: "/v1/admin/profile-layout", tags: ["admin"], summary: "Order of the profile fields on every member page, per group (super admin)", security, responses: { 200: { description: "Layout", content: json(Any) }, ...common } });
const layoutPutRoute = createRoute({
  method: "put",
  path: "/v1/admin/profile-layout",
  tags: ["admin"],
  summary: "Save the order of the fields of every group (each group must list exactly its fields); null resets to the built-in order",
  security,
  request: { body: { required: true, content: json(z.object({ order: z.record(z.array(z.string().max(64))).nullable() })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 422: err("invalid_field") },
});

const PoolParam = z.object({ pool: z.string().max(40) });
const vocabPoolsRoute = createRoute({ method: "get", path: "/v1/admin/vocab", tags: ["admin"], summary: "Suggestion vocabularies (super admin): pools with their term counts", security, responses: { 200: { description: "Pools", content: json(Any) }, ...common } });
const vocabTermsRoute = createRoute({
  method: "get",
  path: "/v1/admin/vocab/{pool}",
  tags: ["admin"],
  summary: "Terms of one vocabulary with use counts (most used first)",
  security,
  request: { params: PoolParam },
  responses: { 200: { description: "Terms", content: json(Any) }, ...common, 404: err("not_found") },
});
const vocabAddRoute = createRoute({
  method: "post",
  path: "/v1/admin/vocab/{pool}/add",
  tags: ["admin"],
  summary: "Add a term by hand",
  security,
  request: { params: PoolParam, body: { required: true, content: json(z.object({ term: z.string().min(1).max(100) })) } },
  responses: { 200: { description: "Added", content: json(Any) }, ...common, 404: err("not_found"), 422: err("invalid_field") },
});
const vocabRenameRoute = createRoute({
  method: "post",
  path: "/v1/admin/vocab/{pool}/rename",
  tags: ["admin"],
  summary: "Edit a term; saved values follow. Renaming into an existing term merges the two.",
  security,
  request: { params: PoolParam, body: { required: true, content: json(z.object({ from: z.string().min(1).max(100), to: z.string().min(1).max(100) })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("not_found"), 422: err("invalid_field") },
});
const vocabMoveRoute = createRoute({
  method: "post",
  path: "/v1/admin/vocab/{pool}/move",
  tags: ["admin"],
  summary: "Move a term one place up or down (only pools kept in the administrator's order: 行業類別, 地區教育中心)",
  security,
  request: { params: PoolParam, body: { required: true, content: json(z.object({ term: z.string().min(1).max(100), direction: z.enum(["up", "down"]) })) } },
  responses: { 200: { description: "Moved (or already at the end)", content: json(Any) }, ...common, 404: err("not_found"), 422: err("invalid_field") },
});
const vocabMergeRoute = createRoute({
  method: "post",
  path: "/v1/admin/vocab/{pool}/merge",
  tags: ["admin"],
  summary: "Merge several terms into one (saved values follow)",
  security,
  request: { params: PoolParam, body: { required: true, content: json(z.object({ froms: z.array(z.string().min(1).max(100)).min(1).max(50), into: z.string().min(1).max(100) })) } },
  responses: { 200: { description: "Merged", content: json(Any) }, ...common, 404: err("not_found"), 422: err("invalid_field") },
});
const vocabDeleteRoute = createRoute({
  method: "post",
  path: "/v1/admin/vocab/{pool}/delete",
  tags: ["admin"],
  summary: "Delete a term from the suggestions (values members already saved stay as they are)",
  security,
  request: { params: PoolParam, body: { required: true, content: json(z.object({ term: z.string().min(1).max(100) })) } },
  responses: { 200: { description: "Deleted", content: json(Any) }, ...common, 404: err("not_found") },
});
const vocabHglobalRoute = createRoute({
  method: "post",
  path: "/v1/admin/vocab/education_system/hglobal",
  tags: ["admin"],
  summary: "Mark or unmark a 直銷商培訓系統 term as meaning H-Global1985 (needs review; unlocks eligibility)",
  security,
  request: { body: { required: true, content: json(z.object({ term: z.string().min(1).max(100), hglobal: z.boolean() })) } },
  responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("not_found") },
});

const staffRoute = createRoute({ method: "get", path: "/v1/admin/staff", tags: ["admin"], summary: "Staff and their roles", security, responses: { 200: { description: "Staff", content: json(Any) }, ...common } });

const putStaffRoute = createRoute({
  method: "put",
  path: "/v1/admin/staff/{member_id}",
  tags: ["admin"],
  summary: "Set a member's roles (super admin; needs a sign-in within 10 minutes)",
  security,
  request: { params: z.object({ member_id: z.string().max(64) }), body: { required: true, content: json(z.object({ roles: z.array(z.enum(ROLES)).max(ROLES.length), grants: z.array(z.object({ permission: z.string().max(40), scope: z.string().max(10) })).max(60).optional() })) } },
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

export function registerAdminRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/admin/*", staffAuth(deps));
  app.openAPIRegistry.registerComponent("securitySchemes", "session", { type: "apiKey", in: "cookie", name: "__Host-hgid_session" });

  app.openapi(meRoute, (c) => {
    const s = c.get("staff");
    return c.json({ member_id: s.memberId, roles: s.roles.map((r) => ({ role: r, label: ROLE_LABELS[r] })), permissions: permissionsOf(s.roles, s.grants), grants: s.grants }, 200);
  });

  app.openapi(overviewRoute, async (c) => c.json(await loadOverview(c.env.DB, deps.now()), 200));

  // Head-office secretaries and super admins see and decide every request; a reviewer only those of the own regional center.
  const reviewScope = async (c: C) => {
    const st = c.get("staff");
    if (hasGrant(grantsOf(st.roles, st.grants), "review", "all")) return { all: true as const };
    return { all: false as const, center: await centerNormOfMember(c.env.DB, st.memberId) };
  };
  const inScope = (sc: { all: true } | { all: false; center: string | null }, centerNorm: string | null) => sc.all || (sc.center !== null && centerNorm === sc.center);

  /** The center a request is about, as text: the requested center, or the member's own center for a rank. */
  const centerLabel = (brief: MemberBrief | undefined, fieldKey: string, requested: unknown) => {
    if (fieldKey === "education_center") return typeof requested === "string" ? requested : null;
    const row = brief?.amway.get("education_center");
    const v = row?.value ?? row?.pending_value ?? null;
    return typeof v === "string" ? v : null;
  };

  // Both lists load the people they mention with one memberBriefs call (one round trip), never one query per row.
  app.openapi(reviewsRoute, async (c) => {
    const d = deny(c, "review");
    if (d) return d as never;
    const db = c.env.DB;
    const [scope, r] = await Promise.all([
      reviewScope(c),
      db
        .prepare("SELECT id, member_id, field_key, requested_value, created_at, app_id, center_norm FROM amway_review_requests WHERE status = 'pending' ORDER BY created_at LIMIT 200")
        .all<{ id: string; member_id: string; field_key: string; requested_value: string; created_at: string; app_id: string | null; center_norm: string | null }>(),
    ]);
    const rows = (r.results ?? []).filter((x) => inScope(scope, x.center_norm));
    const briefs = await memberBriefs(db, rows.map((x) => x.member_id));
    const items = rows.map((x) => {
      const b = briefs.get(x.member_id);
      const requested = JSON.parse(x.requested_value) as unknown;
      return {
        id: x.id,
        member_id: x.member_id,
        display_name: b?.display_name ?? null,
        member_number: b?.numbers[0] ?? null,
        field_key: x.field_key,
        field_label: getAmwayField(x.field_key)?.label ?? x.field_key,
        center: centerLabel(b, x.field_key, requested),
        current_value: b?.amway.get(x.field_key)?.value ?? null,
        requested_value: requested,
        created_at: x.created_at,
        app_id: x.app_id,
      };
    });
    return c.json({ reviews: items }, 200);
  });

  app.openapi(historyRoute, async (c) => {
    const d = deny(c, "review");
    if (d) return d as never;
    const db = c.env.DB;
    const [scope, r] = await Promise.all([
      reviewScope(c),
      db
        .prepare("SELECT id, member_id, field_key, requested_value, status, decided_at, decided_by, center_norm FROM amway_review_requests WHERE status IN ('approved', 'rejected') ORDER BY decided_at DESC LIMIT 200")
        .all<{ id: string; member_id: string; field_key: string; requested_value: string; status: string; decided_at: string; decided_by: string | null; center_norm: string | null }>(),
    ]);
    const rows = (r.results ?? []).filter((x) => inScope(scope, x.center_norm)).slice(0, 50);
    const briefs = await memberBriefs(db, rows.flatMap((x) => (x.decided_by ? [x.member_id, x.decided_by] : [x.member_id])));
    const items = rows.map((x) => {
      const b = briefs.get(x.member_id);
      const requested = JSON.parse(x.requested_value) as unknown;
      return {
        id: x.id,
        display_name: b?.display_name ?? null,
        member_number: b?.numbers[0] ?? null,
        field_key: x.field_key,
        field_label: getAmwayField(x.field_key)?.label ?? x.field_key,
        center: centerLabel(b, x.field_key, requested),
        requested_value: requested,
        status: x.status,
        decided_at: x.decided_at,
        decided_by: x.decided_by ? (briefs.get(x.decided_by)?.display_name ?? null) : null,
      };
    });
    return c.json({ history: items }, 200);
  });

  app.openapi(decisionRoute, async (c) => {
    const d = deny(c, "review");
    if (d) return d as never;
    const { id } = c.req.valid("param");
    const [req, scope] = await Promise.all([
      c.env.DB.prepare("SELECT center_norm FROM amway_review_requests WHERE id = ? AND status = 'pending'").bind(id).first<{ center_norm: string | null }>(),
      reviewScope(c),
    ]);
    if (!req) return c.json(errorBody("not_found", "No pending request", c.get("requestId")), 404);
    if (!inScope(scope, req.center_norm)) return c.json(errorBody("forbidden", "這個申請不屬於您負責的中心", c.get("requestId"), { required_permission: "review" }), 403);
    const ok = await decideReview(c.env.DB, id, c.req.valid("json").decision, c.get("staff").memberId, ctxOf(c, deps));
    if (!ok) return c.json(errorBody("not_found", "No pending request", c.get("requestId")), 404);
    return c.json({ decided: c.req.valid("json").decision }, 200);
  });

  app.openapi(membersRoute, async (c) => {
    const d = deny(c, "members.read");
    if (d) return d as never;
    const db = c.env.DB;
    const st = c.get("staff");
    const scope = await memberScopeOf(db, st.memberId, st.roles, st.grants);
    const f = c.req.valid("query");
    const { ids, total } = await searchMemberIds(db, scope, f);
    const [ladder, briefs] = await Promise.all([
      db.prepare("SELECT value, label FROM amway_options WHERE field_key = 'rank'").all<{ value: string; label: string }>(),
      memberBriefs(db, ids),
    ]);
    const rankLabel = new Map((ladder.results ?? []).map((r) => [r.value, r.label]));
    const text = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" && "option" in v ? String((v as { option: string }).option) : null);
    const out = ids.map((id) => {
      const b = briefs.get(id);
      const m = b?.member;
      const rank = text(b?.amway.get("rank")?.value ?? null);
      return {
        member_id: id,
        display_name: b?.display_name ?? null,
        member_number: b?.numbers[0] ?? null,
        status: m?.status,
        amway_enabled: m?.amway_enabled === 1,
        system: text(b?.amway.get("education_system")?.value ?? null),
        center: text(b?.amway.get("education_center")?.value ?? null),
        rank: rank ? (rankLabel.get(rank) ?? rank) : null,
        created_at: m?.created_at ?? null,
      };
    });
    return c.json({ members: out, total, scope: scope.labels, can_manage: can(st.roles, "members.manage", st.grants) }, 200);
  });

  app.openapi(filtersRoute, async (c) => {
    const d = deny(c, "members.read");
    if (d) return d as never;
    const db = c.env.DB;
    const opts = await listOptions(db);
    const countries = await db.prepare("SELECT DISTINCT registration_country AS c FROM members WHERE registration_country IS NOT NULL AND status != 'deleted' ORDER BY c").all<{ c: string }>();
    return c.json(
      {
        systems: (await listTerms(db, "education_system")).map((t) => t.term),
        centers: (await listTerms(db, "education_center")).map((t) => t.term),
        ranks: opts.get("rank") ?? [],
        countries: (countries.results ?? []).map((r) => r.c),
      },
      200,
    );
  });

  app.openapi(permissionsRoute, async (c) => {
    const columns = ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] }));
    return c.json(
      {
        roles: columns,
        features: FEATURES.map((f) => ({ label: f.label, roles: f.roles, diamond: f.diamond === true })),
        mine: c.get("staff").roles,
      },
      200,
    );
  });

  app.openapi(catalogRoute, async (c) => {
    const d = deny(c, "staff.manage");
    if (d) return d as never;
    return c.json(
      {
        scopes: SCOPE_LABELS,
        permissions: PERMISSIONS.map((p) => ({ permission: p, label: PERMISSION_INFO[p].label, scopes: PERMISSION_INFO[p].scopes })),
        roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r], grants: ROLE_GRANTS[r] })),
      },
      200,
    );
  });

  app.openapi(memberStatusRoute, async (c) => {
    const d = deny(c, "members.manage");
    if (d) return d as never;
    const db = c.env.DB;
    const { member_id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const staff = c.get("staff");
    const m = await getMember(db, member_id);
    if (!m || m.status === "deleted") return c.json(errorBody("not_found", "Member not found", c.get("requestId")), 404);
    if (status === "disabled" && member_id === staff.memberId) return c.json(errorBody("conflict", "不能停權自己", c.get("requestId")), 409);
    if (status === "disabled" && (await rolesOf(db, member_id)).includes("super_admin")) {
      const others = await db.prepare("SELECT COUNT(*) AS n FROM staff_roles WHERE role = 'super_admin' AND member_id != ?").bind(member_id).first<{ n: number }>();
      if (!others?.n) return c.json(errorBody("conflict", "至少要保留一位超級管理員", c.get("requestId")), 409);
    }
    const now = deps.now();
    const t = epochSeconds(now);
    await db.batch([
      db.prepare("UPDATE members SET status = ?, updated_at = ? WHERE id = ?").bind(status, taipeiIso(now), member_id),
      ...(status === "disabled"
        ? [
            db.prepare("UPDATE login_sessions SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, member_id),
            db.prepare("UPDATE oauth_refresh_tokens SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, member_id),
            db.prepare("UPDATE app_sessions SET revoked_epoch = ?, revoke_reason = 'suspended' WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, member_id),
            db.prepare("UPDATE device_sso SET revoked_epoch = ? WHERE member_id = ? AND revoked_epoch IS NULL").bind(t, member_id),
          ]
        : []),
      auditStatement(db, { actorType: "staff", actorId: staff.memberId, action: status === "disabled" ? "member.suspend" : "member.reinstate", targetType: "member", targetId: member_id, appId: null, result: "success", requestId: c.get("requestId") }, now),
    ]);
    return c.json({ member_id, status }, 200);
  });

  app.openapi(memberDeleteRoute, async (c) => {
    const d = deny(c, "members.manage");
    if (d) return d as never;
    const staff = c.get("staff");
    const { member_id } = c.req.valid("param");
    // Deleting a member does not ask for a fresh sign-in either (owner decision 2026-11-12).
    if (member_id === staff.memberId) return c.json(errorBody("conflict", "不能刪除自己（請用「刪除帳號」）", c.get("requestId")), 409);
    const r = await deleteAccount(c.env.DB, member_id, deps.now(), c.get("requestId"));
    if (r === "not_found") return c.json(errorBody("not_found", "Member not found", c.get("requestId")), 404);
    if (r === "last_super_admin") return c.json(errorBody("conflict", "至少要保留一位超級管理員", c.get("requestId")), 409);
    await auditStatement(c.env.DB, { actorType: "staff", actorId: staff.memberId, action: "member.delete", targetType: "member", targetId: member_id, appId: null, result: "success", requestId: c.get("requestId") }, deps.now()).run();
    await dropFiles(c.env.FILES, [avatarKey(member_id)]);
    kickDelivery(c, deps);
    return c.json({ member_id, deleted: true }, 200);
  });

  app.openapi(memberRoute, async (c) => {
    const d = deny(c, "members.read");
    if (d) return d as never;
    const db = c.env.DB;
    const id = c.req.valid("param").member_id;
    const st = c.get("staff");
    const m = await getMember(db, id);
    if (!m) return c.json(errorBody("not_found", "Member not found", c.get("requestId")), 404);
    if (!(await memberInScope(db, await memberScopeOf(db, st.memberId, st.roles, st.grants), id))) return c.json(errorBody("forbidden", "這位會員不在您可以查詢的範圍", c.get("requestId"), { required_permission: "members.read" }), 403);
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
        staff_grants: await grantsOfMember(db, id),
        diamond_rank: await hasDiamondRank(db, id),
        can_manage: can(st.roles, "members.manage", st.grants),
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
    // With the "center" scope (a permission given for the own center only) the member must belong to that center.
    const st = c.get("staff");
    if (!hasGrant(grantsOf(st.roles, st.grants), "adjust", "all")) {
      const own = await memberScopeOf(c.env.DB, st.memberId, st.roles, st.grants);
      if (!own.center || !(await memberInScope(c.env.DB, { all: false, hglobal: false, center: own.center, labels: [] }, member_id))) {
        return c.json(errorBody("forbidden", "這位會員不屬於您負責的中心", c.get("requestId"), { required_permission: "adjust" }), 403);
      }
    }
    const options = (await listOptions(c.env.DB)).get(field_key) ?? [];
    const v = validateAmwayValue(def, c.req.valid("json").value, options);
    if (!v.ok) return c.json(errorBody("invalid_field", v.message, c.get("requestId"), { field_key, reason: v.reason }), 422);
    await staffAdjust(c.env.DB, member_id, field_key, v.value, c.get("staff").memberId, ctxOf(c, deps));
    return c.json({ member_id, field_key, value: v.value, status: "approved" }, 200);
  });

  const actor = (c: C) => ({ memberId: c.get("staff").memberId, requestId: c.get("requestId"), now: deps.now() });
  const poolOr404 = (c: C, pool: string) => (isPool(pool) ? pool : null);
  const noPool = (c: C) => c.json(errorBody("not_found", "沒有這個詞庫", c.get("requestId")), 404);

  const layoutView = async (c: C) => {
    const saved = await loadLayout(c.env.DB);
    return {
      groups: LAYOUT_GROUPS.map((g) => ({ group: g, label: LAYOUT_GROUP_LABELS[g], fields: defaultLayout(g).sort((a, b) => (saved.get((g === "blocks" ? BLOCK_PREFIX : "") + a.key) ?? 1e6) - (saved.get((g === "blocks" ? BLOCK_PREFIX : "") + b.key) ?? 1e6) || 0) })),
      customized: saved.size > 0,
    };
  };

  app.openapi(layoutGetRoute, async (c) => {
    const d = deny(c, "layout.manage");
    if (d) return d as never;
    const v = await layoutView(c);
    return c.json(v, 200);
  });

  app.openapi(layoutPutRoute, async (c) => {
    const d = deny(c, "layout.manage");
    if (d) return d as never;
    const { order } = c.req.valid("json");
    if (order === null) {
      await saveLayout(c.env.DB, null, actor(c));
      return c.json(await layoutView(c), 200);
    }
    const check = validateLayout(order);
    if (!check.ok) return c.json(errorBody("invalid_field", check.message, c.get("requestId"), { field_key: "order", reason: "incomplete" }), 422);
    await saveLayout(c.env.DB, check.value, actor(c));
    return c.json(await layoutView(c), 200);
  });

  app.openapi(vocabPoolsRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const counts = await c.env.DB.prepare("SELECT pool, COUNT(*) AS n FROM vocab_terms GROUP BY pool").all<{ pool: string; n: number }>();
    const n = new Map((counts.results ?? []).map((r) => [r.pool, r.n]));
    return c.json({ pools: POOL_KEYS.map((k) => ({ pool: k, label: POOLS[k].label, terms: n.get(k) ?? 0, fields: [...POOLS[k].profileFields, ...POOLS[k].amwayFields] })) }, 200);
  });

  app.openapi(vocabTermsRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const pool = poolOr404(c, c.req.valid("param").pool);
    if (!pool) return noPool(c) as never;
    return c.json({ pool, label: POOLS[pool].label, ordered: ORDERED_POOLS.includes(pool), closed: CLOSED_POOLS.includes(pool), terms: await listTerms(c.env.DB, pool) }, 200);
  });

  const invalidTerm = (c: C) => c.json(errorBody("invalid_field", "詞不可空白，最多 100 字", c.get("requestId"), { field_key: "term", reason: "format" }), 422);

  app.openapi(vocabAddRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const pool = poolOr404(c, c.req.valid("param").pool);
    if (!pool) return noPool(c) as never;
    if (!(await addTerm(c.env.DB, pool, c.req.valid("json").term, actor(c)))) return invalidTerm(c) as never;
    return c.json({ added: true }, 200);
  });

  app.openapi(vocabRenameRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const pool = poolOr404(c, c.req.valid("param").pool);
    if (!pool) return noPool(c) as never;
    const { from, to } = c.req.valid("json");
    const r = await renameTerm(c.env.DB, pool, from, to, actor(c));
    if (!r.ok) return (r.reason === "invalid" ? invalidTerm(c) : c.json(errorBody("not_found", "找不到這個詞", c.get("requestId")), 404)) as never;
    return c.json({ members_updated: r.members }, 200);
  });

  app.openapi(vocabMoveRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const pool = poolOr404(c, c.req.valid("param").pool);
    if (!pool) return noPool(c) as never;
    const { term, direction } = c.req.valid("json");
    const r = await moveTerm(c.env.DB, pool, term, direction, actor(c));
    if (r === "not_found") return c.json(errorBody("not_found", "找不到這個詞", c.get("requestId")), 404) as never;
    if (r === "not_ordered") return c.json(errorBody("invalid_field", "這組關聯詞不能調整順序", c.get("requestId"), { field_key: "pool", reason: "not_ordered" }), 422) as never;
    return c.json({ moved: r === "ok" }, 200);
  });

  app.openapi(vocabMergeRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const pool = poolOr404(c, c.req.valid("param").pool);
    if (!pool) return noPool(c) as never;
    const { froms, into } = c.req.valid("json");
    const r = await mergeTerms(c.env.DB, pool, froms, into, actor(c));
    if (!r.ok) return (r.reason === "invalid" ? invalidTerm(c) : c.json(errorBody("not_found", "找不到要合併的詞", c.get("requestId")), 404)) as never;
    return c.json({ members_updated: r.members }, 200);
  });

  app.openapi(vocabDeleteRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const pool = poolOr404(c, c.req.valid("param").pool);
    if (!pool) return noPool(c) as never;
    if (!(await deleteTerm(c.env.DB, pool, c.req.valid("json").term, actor(c)))) return c.json(errorBody("not_found", "找不到這個詞", c.get("requestId")), 404) as never;
    return c.json({ deleted: true }, 200);
  });

  app.openapi(vocabHglobalRoute, async (c) => {
    const d = deny(c, "vocab.manage");
    if (d) return d as never;
    const { term, hglobal } = c.req.valid("json");
    if (!(await setHglobalTerm(c.env.DB, term, hglobal, actor(c)))) return c.json(errorBody("not_found", "找不到這個詞", c.get("requestId")), 404) as never;
    return c.json({ term, hglobal }, 200);
  });

  app.openapi(staffRoute, async (c) => {
    const d = deny(c, "staff.manage");
    if (d) return d as never;
    const list = await listStaff(c.env.DB);
    return c.json({ staff: await Promise.all(list.map(async (s) => ({ ...s, display_name: await displayName(c.env.DB, s.member_id), center: await centerTextOf(c.env.DB, s.member_id) }))), roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] })) }, 200);
  });

  app.openapi(putStaffRoute, async (c) => {
    const d = deny(c, "staff.manage");
    if (d) return d as never;
    // Giving or changing positions does not ask for a fresh sign-in (owner decision 2026-11-12).
    const staff = c.get("staff");
    const { member_id } = c.req.valid("param");
    if (!(await getMember(c.env.DB, member_id))) return c.json(errorBody("not_found", "Member not found", c.get("requestId")), 404);
    const body = c.req.valid("json");
    const roles = [...new Set(body.roles)] as Role[];
    const v = validateGrants(body.grants ?? []);
    if (!v.ok) return c.json(errorBody("invalid_field", v.message, c.get("requestId"), { field_key: "grants", reason: "invalid" }), 422);
    // Nobody can hand out more than they hold themselves.
    const mine = grantsOf(staff.roles, staff.grants);
    for (const x of v.grants) if (!hasGrant(mine, x.permission, x.scope)) return c.json(errorBody("forbidden", "不能給出自己沒有的權限", c.get("requestId"), { required_permission: x.permission }), 403);
    // Extra permissions that the positions already give add nothing: keep only the ones that do.
    const base = grantsOf(roles);
    const extra = v.grants.filter((x) => !hasGrant(base, x.permission, x.scope));
    const ok = await setRoles(c.env.DB, member_id, roles, extra, staff.memberId, c.get("requestId"), deps.now());
    if (!ok) return c.json(errorBody("invalid_field", "至少要保留一位超級管理員", c.get("requestId"), { field_key: "roles", reason: "last_super_admin" }), 422);
    return c.json({ member_id, roles, grants: extra }, 200);
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
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY occurred_at DESC, rowid DESC LIMIT ?`;
    const r = await c.env.DB.prepare(sql).bind(...args, q.limit ?? 50).all();
    return c.json({ entries: r.results ?? [] }, 200);
  });
}
