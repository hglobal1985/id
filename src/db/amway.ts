// Amway area data access: options, consent, enable switch, field values with review, reviewer actions.
import { uuidv7 } from "../lib/crypto";
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { getActiveBinding, otherSide } from "./spouse";
import { CONSENT_DOCUMENT, CONSENT_VERSION } from "../amway/consent";
import {
  AMWAY_FIELDS,
  HGLOBAL,
  OTHER,
  getAmwayField,
  needsReview,
  optionOf,
  sameValue,
  type AmwayValue,
  type Option,
  type ReviewStatus,
} from "../amway/fields";

export interface Ctx {
  appId: string | null;
  requestId: string;
  now: Date;
}

export async function listOptions(db: D1Database): Promise<Map<string, Option[]>> {
  const r = await db
    .prepare("SELECT field_key, value, label FROM amway_options WHERE active = 1 ORDER BY field_key, sort_order, value")
    .all<{ field_key: string; value: string; label: string }>();
  const out = new Map<string, Option[]>();
  for (const f of AMWAY_FIELDS) out.set(f.key, []);
  for (const row of r.results ?? []) out.get(row.field_key)?.push({ value: row.value, label: row.label });
  // "其他" (custom text) is always offered last for select-or-custom fields.
  for (const f of AMWAY_FIELDS) if (f.type === "select_or_custom") out.get(f.key)?.push({ value: OTHER, label: "其他" });
  return out;
}

export async function rankOrder(db: D1Database): Promise<Map<string, number>> {
  const r = await db.prepare("SELECT value, sort_order FROM amway_options WHERE field_key = 'rank'").all<{ value: string; sort_order: number }>();
  return new Map((r.results ?? []).map((x) => [x.value, x.sort_order]));
}

// ---------- consent & switch ----------

export interface ConsentState {
  version: string;
  accepted_at: string;
}

/** Latest consent for the Amway document, or null if never accepted or last action was a withdrawal. */
export async function latestConsent(db: D1Database, memberId: string): Promise<ConsentState | null> {
  const r = await db
    .prepare("SELECT version, action, occurred_at FROM consent_records WHERE member_id = ? AND document = ? ORDER BY occurred_at DESC, id DESC LIMIT 1")
    .bind(memberId, CONSENT_DOCUMENT)
    .first<{ version: string; action: string; occurred_at: string }>();
  if (!r || r.action !== "accept") return null;
  return { version: r.version, accepted_at: r.occurred_at };
}

export function consentIsCurrent(c: ConsentState | null): boolean {
  return c?.version === CONSENT_VERSION;
}

export async function setAmwayEnabled(db: D1Database, memberId: string, enabled: boolean, ctx: Ctx): Promise<void> {
  const ts = taipeiIso(ctx.now);
  const stmts: D1PreparedStatement[] = [db.prepare("UPDATE members SET amway_enabled = ?, updated_at = ? WHERE id = ?").bind(enabled ? 1 : 0, ts, memberId)];
  if (enabled) {
    stmts.push(
      db
        .prepare("INSERT INTO consent_records (id, member_id, document, version, action, occurred_at, app_id) VALUES (?, ?, ?, ?, 'accept', ?, ?)")
        .bind(uuidv7(ctx.now.getTime()), memberId, CONSENT_DOCUMENT, CONSENT_VERSION, ts, ctx.appId),
    );
  }
  stmts.push(
    auditStatement(
      db,
      { actorType: "member", actorId: memberId, action: enabled ? "amway.enable" : "amway.disable", targetType: "member", targetId: memberId, result: "success", appId: ctx.appId, requestId: ctx.requestId, detail: enabled ? { consent_version: CONSENT_VERSION } : null },
      ctx.now,
    ),
  );
  await db.batch(stmts);
}

// ---------- field values ----------

export interface FieldRow {
  value: AmwayValue;
  pending_value: AmwayValue;
  status: ReviewStatus;
  updated_at: string;
}

const parse = (s: string | null): AmwayValue => (s === null ? null : (JSON.parse(s) as AmwayValue));
const enc = (v: AmwayValue): string | null => (v === null ? null : JSON.stringify(v));

export async function readAmwayFields(db: D1Database, memberId: string): Promise<Map<string, FieldRow>> {
  const r = await db
    .prepare("SELECT field_key, value, pending_value, status, updated_at FROM amway_field_values WHERE member_id = ?")
    .bind(memberId)
    .all<{ field_key: string; value: string | null; pending_value: string | null; status: ReviewStatus; updated_at: string }>();
  const out = new Map<string, FieldRow>();
  for (const x of r.results ?? []) out.set(x.field_key, { value: parse(x.value), pending_value: parse(x.pending_value), status: x.status, updated_at: x.updated_at });
  return out;
}

