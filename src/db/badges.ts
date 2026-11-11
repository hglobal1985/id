// The boxes beside a member's name: training system (系統), regional center (中心) and the reviewed rank (獎銜).
// Shown only while 我是Amway會員 is on and only for what is filled; the rank only when it has been reviewed.
import { approvedRankLabel, readAmwayFields } from "./amway";
import { fitBadge, rankBadge, type RankBadge } from "../web/nav-text";

export interface HeroBadge extends RankBadge {
  kind: "system" | "center" | "rank";
}

export async function heroBadges(db: D1Database, memberId: string): Promise<HeroBadge[]> {
  const m = await db.prepare("SELECT amway_enabled FROM members WHERE id = ?").bind(memberId).first<{ amway_enabled: number }>();
  if (m?.amway_enabled !== 1) return [];
  const [rows, rank] = await Promise.all([readAmwayFields(db, memberId), approvedRankLabel(db, memberId)]);
  const out: HeroBadge[] = [];
  const text = (k: string) => {
    const v = rows.get(k)?.value;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const sys = text("education_system");
  const center = text("education_center");
  const r = rankBadge(rank);
  if (sys) out.push({ kind: "system", ...fitBadge(sys) });
  if (center) out.push({ kind: "center", ...fitBadge(center) });
  if (r) out.push({ kind: "rank", ...r });
  return out;
}
