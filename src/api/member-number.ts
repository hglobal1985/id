// PUT /v1/me/profile/fields/member_number — whole ordered list; duplicates are allowed and reported
// as spouse candidates. Self-service changes: at most 3 per 24 hours (audited; no review).
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { errorBody } from "../errors";
import { getMember } from "../db/identity";
import {
  SELF_CHANGES_PER_DAY,
  findDuplicateCandidates,
  maxEntriesFor,
  readNumbers,
  replaceNumbersStatements,
  retryAfterSeconds,
  selfChangesLastDay,
} from "../db/member-numbers";
import { auditStatement } from "../db/audit";
import { getActiveBinding, otherSide } from "../db/spouse";
import { publicId, sameList, validateMemberNumbers, type MemberNumberEntry } from "../profile/member-number";
import { taipeiIso } from "../lib/time";
import { resolveIssuer } from "../oidc/config";
import { missingScope } from "./auth";

type C = Context<AppBindings>;

export async function putMemberNumbers(c: C, deps: Deps): Promise<Response> {
  const denied = missingScope(c, ["profile.basic.write"]);
  if (denied) return denied;
  const { memberId, clientId } = c.get("auth");
  const now = deps.now();
  const db = c.env.DB;
  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
  const member = await getMember(db, memberId);
  if (!member) return c.json(errorBody("unauthenticated", "A valid access token is required", c.get("requestId")), 401);

  const binding = await getActiveBinding(db, memberId);
  const spouseId = binding ? otherSide(binding, memberId) : null;
  const max = await maxEntriesFor(db, spouseId ? [memberId, spouseId] : [memberId]);
  const v = validateMemberNumbers(body?.value, max);
  if (!v.ok) return c.json(errorBody("invalid_field", v.message, c.get("requestId"), { field_key: "member_number", reason: v.reason }), 422);

  const current = await readNumbers(db, memberId);
  const issuer = resolveIssuer(c.env, c.req.url);
  const publicUrl = `${issuer}/${encodeURIComponent(publicId(v.value[0] as MemberNumberEntry))}`;
  if (sameList(current, v.value)) {
    return c.json({ field_key: "member_number", value: v.value, updated_at: null, public_url: publicUrl, duplicate_candidates: [] }, 200);
  }

  const { count, oldest } = await selfChangesLastDay(db, memberId, now);
  if (count >= SELF_CHANGES_PER_DAY) {
    const retry = retryAfterSeconds(oldest, now);
    c.header("retry-after", String(retry));
    return c.json(errorBody("rate_limited", "24 小時內最多修改 3 次會員編號", c.get("requestId"), { field_key: "member_number", retry_after: retry }), 429);
  }

  // A bound couple shares one list: write it to both.
  await db.batch([
    ...replaceNumbersStatements(db, memberId, v.value, now),
    // From now on the "recommended to change" reminder stays away for good.
    db.prepare("UPDATE members SET number_customized = 1 WHERE id = ?").bind(memberId),
    ...(spouseId ? replaceNumbersStatements(db, spouseId, v.value, now) : []),
    auditStatement(
      db,
      { actorType: "member", actorId: memberId, action: "member_number.update", targetType: "member", targetId: memberId, result: "success", appId: clientId, requestId: c.get("requestId"), detail: { entries: v.value.length, shared_with_spouse: !!spouseId } },
      now,
    ),
  ]);
  const candidates = await findDuplicateCandidates(db, memberId, v.value, now);
  return c.json({ field_key: "member_number", value: v.value, updated_at: taipeiIso(now), public_url: publicUrl, duplicate_candidates: candidates }, 200);
}
