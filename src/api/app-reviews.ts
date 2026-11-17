// GET /v1/eligibility/reviews and POST /v1/eligibility/reviews/{id}/decision (ADR 0030).
// An App shows the central review queue (new 獎銜 / 中心 requests) to the member's own staff position, and lets that person decide.
// The rule is exactly the back office's (src/api/admin.ts): super admins and secretaries see and decide every request; a reviewer
// (審核員) only those of the own approved regional center. Everything is checked here, on the server; the App only displays.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { missingScope } from "./auth";
import { centerNormOfMember, grantsOfMember, rolesOf } from "../db/staff";
import { can, grantsOf, hasGrant } from "../admin/roles";
import { memberBriefs, type MemberBrief } from "../db/member-bulk";
import { getAmwayField } from "../amway/fields";
import { decideReview } from "../db/amway";
import { getApp } from "../db/apps";
import { auditStatement } from "../db/audit";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const Any = z.record(z.unknown());

const listRoute = createRoute({
  method: "get",
  path: "/v1/eligibility/reviews",
  tags: ["eligibility"],
  summary: "The pending 獎銜 / 中心 review requests the signed-in member may decide (their own staff position and center). The caller's own member token; never a service token.",
  description:
    "Same rule as the back office: super_admin and secretary see every request; reviewer (審核員) only the requests of the own approved regional center; anyone else gets 403. " +
    "The member's display name is returned, so the calling App must have `display_name` ticked for member data. No email, phone or member number is returned. Treat any non-200 as no access.",
  security: [{ bearer: [] }],
  responses: {
    200: { description: "Queue (oldest first, at most 200)", content: json(Any) },
    401: err("unauthenticated"),
    403: err("forbidden / field_not_allowed"),
  },
});

const decisionRoute = createRoute({
  method: "post",
  path: "/v1/eligibility/reviews/{id}/decision",
  tags: ["eligibility"],
  summary: "Approve or reject one pending request (the member is notified). Same permission and center rule as the list.",
  security: [{ bearer: [] }],
  request: { params: z.object({ id: z.string().max(64) }), body: { required: true, content: json(z.object({ decision: z.enum(["approve", "reject"]) })) } },
  responses: { 200: { description: "Decided", content: json(Any) }, 401: err("unauthenticated"), 403: err("forbidden"), 404: err("not_found (not pending)") },
});

/** The center a request is about, as text: the requested center, or the member's own center for a rank. */
function centerLabel(brief: MemberBrief | undefined, fieldKey: string, requested: unknown): string | null {
  if (fieldKey === "education_center") return typeof requested === "string" ? requested : null;
  const row = brief?.amway.get("education_center");
  const v = row?.value ?? row?.pending_value ?? null;
  return typeof v === "string" ? v : null;
}

export function registerAppReviewRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  /** Who is calling and what they may review. null + a response when refused. */
  async function staffOf(c: Parameters<Parameters<typeof app.openapi>[1]>[0], action: string) {
    const db = c.env.DB;
    const auth = c.get("auth");
    const rid = c.get("requestId");
    const refuse = async (code: string, message: string, status: 403) => {
      await auditStatement(db, { actorType: "member", actorId: auth.memberId, action, result: "denied", appId: auth.appId ?? null, requestId: rid, detail: { reason: code } }, deps.now()).run();
      return c.json(errorBody("forbidden", message, rid), status);
    };
    if (!auth.appId) return { res: await refuse("not_an_app", "只有 App 內登入的會員可以使用", 403) };
    const [roles, grants] = await Promise.all([rolesOf(db, auth.memberId), grantsOfMember(db, auth.memberId)]);
    if (!can(roles, "review", grants)) return { res: await refuse("no_role", "需要審核員、秘書或超級管理員職務", 403) };
    const all = hasGrant(grantsOf(roles, grants), "review", "all");
    const center = all ? null : await centerNormOfMember(db, auth.memberId);
    return { auth, rid, all, center, db };
  }
  const inScope = (s: { all: boolean; center: string | null }, centerNorm: string | null) => s.all || (s.center !== null && centerNorm === s.center);

  app.openapi(listRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    c.header("cache-control", "no-store");
    const st = await staffOf(c, "app_reviews.list");
    if ("res" in st) return st.res as never;
    const entry = await getApp(st.db, st.auth.appId!, deps.now());
    // Member data is only used within what the owner ticked for this App (ADR 0022).
    if (!entry || !entry.member_data_fields.includes("display_name")) {
      return c.json(errorBody("field_not_allowed", "這款 App 沒有獲得使用會員顯示名稱的授權", st.rid, { fields: ["display_name"] }), 403) as never;
    }
    const r = await st.db
      .prepare("SELECT id, member_id, field_key, requested_value, created_at, center_norm FROM amway_review_requests WHERE status = 'pending' ORDER BY created_at LIMIT 200")
      .all<{ id: string; member_id: string; field_key: string; requested_value: string; created_at: string; center_norm: string | null }>();
    const rows = (r.results ?? []).filter((x) => inScope(st, x.center_norm));
    const briefs = await memberBriefs(st.db, rows.map((x) => x.member_id));
    const reviews = rows.map((x) => {
      const b = briefs.get(x.member_id);
      const requested = JSON.parse(x.requested_value) as unknown;
      return {
        id: x.id,
        display_name: b?.display_name ?? null,
        field_key: x.field_key,
        field_label: getAmwayField(x.field_key)?.label ?? x.field_key,
        center: centerLabel(b, x.field_key, requested),
        current_value: b?.amway.get(x.field_key)?.value ?? null,
        requested_value: requested,
        created_at: x.created_at,
      };
    });
    await auditStatement(st.db, { actorType: "member", actorId: st.auth.memberId, action: "app_reviews.list", result: "success", appId: st.auth.appId, requestId: st.rid, detail: { count: reviews.length, scope: st.all ? "all" : "center" } }, deps.now()).run();
    return c.json({ scope: st.all ? "all" : "center", reviews }, 200);
  });

  app.openapi(decisionRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    c.header("cache-control", "no-store");
    const st = await staffOf(c, "app_reviews.decide");
    if ("res" in st) return st.res as never;
    const { id } = c.req.valid("param");
    const { decision } = c.req.valid("json");
    const req = await st.db.prepare("SELECT center_norm FROM amway_review_requests WHERE id = ? AND status = 'pending'").bind(id).first<{ center_norm: string | null }>();
    if (!req) return c.json(errorBody("not_found", "No pending request", st.rid), 404) as never;
    if (!inScope(st, req.center_norm)) return c.json(errorBody("forbidden", "這個申請不屬於您負責的中心", st.rid, { required_permission: "review" }), 403) as never;
    const ok = await decideReview(st.db, id, decision, st.auth.memberId, { appId: st.auth.appId!, requestId: st.rid, now: deps.now() });
    if (!ok) return c.json(errorBody("not_found", "No pending request", st.rid), 404) as never;
    return c.json({ decided: decision }, 200);
  });
}
