// POST /v1/eligibility/check and /v1/eligibility/check-batch (integration instruction pack, section 5).
// `reason` is for the app's internal logs only and must never be shown to members.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { bearerAuth, missingScope } from "./auth";
import { evaluate, type Rule } from "../eligibility/rules";
import { loadLadder, loadMemberEligibility } from "../db/eligibility";
import { readAmwayFields } from "../db/amway";
import { rolesOf } from "../db/staff";
import { ROLE_LABELS } from "../admin/roles";
import { normTerm } from "../vocab/terms";
import { getApp } from "../db/apps";
import { listTerms } from "../db/vocab";
import { auditStatement } from "../db/audit";
import { approvedCenterOf, decodeCursor, encodeCursor, listCenterMembers } from "../db/center-members";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const security = [{ bearer: [] }];
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });

const RuleSchema = z
  .object({
    audience: z.enum(["hglobal_verified", "everyone"]),
    min_rank: z.string().max(64).nullable().optional().openapi({ description: "Rank code from GET /v1/amway/field-definitions; only with hglobal_verified" }),
  })
  .strict()
  .refine((r) => r.audience === "hglobal_verified" || !r.min_rank, { message: "min_rank requires audience hglobal_verified", path: ["min_rank"] })
  .openapi("EligibilityRule");

const ResultSchema = z
  .object({
    allowed: z.boolean(),
    reason: z.enum(["ok", "not_verified", "rank_too_low", "amway_disabled"]).openapi({ description: "Internal logging only; never show to members" }),
  })
  .openapi("EligibilityResult");

const checkRoute = createRoute({
  method: "post",
  path: "/v1/eligibility/check",
  tags: ["eligibility"],
  summary: "Does the signed-in member meet this rule? Treat any non-200 or timeout as not allowed. Cache ≤ 1 day.",
  security,
  request: { body: { required: true, content: json(z.object({ rule: RuleSchema })) } },
  responses: { 200: { description: "Result", content: json(ResultSchema) }, 401: err("unauthenticated"), 403: err("forbidden"), 422: err("invalid_field") },
});

const batchRoute = createRoute({
  method: "post",
  path: "/v1/eligibility/check-batch",
  tags: ["eligibility"],
  summary: "Check up to 50 rules at once (list pages). Results are in the same order as the rules.",
  security,
  request: { body: { required: true, content: json(z.object({ rules: z.array(RuleSchema).min(1).max(50) })) } },
  responses: {
    200: { description: "Results", content: json(z.object({ results: z.array(ResultSchema) })) },
    401: err("unauthenticated"),
    403: err("forbidden"),
    422: err("invalid_field"),
  },
});

const contextRoute = createRoute({
  method: "get",
  path: "/v1/eligibility/context",
  tags: ["eligibility"],
  summary: "The signed-in member's own standing for an App: staff roles, whether 寰宇 is verified, and the approved regional center. Treat any non-200 as no roles / not verified.",
  description:
    "For Apps that route work by regional center or by position (for example course registrations reviewed by the member's own center). Only ever describes the caller. `center.key` is the normalized form to compare centers with; `center.label` is what the member typed. An App may keep the center label on a record it creates for the member (owner decision 2026-11-12); everything else stays uncached beyond a short in-memory cache.",
  security,
  responses: {
    200: {
      description: "Context",
      content: json(
        z
          .object({
            member_id: z.string(),
            roles: z.array(z.object({ role: z.string(), label: z.string() })),
            hglobal_verified: z.boolean(),
            center: z.object({ key: z.string(), label: z.string() }).nullable(),
          })
          .openapi("EligibilityContext"),
      ),
    },
    401: err("unauthenticated"),
    403: err("forbidden"),
  },
});

const centerMembersRoute = createRoute({
  method: "get",
  path: "/v1/eligibility/center-members",
  tags: ["eligibility"],
  summary: "The members of one regional center, for a center's staff to pick a person (for example to name an editor). The caller's own member token; never a service token.",
  description:
    "Who may ask: a member with the position `sound` (音控) or `president` (會長) who has an approved regional center sees only their own center (a `center` parameter naming another center is refused with 403); `super_admin` and `secretary` may add `center=<name from the 地區教育中心 vocabulary>` to list any center; everyone else gets 403. " +
    "Who is listed: active members with Amway on whose center is approved and equals the target center (compared by `center.key`), not the caller; members who never used the calling App are listed too (`signed_in_app` says which). " +
    "Only the least needed is returned: no email, phone, rank or other Amway field. `q` searches the display name only. The calling App must have `display_name` (and `avatar` for pictures) ticked for it in the back office, like any use of member data (ADR 0022). Every query is audited (caller, App, center, count; never the search text or names).",
  security,
  request: {
    query: z.object({
      q: z.string().max(50).optional().openapi({ description: "Part of the display name; empty lists the first page" }),
      limit: z.coerce.number().int().min(1).max(50).optional().openapi({ description: "Default 20, at most 50" }),
      cursor: z.string().max(300).optional().openapi({ description: "`next_cursor` of the previous page" }),
      center: z.string().max(60).optional().openapi({ description: "super_admin and secretary only: the center to list (name from the 地區教育中心 vocabulary)" }),
    }),
  },
  responses: {
    200: {
      description: "One page of members",
      content: json(
        z
          .object({
            center: z.object({ key: z.string(), label: z.string() }),
            members: z.array(z.object({ member_id: z.string(), display_name: z.string(), avatar_url: z.string().nullable(), signed_in_app: z.boolean() })),
            next_cursor: z.string().nullable(),
          })
          .openapi("CenterMembers"),
      ),
    },
    401: err("unauthenticated"),
    403: err("forbidden, or field_not_allowed when the App was not allowed the display name"),
    404: err("the named center is not in the vocabulary"),
    422: err("invalid cursor, or a center is required"),
  },
});

