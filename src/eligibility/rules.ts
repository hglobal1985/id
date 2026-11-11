// Eligibility rules (framework-free). The central system answers "does this member meet this rule";
// apps decide which rule each piece of content uses. Rank comparison and backward compatibility
// (a higher rank may see lower-rank content) live only here. Anything unknown means "not allowed".

export type Audience = "hglobal_verified" | "everyone";
export type Reason = "ok" | "not_verified" | "rank_too_low" | "amway_disabled";

export interface Rule {
  audience: Audience;
  min_rank?: string | null;
}

export interface MemberEligibility {
  /** 「我是Amway會員」 is on. */
  amwayActive: boolean;
  /** Effective education system is hglobal AND it was approved by review. */
  hglobalVerified: boolean;
  /** Effective rank code, only if approved by review; otherwise null. */
  approvedRank: string | null;
}

/** Rank ladder: code → position (higher = higher rank). Built from the rank option sort order. */
export type Ladder = Map<string, number>;

export function evaluate(rule: Rule, m: MemberEligibility | null, ladder: Ladder): { allowed: boolean; reason: Reason } {
  if (rule.audience === "everyone") return { allowed: true, reason: "ok" };
  if (rule.audience !== "hglobal_verified") return { allowed: false, reason: "not_verified" };
  if (!m || !m.amwayActive) return { allowed: false, reason: "amway_disabled" };
  if (!m.hglobalVerified) return { allowed: false, reason: "not_verified" };
  if (rule.min_rank === undefined || rule.min_rank === null || rule.min_rank === "") return { allowed: true, reason: "ok" };
  const need = ladder.get(rule.min_rank);
  const have = m.approvedRank === null ? undefined : ladder.get(m.approvedRank);
  // Unknown or retired rank codes (either side) fail closed.
  if (need === undefined || have === undefined || have < need) return { allowed: false, reason: "rank_too_low" };
  return { allowed: true, reason: "ok" };
}
