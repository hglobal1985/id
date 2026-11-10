// POST /v1/eligibility/check and /v1/eligibility/check-batch (integration instruction pack, section 5).
// `reason` is for the app's internal logs only and must never be shown to members.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema } from "../errors";
import { bearerAuth, missingScope } from "./auth";
import { evaluate, type Rule } from "../eligibility/rules";
import { loadLadder, loadMemberEligibility } from "../db/eligibility";

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

export function registerEligibilityRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.use("/v1/eligibility/*", bearerAuth(deps));

  app.openapi(checkRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const [m, ladder] = await Promise.all([loadMemberEligibility(c.env.DB, c.get("auth").memberId), loadLadder(c.env.DB)]);
    return c.json(evaluate(c.req.valid("json").rule, m, ladder), 200);
  });

  app.openapi(batchRoute, async (c) => {
    const denied = missingScope(c, ["amway.read"]);
    if (denied) return denied as never;
    const [m, ladder] = await Promise.all([loadMemberEligibility(c.env.DB, c.get("auth").memberId), loadLadder(c.env.DB)]);
    return c.json({ results: c.req.valid("json").rules.map((r: Rule) => evaluate(r, m, ladder)) }, 200);
  });
}