export function registerEligibilityRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/eligibility/*", bearerAuth(deps));

  app.openapi(checkRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const [m, ladder] = await Promise.all([loadMemberEligibility(c.env.DB, c.get("auth").memberId), loadLadder(c.env.DB)]);
    return c.json(evaluate(c.req.valid("json").rule, m, ladder), 200);
  });

  app.openapi(contextRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const memberId = c.get("auth").memberId;
    const [m, roles, fields] = await Promise.all([loadMemberEligibility(c.env.DB, memberId), rolesOf(c.env.DB, memberId), readAmwayFields(c.env.DB, memberId)]);
    const verified = !!m && m.amwayActive && m.hglobalVerified;
    // The center counts only when 寰宇 is verified and the center itself was approved by its reviewer.
    const row = fields.get("education_center");
    const label = verified && row && row.value_approved && typeof row.value === "string" ? row.value.trim() : "";
    c.header("cache-control", "no-store");
    return c.json(
      {
        member_id: memberId,
        roles: m ? roles.map((r) => ({ role: r, label: ROLE_LABELS[r] })) : [],
        hglobal_verified: verified,
        center: label ? { key: normTerm(label), label } : null,
      },
      200,
    );
  });

  app.openapi(centerMembersRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const db = c.env.DB;
    const auth = c.get("auth");
    const rid = c.get("requestId");
    c.header("cache-control", "no-store");
    const refuse = async (reason: string, message: string) => {
      await auditStatement(db, { actorType: "member", actorId: auth.memberId, action: "center_members.list", result: "denied", appId: auth.appId ?? null, requestId: rid, detail: { reason } }, deps.now()).run();
      return c.json(errorBody("forbidden", message, rid), 403) as never;
    };
    // Only a member signed in to an App (the calling App is part of the audit and of the permission check).
    if (!auth.appId) return refuse("not_an_app", "只有 App 內登入的會員可以查詢");
    const [roles, own, appEntry] = await Promise.all([rolesOf(db, auth.memberId), approvedCenterOf(db, auth.memberId), getApp(db, auth.appId, deps.now())]);
    if (!own.active) return refuse("inactive", "帳號不可用");
    const isAdmin = roles.includes("super_admin") || roles.includes("secretary");
    const isCenterStaff = roles.includes("sound") || roles.includes("president");
    if (!isAdmin && !isCenterStaff) return refuse("no_role", "需要音控、會長、秘書或超級管理員職務");
    const { q, limit, cursor, center } = c.req.valid("query");
    let target: { key: string; label: string };
    if (isAdmin) {
      if (center) {
        const hit = (await listTerms(db, "education_center")).find((t) => normTerm(t.term) === normTerm(center));
        if (!hit) return c.json(errorBody("not_found", "找不到這個中心", rid), 404) as never;
        target = { key: normTerm(hit.term), label: hit.term };
      } else if (own.center) target = own.center;
      else return c.json(errorBody("invalid_field", "請指定 center", rid, { field_key: "center", reason: "required" }), 422) as never;
    } else {
      // 音控 and 會長: their own approved center only, never another one.
      if (!own.center) return refuse("no_center", "需要已審核的教育中心");
      if (center && normTerm(center) !== own.center.key) return refuse("other_center", "只能查自己中心的會員");
      target = own.center;
    }
    // Member data is only used within what the owner ticked for this App (ADR 0022).
    if (!appEntry || !appEntry.member_data_fields.includes("display_name")) {
      return c.json(errorBody("field_not_allowed", "這款 App 沒有獲得使用會員顯示名稱的授權", rid, { fields: ["display_name"] }), 403) as never;
    }
    const parsed = cursor ? decodeCursor(cursor) : null;
    if (cursor && !parsed) return c.json(errorBody("invalid_field", "cursor 不正確", rid, { field_key: "cursor", reason: "format" }), 422) as never;
    const r = await listCenterMembers(db, { key: target.key, callerId: auth.memberId, appId: auth.appId, q: q ?? "", limit: limit ?? 20, cursor: parsed, withAvatar: appEntry.member_data_fields.includes("avatar") });
    await auditStatement(db, { actorType: "member", actorId: auth.memberId, action: "center_members.list", targetType: "center", targetId: target.key, result: "success", appId: auth.appId, requestId: rid, detail: { count: r.members.length, searched: !!q, paged: !!cursor } }, deps.now()).run();
    return c.json({ center: target, members: r.members, next_cursor: r.next ? encodeCursor(r.next) : null }, 200);
  });

  app.openapi(batchRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const [m, ladder] = await Promise.all([loadMemberEligibility(c.env.DB, c.get("auth").memberId), loadLadder(c.env.DB)]);
    return c.json({ results: c.req.valid("json").rules.map((r: Rule) => evaluate(r, m, ladder)) }, 200);
  });
}
