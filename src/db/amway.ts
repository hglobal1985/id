// Amway area data access: options, consent, enable switch, field values with review, reviewer actions.
import { uuidv7 } from "../lib/crypto";
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { getActiveBinding, otherSide } from "./spouse";
import { notifyReviewersStatement } from "./staff";
import { hglobalNorms } from "./vocab";
import {
  AMWAY_FIELDS,
  HGLOBAL,
  getAmwayField,
  needsReview,
  sameValue,
  systemKey,
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
  return out;
}

export async function rankOrder(db: D1Database): Promise<Map<string, number>> {
  const r = await db.prepare("SELECT value, sort_order FROM amway_options WHERE field_key = 'rank'").all<{ value: string; sort_order: number }>();
  return new Map((r.results ?? []).map((x) => [x.value, x.sort_order]));
}

// ---------- switch ----------

/** Turns 「我是Amway會員」 on or off at once (no confirmation step; off keeps the data and pauses eligibility). */
export async function setAmwayEnabled(db: D1Database, memberId: string, enabled: boolean, ctx: Ctx): Promise<void> {
  const ts = taipeiIso(ctx.now);
  await db.batch([
    db.prepare("UPDATE members SET amway_enabled = ?, updated_at = ? WHERE id = ?").bind(enabled ? 1 : 0, ts, memberId),
    auditStatement(
      db,
      { actorType: "member", actorId: memberId, action: enabled ? "amway.enable" : "amway.disable", targetType: "member", targetId: memberId, result: "success", appId: ctx.appId, requestId: ctx.requestId },
      ctx.now,
    ),
  ]);
}

// ---------- field values ----------

export interface FieldRow {
  value: AmwayValue;
  pending_value: AmwayValue;
  status: ReviewStatus;
  /** The effective value was approved by review or set by a reviewer. */
  value_approved: boolean;
  updated_at: string;
}

/** For writes: true/false sets the flag; "keep" leaves the stored flag (new rows get false). */
type Approved = boolean | "keep";
type RowWrite = Omit<FieldRow, "updated_at" | "value_approved"> & { value_approved: Approved };

const parse = (s: string | null): AmwayValue => (s === null ? null : (JSON.parse(s) as AmwayValue));
const enc = (v: AmwayValue): string | null => (v === null ? null : JSON.stringify(v));

export async function readAmwayFields(db: D1Database, memberId: string): Promise<Map<string, FieldRow>> {
  const r = await db
    .prepare("SELECT field_key, value, pending_value, status, value_approved, updated_at FROM amway_field_values WHERE member_id = ?")
    .bind(memberId)
    .all<{ field_key: string; value: string | null; pending_value: string | null; status: ReviewStatus; value_approved: number; updated_at: string }>();
  const out = new Map<string, FieldRow>();
  for (const x of r.results ?? []) out.set(x.field_key, { value: parse(x.value), pending_value: parse(x.pending_value), status: x.status, value_approved: x.value_approved === 1, updated_at: x.updated_at });
  return out;
}

function upsertRow(db: D1Database, memberId: string, key: string, row: RowWrite, ts: string, reviewer: string | null = null): D1PreparedStatement {
  const keep = row.value_approved === "keep" ? 1 : 0;
  const flag = row.value_approved === true ? 1 : 0;
  return db
    .prepare(
      `INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at, reviewed_at, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (member_id, field_key) DO UPDATE SET value = excluded.value, pending_value = excluded.pending_value,
         status = excluded.status, updated_at = excluded.updated_at,
         value_approved = CASE WHEN ${keep} = 1 THEN amway_field_values.value_approved ELSE excluded.value_approved END,
         reviewed_at = COALESCE(excluded.reviewed_at, amway_field_values.reviewed_at),
         reviewed_by = COALESCE(excluded.reviewed_by, amway_field_values.reviewed_by)`,
    )
    .bind(memberId, key, enc(row.value), enc(row.pending_value), row.status, flag, ts, reviewer ? ts : null, reviewer);
}

function supersedePending(db: D1Database, memberId: string, key: string, ts: string): D1PreparedStatement {
  return db
    .prepare("UPDATE amway_review_requests SET status = 'superseded', decided_at = ? WHERE member_id = ? AND field_key = ? AND status = 'pending'")
    .bind(ts, memberId, key);
}

