// /v1/me/spouse — spouse binding (integration instruction pack 4B).
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { getMember } from "../db/identity";
import { firstShared, maxEntriesFor, readNumbers, resolveCandidate } from "../db/member-numbers";
import { SpouseAlreadyBound, bindSpouses, getActiveBinding, otherSide, unbindSpouse } from "../db/spouse";
import { mergeForSpouses } from "../profile/member-number";
import { hasScopes } from "../oidc/scopes";
import { missingScope } from "./auth";
import { approvedRankLabel, shareRankOnBind } from "../db/amway";

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const security = [{ bearer: [] }];
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });

const SpouseSchema = z
  .object({
    spouse: z
      .object({
        display_name: z.string().nullable(),
        avatar_url: z.string().nullable(),
        rank: z.string().nullable().openapi({ description: "Shared reviewed rank label, or null" }),
        bound_at: z.string(),
        bound_by_me: z.boolean(),
      })
      .nullable(),
  })
  .openapi("Spouse");

const getRoute = createRoute({
  method: "get",
  path: "/v1/me/spouse",
  tags: ["spouse"],
  summary: "My spouse binding (scope profile.spouse.write or profile.read)",
  security,
  responses: { 200: { description: "Binding", content: json(SpouseSchema) }, 401: err("unauthenticated"), 403: err("forbidden") },
});
const postRoute = createRoute({
  method: "post",
  path: "/v1/me/spouse",
  tags: ["spouse"],
  summary: "Bind as spouses (single-sided consent, effective at once). candidate_id comes from duplicate_candidates.",
  security,
  request: { body: { required: true, content: json(z.object({ candidate_id: z.string().max(64) })) } },
  responses: {
    200: { description: "Bound", content: json(SpouseSchema) },
    401: err("unauthenticated"),
    403: err("forbidden"),
    404: err("not_found (candidate unknown, expired, or no longer sharing a number)"),
    409: err("spouse_already_bound"),
  },
});
const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/me/spouse",
  tags: ["spouse"],
  summary: "Unbind. Rank stays; the member who started the binding gets a new random member number. Re-read the profile afterwards.",
  security,
  responses: { 200: { description: "Unbound", content: json(SpouseSchema) }, 401: err("unauthenticated"), 403: err("forbidden"), 404: err("not_found (not bound)") },
});

async function describe(db: D1Database, memberId: string): Promise<z.infer<typeof SpouseSchema>> {
  const b = await getActiveBinding(db, memberId);
  if (!b) return { spouse: null };
  const otherId = otherSide(b, memberId);
  const other = await getMember(db, otherId);
  const dn = await db.prepare("SELECT value FROM profile_field_values WHERE member_id = ? AND field_key = 'display_name'").bind(otherId).first<{ value: string }>();
  let name = other?.display_name ?? null;
  if (dn) {
    try {
      name = JSON.parse(dn.value) as string;
    } catch {
      /* keep */
    }
  }
  return { spouse: { display_name: name, avatar_url: other?.avatar_url ?? null, rank: await approvedRankLabel(db, otherId), bound_at: b.created_at, bound_by_me: b.initiator_id === memberId } };
}

export function registerSpouseRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(getRoute, async (c) => {
    const scope = c.get("auth").scope;
    if (!hasScopes(scope, ["profile.spouse.write"]) && !hasScopes(scope, ["profile.read"])) {
      return c.json(errorBody("forbidden", "Insufficient scope", c.get("requestId"), { required_scopes: ["profile.spouse.write"] }), 403);
    }
    return c.json(await describe(c.env.DB, c.get("auth").memberId), 200);
  });

  app.openapi(postRoute, async (c) => {
    const denied = missingScope(c, ["profile.spouse.write"]);
    if (denied) return denied as never;
    const { memberId, clientId } = c.get("auth");
    const db = c.env.DB;
    const now = deps.now();
    const otherId = await resolveCandidate(db, memberId, c.req.valid("json").candidate_id, now);
    const other = otherId ? await getMember(db, otherId) : null;
    if (!otherId || !other || other.status !== "active") return c.json(errorBody("not_found", "Candidate not found", c.get("requestId")), 404);
    const mine = await readNumbers(db, memberId);
    const theirs = await readNumbers(db, otherId);
    const shared = firstShared(mine, theirs);
    if (!shared) return c.json(errorBody("not_found", "Candidate no longer shares a member number", c.get("requestId")), 404);
    if ((await getActiveBinding(db, memberId)) || (await getActiveBinding(db, otherId))) {
      return c.json(errorBody("spouse_already_bound", "已與其他會員綁定", c.get("requestId")), 409);
    }
    const max = await maxEntriesFor(db, [memberId, otherId]);
    try {
      await bindSpouses(db, { initiatorId: memberId, partnerId: otherId, shared: mergeForSpouses(shared, mine, theirs, max), appId: clientId, requestId: c.get("requestId"), now });
    } catch (e) {
      if (e instanceof SpouseAlreadyBound) return c.json(errorBody("spouse_already_bound", "已與其他會員綁定", c.get("requestId")), 409);
      throw e;
    }
    // From now on the couple shares one rank.
    await shareRankOnBind(db, memberId, otherId, now);
    return c.json(await describe(db, memberId), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const denied = missingScope(c, ["profile.spouse.write"]);
    if (denied) return denied as never;
    const { memberId, clientId } = c.get("auth");
    const db = c.env.DB;
    const binding = await getActiveBinding(db, memberId);
    if (!binding) return c.json(errorBody("not_found", "Not bound", c.get("requestId")), 404);
    const renumberedMember = await getMember(db, binding.initiator_id);
    await unbindSpouse(db, { memberId, binding, fallbackCountry: renumberedMember?.registration_country ?? "TW", appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    return c.json({ spouse: null }, 200);
  });
}
