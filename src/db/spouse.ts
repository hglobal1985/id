// Spouse binding: single-sided consent, takes effect at once, at most one spouse, either side may unbind.
import { uuidv7 } from "../lib/crypto";
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { newRandomNumber, readNumbers, replaceNumbersStatements } from "./member-numbers";
import { whoGetsNewNumber, type MemberNumberEntry } from "../profile/member-number";

export interface BindingRow {
  id: string;
  initiator_id: string;
  partner_id: string;
  created_at: string;
}

export async function getActiveBinding(db: D1Database, memberId: string): Promise<BindingRow | null> {
  return db
    .prepare(
      `SELECT b.id, b.initiator_id, b.partner_id, b.created_at FROM spouse_members s JOIN spouse_bindings b ON b.id = s.binding_id
       WHERE s.member_id = ? AND b.ended_at IS NULL`,
    )
    .bind(memberId)
    .first<BindingRow>();
}

export function otherSide(b: BindingRow, memberId: string): string {
  return b.initiator_id === memberId ? b.partner_id : b.initiator_id;
}

export class SpouseAlreadyBound extends Error {}

function notificationStatement(db: D1Database, memberId: string, kind: string, payload: Record<string, string>, now: Date): D1PreparedStatement {
  return db
    .prepare("INSERT INTO notifications (id, member_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(uuidv7(now.getTime()), memberId, kind, JSON.stringify(payload), taipeiIso(now));
}

/** Binds two members and gives both the shared number list. Throws SpouseAlreadyBound if either is bound. */
export async function bindSpouses(
  db: D1Database,
  p: { initiatorId: string; partnerId: string; shared: MemberNumberEntry[]; appId: string | null; requestId: string; now: Date },
): Promise<BindingRow> {
  const id = uuidv7(p.now.getTime());
  const ts = taipeiIso(p.now);
  try {
    await db.batch([
      db.prepare("INSERT INTO spouse_bindings (id, initiator_id, partner_id, created_at) VALUES (?, ?, ?, ?)").bind(id, p.initiatorId, p.partnerId, ts),
      // Primary keys make this fail (and roll back the whole batch) if either member is already bound.
      db.prepare("INSERT INTO spouse_members (member_id, binding_id) VALUES (?, ?)").bind(p.initiatorId, id),
      db.prepare("INSERT INTO spouse_members (member_id, binding_id) VALUES (?, ?)").bind(p.partnerId, id),
      ...replaceNumbersStatements(db, p.initiatorId, p.shared, p.now),
      ...replaceNumbersStatements(db, p.partnerId, p.shared, p.now),
      db.prepare("DELETE FROM spouse_candidates WHERE member_id IN (?, ?)").bind(p.initiatorId, p.partnerId),
      notificationStatement(db, p.partnerId, "spouse.bound", { binding_id: id }, p.now),
      auditStatement(db, { actorType: "member", actorId: p.initiatorId, action: "spouse.bind", targetType: "member", targetId: p.partnerId, result: "success", appId: p.appId, requestId: p.requestId, detail: { binding_id: id } }, p.now),
    ]);
  } catch (e) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String((e as Error).message))) throw new SpouseAlreadyBound();
    throw e;
  }
  return { id, initiator_id: p.initiatorId, partner_id: p.partnerId, created_at: ts };
}

/**
 * Ends the binding. Rank stays as it is. The member who started the binding gets a new random number
 * (whether they or their spouse ended it); the other keeps the shared list.
 */
export async function unbindSpouse(
  db: D1Database,
  p: { memberId: string; binding: BindingRow; fallbackCountry: string; appId: string | null; requestId: string; now: Date },
): Promise<{ renumbered: string; number: MemberNumberEntry }> {
  const renumbered = whoGetsNewNumber(p.binding);
  const current = await readNumbers(db, renumbered);
  const entry = await newRandomNumber(db, current[0]?.country ?? p.fallbackCountry);
  const ts = taipeiIso(p.now);
  const other = otherSide(p.binding, p.memberId);
  await db.batch([
    db.prepare("UPDATE spouse_bindings SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL").bind(ts, p.memberId, p.binding.id),
    db.prepare("DELETE FROM spouse_members WHERE binding_id = ?").bind(p.binding.id),
    ...replaceNumbersStatements(db, renumbered, [entry], p.now),
    notificationStatement(db, other, "spouse.unbound", { binding_id: p.binding.id }, p.now),
    auditStatement(db, { actorType: "member", actorId: p.memberId, action: "spouse.unbind", targetType: "member", targetId: other, result: "success", appId: p.appId, requestId: p.requestId, detail: { binding_id: p.binding.id } }, p.now),
    auditStatement(db, { actorType: "system", action: "member_number.assign", targetType: "member", targetId: renumbered, result: "success", requestId: p.requestId, detail: { reason: "spouse_unbind" } }, p.now),
  ]);
  return { renumbered, number: entry };
}
