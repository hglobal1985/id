import { readAmwayFields } from "./amway";
import { hglobalNorms } from "./vocab";
import { HGLOBAL, isNone, systemKey } from "../amway/fields";
import type { Ladder, MemberEligibility } from "../eligibility/rules";

export async function loadMemberEligibility(db: D1Database, memberId: string): Promise<MemberEligibility | null> {
  const m = await db.prepare("SELECT amway_enabled, status FROM members WHERE id = ?").bind(memberId).first<{ amway_enabled: number; status: string }>();
  if (!m || m.status !== "active") return null;
  const hg = await hglobalNorms(db);
  const rows = await readAmwayFields(db, memberId);
  const sys = rows.get("education_system");
  const rank = rows.get("rank");
  // 寰宇 alone passes at once; a member who also named a regional center is verified once that center was approved by its reviewer.
  const center = rows.get("education_center");
  const hasCenter = !!center && ((center.value !== null && !isNone(center.value)) || (center.pending_value !== null && !isNone(center.pending_value)));
  const centerOk = !hasCenter || (!!center && center.value !== null && center.value_approved);
  return {
    amwayActive: m.amway_enabled === 1,
    hglobalVerified: !!sys && systemKey(sys.value, hg) === HGLOBAL && centerOk,
    approvedRank: rank && rank.value_approved && typeof rank.value === "string" ? rank.value : null,
  };
}

/** Active rank ladder. Retired (inactive) ranks drop out, so rules naming them fail closed. */
export async function loadLadder(db: D1Database): Promise<Ladder> {
  const r = await db.prepare("SELECT value, sort_order FROM amway_options WHERE field_key = 'rank' AND active = 1").all<{ value: string; sort_order: number }>();
  return new Map((r.results ?? []).map((x) => [x.value, x.sort_order]));
}
