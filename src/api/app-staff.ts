// GET /v1/eligibility/staff and PUT /v1/eligibility/staff/{member_id} (ADR 0033).
// An App lets the person who may manage positions (the same permission as the back office: `staff.manage`) look up members and give or
// remove the general positions (審核員、會長、課務、音控、票務、活動). 超級管理員 and 總部秘書 can only be set in the back office, extra
// permissions are not touched here. Everything is checked on the server; the App only displays.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { missingScope } from "./auth";
import { grantsOfMember, listStaff, rolesOf, setRoles } from "../db/staff";
import { ROLE_LABELS, can, grantsOf, type Role } from "../admin/roles";
import { APP_ASSIGNABLE_ROLES, isAppAssignable, planAssignment } from "../admin/assign";
import { memberBriefs } from "../db/member-bulk";
import { getMember } from "../db/identity";
import { getApp } from "../db/apps";
import { auditStatement, auditedRecently } from "../db/audit";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const Any = z.record(z.unknown());
const SEARCH_LIMIT = 20;
const STAFF_LIMIT = 200;

const listRoute = createRoute({
  method: "get",
  path: "/v1/eligibility/staff",
  tags: ["eligibility"],
  summary: "Members with positions, or (with q) a name search among active members, for the person who may manage positions. The caller's own member token; never a service token.",
  description:
    "Who may call: a member signed in to an App who holds the permission `staff.manage` (today the 超級管理員; the same rule as the back office). Anyone else gets 403. " +
    "Without `q`: every member who has a position (at most 200). With `q` (2–30 characters): active members whose display name contains it (at most 20), whether or not they have a position. " +
    "Returns the member_id, the display name and the positions; no email, phone, member number or Amway field. The calling App must have `display_name` ticked for it in the back office (ADR 0022). Every call is audited (caller, App, count; never the search text or names).",
  security: [{ bearer: [] }],
  request: { query: z.object({ q: z.string().max(60).optional() }) },
  responses: { 200: { description: "Members", content: json(Any) }, 401: err("unauthenticated"), 403: err("forbidden / field_not_allowed"), 422: err("invalid_field") },
});

const putRoute = createRoute({
  method: "put",
  path: "/v1/eligibility/staff/{member_id}",
  tags: ["eligibility"],
  summary: "Set which general positions a member has (審核員、會長、課務、音控、票務、活動). Same permission as the list.",
  description:
    "`roles` is the complete list of assignable positions the member should have afterwards (an empty list removes them all). Positions an App may not touch (超級管理員、總部秘書) and the member's extra permissions stay exactly as they are; a role outside the assignable list is 422. " +
    "A caller can only hand out positions whose permissions the caller holds (403). Only active members can be changed (404 otherwise). Every change is audited with the App; the 200 shows the member's positions afterwards and `changed`.",
  security: [{ bearer: [] }],
  request: {
    params: z.object({ member_id: z.string().max(64) }),
    body: { required: true, content: json(z.object({ roles: z.array(z.string().max(20)).max(20) })) },
  },
  responses: { 200: { description: "Saved", content: json(Any) }, 401: err("unauthenticated"), 403: err("forbidden / field_not_allowed"), 404: err("not_found"), 422: err("invalid_field") },
});

const labelled = (roles: readonly Role[]) => roles.map((r) => ({ role: r, label: ROLE_LABELS[r], assignable: isAppAssignable(r) }));
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

