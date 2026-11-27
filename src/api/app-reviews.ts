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
import { REVIEWER_ADJUSTABLE, getAmwayField, validateAmwayValue } from "../amway/fields";
import { decideReview, listOptions } from "../db/amway";
import { normTerm } from "../vocab/terms";
import { getApp } from "../db/apps";
import { auditStatement, auditedRecently } from "../db/audit";

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
  summary: "Approve or reject one pending request (the member is notified). Same permission and center rule as the list. With decision=approve an optional `value` approves a corrected value instead of the requested one.",
  description:
    "`value` (optional, approve only) has the same format as the field definition (a string, or {option, custom_text}); it is validated on the server. Giving `value` with `reject` is 422. " +
    "A corrected value is kept on the request next to the original request, the member is told it was approved after a change, and the audit entry records that it was modified (never the values). " +
    "A reviewer limited to the own center cannot correct a center to a different center (403).",
  security: [{ bearer: [] }],
  request: {
    params: z.object({ id: z.string().max(64) }),
    body: { required: true, content: json(z.object({ decision: z.enum(["approve", "reject"]), value: z.union([z.string().max(200), z.object({ option: z.string().max(100), custom_text: z.string().max(200).nullable() })]).optional() })) },
  },
  responses: { 200: { description: "Decided", content: json(Any) }, 401: err("unauthenticated"), 403: err("forbidden"), 404: err("not_found (not pending)"), 422: err("invalid_field") },
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
        member_id: x.member_id,
        display_name: b?.display_name ?? null,
        field_key: x.field_key,
        field_label: getAmwayField(x.field_key)?.label ?? x.field_key,
        center: centerLabel(b, x.field_key, requested),
        current_value: b?.amway.get(x.field_key)?.value ?? null,
        requested_value: requested,
        created_at: x.created_at,
      };
    });
    if (!(await auditedRecently(st.db, st.auth.memberId, "app_reviews.list", st.auth.appId ?? null, deps.now())))
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
    const { decision, value } = c.req.valid("json");
    const req = await st.db.prepare("SELECT member_id, field_key, center_norm FROM amway_review_requests WHERE id = ? AND status = 'pending'").bind(id).first<{ member_id: string; field_key: string; center_norm: string | null }>();
    if (!req) return c.json(errorBody("not_found", "No pending request", st.rid), 404) as never;
    if (!inScope(st, req.center_norm)) return c.json(errorBody("forbidden", "這個申請不屬於您負責的中心", st.rid, { required_permission: "review" }), 403) as never;
    // A corrected value: approve only, only the three reviewed fields, validated like any other write.
    let corrected: Parameters<typeof decideReview>[5];
    if (value !== undefined) {
      const def = getAmwayField(req.field_key);
      if (decision !== "approve") return c.json(errorBody("invalid_field", "只有「通過」可以帶修改後的值", st.rid, { field_key: req.field_key, reason: "value_needs_approve" }), 422) as never;
      if (!def || !REVIEWER_ADJUSTABLE.includes(req.field_key)) return c.json(errorBody("invalid_field", "這個欄位不能修改", st.rid, { field_key: req.field_key, reason: "not_adjustable" }), 422) as never;
      const v = validateAmwayValue(def, value, (await listOptions(st.db)).get(req.field_key) ?? []);
      if (!v.ok || v.value === null) return c.json(errorBody("invalid_field", v.ok ? "修改後的值不能是空的" : v.message, st.rid, { field_key: req.field_key, reason: v.ok ? "empty" : v.reason }), 422) as never;
      // A reviewer of one center must not move the member to another center (that would take the request out of their reach).
      if (req.field_key === "education_center" && !st.all && (typeof v.value !== "string" || normTerm(v.value) !== st.center)) {
        return c.json(errorBody("forbidden", "您只能把中心改成自己負責的中心", st.rid, { required_permission: "review" }), 403) as never;
      }
      corrected = v.value;
    }
    const ok = await decideReview(st.db, id, decision, st.auth.memberId, { appId: st.auth.appId!, requestId: st.rid, now: deps.now() }, corrected);
    if (!ok) return c.json(errorBody("not_found", "No pending request", st.rid), 404) as never;
    return c.json({ id, member_id: req.member_id, field_key: req.field_key, decided: decision, modified: ok.modified }, 200);
  });
}
