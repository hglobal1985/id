// Numbers for the back-office home (counts only: no names, no member data).
import { epochSeconds, taipeiIso } from "../lib/time";
import { listApps } from "./apps";
import { trafficLights, type Light } from "../admin/lights";

export interface Overview {
  members: { total: number; new_7d: number; active_7d: number };
  active_sessions: number;
  pending_reviews: number;
  apps: { total: number; active: number; paused: number; killed: number };
  lights: Light[];
}

const DAY = 24 * 3600 * 1000;

export async function loadOverview(db: D1Database, now: Date): Promise<Overview> {
  const since = taipeiIso(new Date(now.getTime() - 7 * DAY));
  const t = epochSeconds(now);
  const n = async (sql: string, ...args: (string | number)[]) => (await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
  const [total, fresh, active, sessions, pending, oldest, registry] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM members WHERE status = 'active'"),
    n("SELECT COUNT(*) AS n FROM members WHERE status = 'active' AND created_at >= ?", since),
    n("SELECT COUNT(*) AS n FROM members WHERE status = 'active' AND last_login_at >= ?", since),
    n("SELECT COUNT(*) AS n FROM app_sessions WHERE revoked_epoch IS NULL AND expires_epoch > ?", t),
    n("SELECT COUNT(*) AS n FROM amway_review_requests WHERE status = 'pending'"),
    db.prepare("SELECT MIN(created_at) AS first FROM amway_review_requests WHERE status = 'pending'").first<{ first: string | null }>(),
    listApps(db, now),
  ]);
  const oldestMs = oldest?.first ? Date.parse(oldest.first) : NaN;
  const statuses = registry.apps.map((a) => a.status);
  return {
    members: { total, new_7d: fresh, active_7d: active },
    active_sessions: sessions,
    pending_reviews: pending,
    apps: {
      total: statuses.length,
      active: statuses.filter((s) => s === "active").length,
      paused: statuses.filter((s) => s === "paused").length,
      killed: statuses.filter((s) => s === "killed").length,
    },
    lights: trafficLights({
      appStatuses: statuses,
      invalidApps: registry.invalid.length,
      pendingReviews: pending,
      oldestReviewDays: Number.isNaN(oldestMs) ? null : Math.floor((now.getTime() - oldestMs) / DAY),
    }),
  };
}
