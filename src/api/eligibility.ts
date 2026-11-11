// POST /v1/eligibility/check and /v1/eligibility/check-batch (integration instruction pack, section 5).
// `reason` is for the app's internal logs only and must never be shown to members.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema } from "../errors";
import { bearerAuth, missingScope } from "./auth";
import { evaluate, type Rule } from "../eligibility/rules";
import { loadLadder, loadMemberEligibility } from "../db/eligibility";
import { readAmwayFields } from "../db/amway";
import { rolesOf } from "../db/staff";
import { ROLE_LABELS } from "../admin/roles";
import { normTerm } from "../vocab/terms";

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

  app.openapi(batchRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const [m, ladder] = await Promise.all([loadMemberEligibility(c.env.DB, c.get("auth").memberId), loadLadder(c.env.DB)]);
    return c.json({ results: c.req.valid("json").rules.map((r: Rule) => evaluate(r, m, ladder)) }, 200);
  });
}