/** The member's training system (effective or pending) is a term marked as H-Global1985. */
export async function isHglobalMember(db: D1Database, memberId: string): Promise<boolean> {
  const [rows, hg] = await Promise.all([readAmwayFields(db, memberId), hglobalNorms(db)]);
  const sys = rows.get("education_system");
  return systemKey(sys?.value ?? null, hg) === HGLOBAL || systemKey(sys?.pending_value ?? null, hg) === HGLOBAL;
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
  const hg = await hglobalNorms(db);
  const educationSystem = { effective: systemKey(sys?.value ?? null, hg), pending: systemKey(sys?.pending_value ?? null, hg) };

  const current = rows.get(key);
  const holders = key === "rank" ? await rankHolders(db, memberId) : [memberId];
  const stmts: D1PreparedStatement[] = [];
  let row: RowWrite;
  let review = false;
  // A value that should have been reviewed but never was (entered before the rule covered it): sending it again starts the
  // standard review, and it does not count as effective until approved — nobody, staff included, skips the review.
  const unreviewed = !!current && current.value !== null && !current.value_approved && current.status === "not_required" && needsReview(def, current.value, educationSystem, hg);

  if (current && current.status !== "rejected" && sameValue(current.value, value) && current.pending_value !== null) {
    // Back to the effective value: cancel the pending change.
    row = { value: current.value, pending_value: null, status: current.value_approved ? "approved" : "not_required", value_approved: "keep" };
  } else if (current && sameValue(current.value, value) && current.pending_value === null && current.status !== "rejected" && !unreviewed) {
    return { ok: true, row: current }; // idempotent
  } else if (current && current.pending_value !== null && sameValue(current.pending_value, value)) {
    return { ok: true, row: current }; // same pending value re-sent
  } else if (needsReview(def, value, educationSystem, hg)) {
    review = true;
    row = { value: unreviewed ? null : (current?.value ?? null), pending_value: value, status: "pending", value_approved: "keep" };
    const reviewId = uuidv7(ctx.now.getTime());
    stmts.push(
      db
        .prepare("INSERT INTO amway_review_requests (id, member_id, field_key, requested_value, status, created_at, app_id) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
        .bind(reviewId, memberId, key, JSON.stringify(value), ts, ctx.appId),
      notifyReviewersStatement(db, reviewId, ctx.now),
    );
  } else {
    row = { value, pending_value: null, status: "not_required", value_approved: false };
  }

  for (const h of holders) {
    stmts.unshift(supersedePending(db, h, key, ts));
    stmts.push(upsertRow(db, h, key, row, ts));
  }

  // Leaving "hglobal" (applied at once) releases a rank that was only pending because of it.
  if (key === "education_system" && !review && systemKey(value, hg) !== HGLOBAL) {
    const rank = rows.get("rank");
    if (rank?.pending_value != null) {
      for (const h of await rankHolders(db, memberId)) {
        stmts.push(supersedePending(db, h, "rank", ts));
        stmts.push(upsertRow(db, h, "rank", { value: rank.pending_value, pending_value: null, status: "not_required", value_approved: false }, ts));
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
  const approvedNow = row.value_approved === "keep" ? (current?.value_approved ?? false) : row.value_approved;
  return { ok: true, row: { ...row, value_approved: approvedNow, updated_at: ts } };
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
  const row: RowWrite =
    decision === "approve"
      ? { value: requested, pending_value: null, status: "approved", value_approved: true }
      : { value: current?.value ?? null, pending_value: null, status: "rejected", value_approved: "keep" };
  await db.batch([
    db.prepare("UPDATE amway_review_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'").bind(decision === "approve" ? "approved" : "rejected", ts, staffId, requestId),
    ...holders.map((h) => upsertRow(db, h, req.field_key, row, ts, staffId)),
    // The reviewers' "waiting for review" notices for this request are done.
    db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE kind = 'staff.review.requested' AND json_extract(payload, '$.request_id') = ?").bind(ts, requestId),
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
    ...holders.map((h) => upsertRow(db, h, key, { value, pending_value: null, status: "approved", value_approved: true }, ts, staffId)),
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
  await db.batch([a, b].map((m) => upsertRow(db, m, "rank", { value: winner.value, pending_value: winner.pending_value, status: winner.status, value_approved: winner.value_approved }, ts)));
}

/** Label of the member's reviewed (approved) rank, shown to others; null if none or the Amway area is off. */
export async function approvedRankLabel(db: D1Database, memberId: string): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT o.label FROM amway_field_values v JOIN members m ON m.id = v.member_id
       JOIN amway_options o ON o.field_key = 'rank' AND o.value = json_extract(v.value, '$')
       WHERE v.member_id = ? AND v.field_key = 'rank' AND v.value_approved = 1 AND m.amway_enabled = 1`,
    )
    .bind(memberId)
    .first<{ label: string }>();
  return r?.label ?? null;
}
