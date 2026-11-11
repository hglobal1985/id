// The boxes beside a member's name: training system (系統), regional center (中心) and the reviewed rank (獎銜).
// Shown only while 我是Amway會員 is on and only for what is filled; the rank only when it has been reviewed.
import { approvedRankLabel, readAmwayFields } from "./amway";
import { amwayDefault, visibilityOf } from "../profile/visibility";
import { fitBadge, rankBadge, type RankBadge } from "../web/nav-text";

export interface HeroBadge extends RankBadge {
  kind: "system" | "center" | "rank";
}

/** `publicOnly`: what a visitor may see (a hidden field has no box); the member themself sees every box. */
export async function heroBadges(db: D1Database, memberId: string, publicOnly = false): Promise<HeroBadge[]> {
  const m = await db.prepare("SELECT amway_enabled FROM members WHERE id = ?").bind(memberId).first<{ amway_enabled: number }>();
  if (m?.amway_enabled !== 1) return [];
  const [rows, rank] = await Promise.all([readAmwayFields(db, memberId), approvedRankLabel(db, memberId)]);
  const out: HeroBadge[] = [];
  const text = (k: string) => {
    const v = rows.get(k)?.value;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const hidden = new Set<string>();
  if (publicOnly) {
    const vis = await db.prepare("SELECT field_key, visibility FROM profile_visibility WHERE member_id = ? AND field_key IN ('education_system','education_center','rank')").bind(memberId).all<{ field_key: string; visibility: "public" | "private" }>();
    const stored = new Map((vis.results ?? []).map((v) => [v.field_key, v.visibility]));
    for (const k of ["education_system", "education_center", "rank"]) if (visibilityOf(k, stored.get(k), amwayDefault(k)) !== "public") hidden.add(k);
  }
  const sys = hidden.has("education_system") ? null : text("education_system");
  const center = hidden.has("education_center") ? null : text("education_center");
  const r = hidden.has("rank") ? null : rankBadge(rank);
  if (sys) out.push({ kind: "system", ...fitBadge(sys) });
  if (center) out.push({ kind: "center", ...fitBadge(center) });
  if (r) out.push({ kind: "rank", ...r });
  return out;
}
