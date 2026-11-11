// Saved field order (see profile/layout.ts).
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { LAYOUT_GROUPS, type LayoutGroup } from "../profile/layout";

export async function loadLayout(db: D1Database): Promise<Map<string, number>> {
  const r = await db.prepare("SELECT field_key, sort_order FROM profile_layout").all<{ field_key: string; sort_order: number }>();
  return new Map((r.results ?? []).map((x) => [x.field_key, x.sort_order]));
}

/** Saves the order of every group (replaces the earlier one). `reset` removes the saved order. */
export async function saveLayout(db: D1Database, order: Record<LayoutGroup, string[]> | null, actor: { memberId: string; requestId: string; now: Date }): Promise<void> {
  const ts = taipeiIso(actor.now);
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM profile_layout")];
  if (order) {
    for (const g of LAYOUT_GROUPS) {
      order[g].forEach((key, i) => stmts.push(db.prepare("INSERT INTO profile_layout (field_key, sort_order, updated_at, updated_by) VALUES (?, ?, ?, ?)").bind(key, (i + 1) * 10, ts, actor.memberId)));
    }
  }
  stmts.push(auditStatement(db, { actorType: "staff", actorId: actor.memberId, action: order ? "layout.save" : "layout.reset", targetType: "profile_layout", result: "success", requestId: actor.requestId }, actor.now));
  await db.batch(stmts);
}