function upsertRow(db: D1Database, memberId: string, key: string, row: Omit<FieldRow, "updated_at">, ts: string, reviewer: string | null = null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, updated_at, reviewed_at, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (member_id, field_key) DO UPDATE SET value = excluded.value, pending_value = excluded.pending_value,
         status = excluded.status, updated_at = excluded.updated_at,
         reviewed_at = COALESCE(excluded.reviewed_at, amway_field_values.reviewed_at),
         reviewed_by = COALESCE(excluded.reviewed_by, amway_field_values.reviewed_by)`,
    )
    .bind(memberId, key, enc(row.value), enc(row.pending_value), row.status, ts, reviewer ? ts : null, reviewer);
}

function supersedePending(db: D1Database, memberId: string, key: string, ts: string): D1PreparedStatement {
  return db
    .prepare("UPDATE amway_review_requests SET status = 'superseded', decided_at = ? WHERE member_id = ? AND field_key = ? AND status = 'pending'")
    .bind(ts, memberId, key);
}

export function notificationStatement(db: D1Database, memberId: string, kind: string, payload: Record<string, string>, now: Date): D1PreparedStatement {
  return db
    .prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uuidv7(now.getTime()), memberId, kind, JSON.stringify(payload), taipeiIso(now));
}

/** Members a rank write applies to: the member and, while bound, the spouse (they share one rank). */
async function rankHolders(db: D1Database, memberId: string): Promise<string[]> {
  const b = await getActiveBinding(db, memberId);
  return b ? [memberId, otherSide(b, memberId)] : [memberId];
}

export type WriteResult = { ok: true; row: FieldRow } | { ok: false; reason: string; message: string };

/**
 * Member writes one Amway field. Fields that need review keep the effective value and store the new
 * value as pending (the effective value does not change until approved). Others apply at once.
 */
export async function writeAmwayField(db: D1Database, memberId: string, key: string, value: AmwayValue, ctx: Ctx): Promise<WriteResult> {
  const def = getAmwayField(key);
  if (!def) throw new Error(`unknown field ${key}`);
  const ts = taipeiIso(ctx.now);
  const rows = await readAmwayFields(db, memberId);
  const sys = rows.get("education_system");
  const educationSystem = { effective: optionOf(sys?.value ?? null), pending: optionOf(sys?.pending_value ?? null) };

  if (key === "education_center" && value !== null && educationSystem.effective !== HGLOBAL && educationSystem.pending !== HGLOBAL) {
    return { ok: false, reason: "not_applicable", message: "教育體系為 H-Global1985 時才能選擇教育中心" };
  }

  const current = rows.get(key);
  const holders = key === "rank" ? await rankHolders(db, memberId) : [memberId];
  const stmts: D1PreparedStatement[] = [];
  let row: Omit<FieldRow, "updated_at">;
  let review = false;

  if (current && current.status !== "rejected" && sameValue(current.value, value) && current.pending_value !== null) {
    // Back to the effective value: cancel the pending change.
    row = { value: current.value, pending_value: null, status: current.status === "pending" ? (needsReview(def, value, educationSystem) ? "approved" : "not_required") : current.status };
  } else if (current && sameValue(current.value, value) && current.pending_value === null && current.status !== "rejected") {
    return { ok: true, row: current }; // idempotent
  } else if (current && current.pending_value !== null && sameValue(current.pending_value, value)) {
    return { ok: true, row: current }; // same pending value re-sent
  } else if (needsReview(def, value, educationSystem)) {
    review = true;
    row = { value: current?.value ?? null, pending_value: value, status: "pending" };
    stmts.push(
      db
        .prepare("INSERT INTO amway_review_requests (id, member_id, field_key, requested_value, status, created_at, app_id) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
        .bind(uuidv7(ctx.now.getTime()), memberId, key, JSON.stringify(value), ts, ctx.appId),
    );
  } else {
    row = { value, pending_value: null, status: "not_required" };
  }

  for (const h of holders) {
    stmts.unshift(supersedePending(db, h, key, ts));
    stmts.push(upsertRow(db, h, key, row, ts));
  }

  // Leaving "hglobal" (applied at once) releases a rank that was only pending because of it.
  if (key === "education_system" && !review && optionOf(value) !== HGLOBAL) {
    const rank = rows.get("rank");
    if (rank?.pending_value != null) {
      for (const h of await rankHolders(db, memberId)) {
        stmts.push(supersedePending(db, h, "rank", ts));
        stmts.push(upsertRow(db, h, "rank", { value: rank.pending_value, pending_value: null, status: "not_required" }, ts));
      }
    }
  }

  stmts.push(
    auditStatement(
      db,
      { actorType: "member", actorId: memberId, action: "amway.field.update", targetType: "member", targetId: memberId, result: "success", appId: ctx.appId, requestId: ctx.requestId, detail: { field_key: key, review } },
      ctx.now,
    ),
  );
  await db.batch(stmts);
  return { ok: true, row: { ...row, updated_at: ts } };
}

// ---------- reviewer actions (admin UI and roles arrive in PR 7) ----------

export interface ReviewRequestRow {
  id: string;
  member_id: string;
  field_key: string;
  requested_value: string;
  status: string;
}

export async function pendingReviews(db: D1Database): Promise<ReviewRequestRow[]> {
  const r = await db
    .prepare("SELECT id, member_id, field_key, requested_value, status FROM amway_review_requests WHERE status = 'pending' ORDER BY created_at")
    .all<ReviewRequestRow>();
  return r.results ?? [];
}

/** Approve or reject a pending request. Approve makes the value effective; reject keeps the old value. Notifies the member. */
export async function decideReview(db: D1Database, requestId: string, decision: "approve" | "reject", staffId: string, ctx: Ctx): Promise<boolean> {
  const req = await db.prepare("SELECT * FROM amway_review_requests WHERE id = ? AND status = 'pending'").bind(requestId).first<ReviewRequestRow>();
  if (!req) return false;
  const ts = taipeiIso(ctx.now);
  const rows = await readAmwayFields(db, req.member_id);
  const current = rows.get(req.field_key);
  const requested = parse(req.requested_value);
  const holders = req.field_key === "rank" ? await rankHolders(db, req.member_id) : [req.member_id];
  const row: Omit<FieldRow, "updated_at"> =
    decision === "approve"
      ? { value: requested, pending_value: null, status: "approved" }
      : { value: current?.value ?? null, pending_value: null, status: "rejected" };
  await db.batch([
    db.prepare("UPDATE amway_review_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'").bind(decision === "approve" ? "approved" : "rejected", ts, staffId, requestId),
    ...holders.map((h) => upsertRow(db, h, req.field_key, row, ts, staffId)),
    notificationStatement(db, req.member_id, decision === "approve" ? "amway.review.approved" : "amway.review.rejected", { field_key: req.field_key }, ctx.now),
    auditStatement(db, { actorType: "staff", actorId: staffId, action: `amway.review.${decision}`, targetType: "member", targetId: req.member_id, result: "success", requestId: ctx.requestId, detail: { field_key: req.field_key, request_id: requestId } }, ctx.now),
  ]);
  return true;
}

/** Reviewer adjusts one of the six fields directly: treated as approved, audited, member notified. */
export async function staffAdjust(db: D1Database, memberId: string, key: string, value: AmwayValue, staffId: string, ctx: Ctx): Promise<void> {
  const ts = taipeiIso(ctx.now);
  const holders = key === "rank" ? await rankHolders(db, memberId) : [memberId];
  await db.batch([
    ...holders.map((h) => supersedePending(db, h, key, ts)),
    ...holders.map((h) => upsertRow(db, h, key, { value, pending_value: null, status: "approved" }, ts, staffId)),
    notificationStatement(db, memberId, "amway.review.adjusted", { field_key: key }, ctx.now),
    auditStatement(db, { actorType: "staff", actorId: staffId, action: "amway.review.adjust", targetType: "member", targetId: memberId, result: "success", requestId: ctx.requestId, detail: { field_key: key } }, ctx.now),
  ]);
}

/** On spouse binding the couple starts sharing one rank: the higher effective rank (ladder order) wins. */
export async function shareRankOnBind(db: D1Database, a: string, b: string, now: Date): Promise<void> {
  const [ra, rb] = [(await readAmwayFields(db, a)).get("rank"), (await readAmwayFields(db, b)).get("rank")];
  const order = await rankOrder(db);
  const score = (r: FieldRow | undefined) => (r?.value && typeof r.value === "string" ? (order.get(r.value) ?? -1) : -2);
  if (!ra && !rb) return;
  const winner = score(ra) >= score(rb) ? ra : rb;
  if (!winner) return;
  const ts = taipeiIso(now);
  await db.batch([a, b].map((m) => upsertRow(db, m, "rank", { value: winner.value, pending_value: winner.pending_value, status: winner.status }, ts)));
}

/** Label of the member's reviewed (approved) rank, shown to others; null if none or the Amway area is off. */
export async function approvedRankLabel(db: D1Database, memberId: string): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT o.label FROM amway_field_values v JOIN members m ON m.id = v.member_id
       JOIN amway_options o ON o.field_key = 'rank' AND o.value = json_extract(v.value, '$')
       WHERE v.member_id = ? AND v.field_key = 'rank' AND v.status = 'approved' AND m.amway_enabled = 1`,
    )
    .bind(memberId)
    .first<{ label: string }>();
  return r?.label ?? null;
}