export function registerAppStaffRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  /** Who is calling; null + a response when refused. */
  async function managerOf(c: Parameters<Parameters<typeof app.openapi>[1]>[0], action: string) {
    const db = c.env.DB;
    const auth = c.get("auth");
    const rid = c.get("requestId");
    const refuse = async (code: string, message: string) => {
      await auditStatement(db, { actorType: "member", actorId: auth.memberId, action, result: "denied", appId: auth.appId ?? null, requestId: rid, detail: { reason: code } }, deps.now()).run();
      return c.json(errorBody("forbidden", message, rid), 403);
    };
    if (!auth.appId) return { res: await refuse("not_an_app", "只有 App 內登入的會員可以使用") };
    const [roles, grants, entry] = await Promise.all([rolesOf(db, auth.memberId), grantsOfMember(db, auth.memberId), getApp(db, auth.appId, deps.now())]);
    if (!can(roles, "staff.manage", grants)) return { res: await refuse("no_permission", "需要「指派職務與權限」的權限") };
    // Member data is only used within what the owner ticked for this App (ADR 0022).
    if (!entry || !entry.member_data_fields.includes("display_name")) {
      return { res: c.json(errorBody("field_not_allowed", "這款 App 沒有獲得使用會員顯示名稱的授權", rid, { fields: ["display_name"] }), 403) };
    }
    return { auth, rid, db, mine: grantsOf(roles, grants) };
  }

  app.openapi(listRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    c.header("cache-control", "no-store");
    const m = await managerOf(c, "app_staff.list");
    if ("res" in m) return m.res as never;
    const q = c.req.valid("query").q?.normalize("NFC").trim();
    let ids: string[];
    const staff = await listStaff(m.db);
    const rolesById = new Map(staff.map((s) => [s.member_id, s.roles]));
    if (q === undefined || q === "") {
      ids = staff.filter((s) => s.roles.length > 0).map((s) => s.member_id).slice(0, STAFF_LIMIT);
    } else {
      if ([...q].length < 2 || [...q].length > 30) return c.json(errorBody("invalid_field", "請輸入 2 到 30 個字搜尋", m.rid, { field_key: "q", reason: "length" }), 422) as never;
      const like = `%${likeEscape(q)}%`;
      const r = await m.db
        .prepare(
          `SELECT m.id AS id FROM members m WHERE m.status = 'active' AND (m.display_name LIKE ? ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM profile_field_values p WHERE p.member_id = m.id AND p.field_key = 'display_name' AND p.value LIKE ? ESCAPE '\\'))
           ORDER BY m.id LIMIT ${SEARCH_LIMIT}`,
        )
        .bind(like, like)
        .all<{ id: string }>();
      ids = (r.results ?? []).map((x) => x.id);
    }
    const briefs = await memberBriefs(m.db, ids);
    const members = ids
      .filter((id) => briefs.get(id)?.member?.status === "active")
      .map((id) => ({ member_id: id, display_name: briefs.get(id)?.display_name ?? null, roles: labelled(rolesById.get(id) ?? []) }))
      .sort((a, b) => ((a.display_name ?? "") < (b.display_name ?? "") ? -1 : (a.display_name ?? "") > (b.display_name ?? "") ? 1 : a.member_id < b.member_id ? -1 : 1));
    if (!(await auditedRecently(m.db, m.auth.memberId, "app_staff.list", m.auth.appId ?? null, deps.now())))
      await auditStatement(m.db, { actorType: "member", actorId: m.auth.memberId, action: "app_staff.list", result: "success", appId: m.auth.appId, requestId: m.rid, detail: { count: members.length, mode: q ? "search" : "staff" } }, deps.now()).run();
    return c.json({ assignable_roles: APP_ASSIGNABLE_ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] })), members }, 200);
  });

  app.openapi(putRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    c.header("cache-control", "no-store");
    const m = await managerOf(c, "app_staff.set");
    if ("res" in m) return m.res as never;
    const { member_id } = c.req.valid("param");
    const { roles: wanted } = c.req.valid("json") as { roles: string[] };
    const bad = wanted.filter((r) => !isAppAssignable(r));
    if (bad.length) return c.json(errorBody("invalid_field", "這些職務不能在 App 內指派", m.rid, { field_key: "roles", reason: "not_assignable", roles: bad }), 422) as never;
    const target = await getMember(m.db, member_id);
    if (!target || target.status !== "active") return c.json(errorBody("not_found", "找不到這位會員", m.rid), 404) as never;
    const [current, grants] = await Promise.all([rolesOf(m.db, member_id), grantsOfMember(m.db, member_id)]);
    const plan = planAssignment(current, wanted.filter(isAppAssignable), m.mine);
    if (!plan.ok) return c.json(errorBody("forbidden", "不能給出自己沒有的權限", m.rid, { role: plan.role }), 403) as never;
    if (plan.changed) {
      const ok = await setRoles(m.db, member_id, plan.roles, grants, m.auth.memberId, m.rid, deps.now(), m.auth.appId!);
      if (!ok) return c.json(errorBody("invalid_field", "至少要保留一位超級管理員", m.rid, { field_key: "roles", reason: "last_super_admin" }), 422) as never;
    }
    return c.json({ member_id, roles: labelled(plan.roles), changed: plan.changed }, 200);
  });
}
