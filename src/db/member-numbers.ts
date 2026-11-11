// Data access for member numbers and duplicate (spouse) candidates.
import { hashSecret, randomToken } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { approvedRankLabel } from "./amway";
import {
  MAX_ENTRIES_AMWAY,
  MAX_ENTRIES_DEFAULT,
  SELF_CHANGES_PER_DAY,
  entryKey,
  generateMemberNumber,
  type MemberNumberEntry,
} from "../profile/member-number";

const CANDIDATE_TTL = 3600;

export async function readNumbers(db: D1Database, memberId: string): Promise<MemberNumberEntry[]> {
  const r = await db
    .prepare("SELECT country, number FROM member_numbers WHERE member_id = ? ORDER BY position")
    .bind(memberId)
    .all<MemberNumberEntry>();
  return (r.results ?? []).map((x) => ({ country: x.country, number: x.number }));
}

export async function maxEntriesFor(db: D1Database, memberIds: string[]): Promise<number> {
  const placeholders = memberIds.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT MAX(amway_enabled) AS a FROM members WHERE id IN (${placeholders})`)
    .bind(...memberIds)
    .first<{ a: number | null }>();
  return r?.a ? MAX_ENTRIES_AMWAY : MAX_ENTRIES_DEFAULT;
}

async function isTaken(db: D1Database, number: string): Promise<boolean> {
  const r = await db.prepare("SELECT 1 AS x FROM member_numbers WHERE number = ? LIMIT 1").bind(number).first<{ x: number }>();
  return !!r;
}

export function replaceNumbersStatements(db: D1Database, memberId: string, list: MemberNumberEntry[], now: Date): D1PreparedStatement[] {
  const ts = taipeiIso(now);
  return [
    db.prepare("DELETE FROM member_numbers WHERE member_id = ?").bind(memberId),
    ...list.map((e, i) =>
      db.prepare("INSERT INTO member_numbers (member_id, position, country, number, updated_at) VALUES (?, ?, ?, ?, ?)").bind(memberId, i, e.country, e.number, ts),
    ),
    db.prepare("UPDATE members SET updated_at = ? WHERE id = ?").bind(ts, memberId),
  ];
}

/** A fresh random number that no member uses yet. */
export async function newRandomNumber(db: D1Database, country: string): Promise<MemberNumberEntry> {
  return generateMemberNumber(country, (n) => isTaken(db, n));
}

/** Gives the member a random number if they have none (new sign-ups, or members created before this rule). */
export async function ensureMemberNumber(db: D1Database, memberId: string, country: string, now: Date, requestId: string): Promise<MemberNumberEntry[]> {
  const current = await readNumbers(db, memberId);
  if (current.length) return current;
  const entry = await newRandomNumber(db, country);
  await db.batch([
    ...replaceNumbersStatements(db, memberId, [entry], now),
    auditStatement(db, { actorType: "system", action: "member_number.assign", targetType: "member", targetId: memberId, result: "success", requestId }, now),
  ]);
  return [entry];
}

/**
 * A new random number for the member (country code + 0 + digits, longer when the space is crowded): used every time
 * 「我是Amway會員」 is turned off, because only Amway members keep a number of their own choosing.
 */
export async function resetRandomNumber(db: D1Database, memberId: string, now: Date, requestId: string): Promise<MemberNumberEntry[]> {
  const current = await readNumbers(db, memberId);
  const member = await db.prepare("SELECT registration_country FROM members WHERE id = ?").bind(memberId).first<{ registration_country: string }>();
  const entry = await newRandomNumber(db, current[0]?.country ?? member?.registration_country ?? "TW");
  await db.batch([
    ...replaceNumbersStatements(db, memberId, [entry], now),
    auditStatement(db, { actorType: "member", actorId: memberId, action: "member_number.reset", targetType: "member", targetId: memberId, result: "success", requestId }, now),
  ]);
  return [entry];
}

/** Number of self-service member number changes in the last 24 hours. */
export async function selfChangesLastDay(db: D1Database, memberId: string, now: Date): Promise<{ count: number; oldest: string | null }> {
  const since = taipeiIso(new Date(now.getTime() - 24 * 3600 * 1000));
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(occurred_at) AS oldest FROM audit_log
       WHERE actor_type = 'member' AND actor_id = ? AND action = 'member_number.update' AND result = 'success' AND occurred_at > ?`,
    )
    .bind(memberId, since)
    .first<{ n: number; oldest: string | null }>();
  return { count: r?.n ?? 0, oldest: r?.oldest ?? null };
}

export function retryAfterSeconds(oldest: string | null, now: Date): number {
  if (!oldest) return 3600;
  const t = Date.parse(oldest) + 24 * 3600 * 1000 - now.getTime();
  return Math.max(60, Math.ceil(t / 1000));
}

export { SELF_CHANGES_PER_DAY };

export interface DuplicateCandidate {
  candidate_id: string;
  display_name: string | null;
  avatar_url: string | null;
  rank: string | null;
  matched: MemberNumberEntry;
}

/**
 * Finds other active members who share any of these numbers (excluding the member's own spouse) and
 * hands out short-lived opaque candidate ids for POST /v1/me/spouse.
 */
export async function findDuplicateCandidates(db: D1Database, memberId: string, list: MemberNumberEntry[], now: Date): Promise<DuplicateCandidate[]> {
  if (!list.length) return [];
  const conds = list.map(() => "(n.country = ? AND n.number = ?)").join(" OR ");
  const rows = await db
    .prepare(
      `SELECT n.member_id, n.country, n.number, m.display_name AS signup_name, m.avatar_url,
              (SELECT value FROM profile_field_values v WHERE v.member_id = n.member_id AND v.field_key = 'display_name') AS dn
       FROM member_numbers n JOIN members m ON m.id = n.member_id
       WHERE (${conds}) AND n.member_id != ? AND m.status = 'active'
         AND n.member_id NOT IN (
           SELECT s2.member_id FROM spouse_members s1 JOIN spouse_members s2 ON s1.binding_id = s2.binding_id WHERE s1.member_id = ?
         )
       ORDER BY n.position
       LIMIT 50`,
    )
    .bind(...list.flatMap((e) => [e.country, e.number]), memberId, memberId)
    .all<{ member_id: string; country: string; number: string; signup_name: string | null; avatar_url: string | null; dn: string | null }>();

  const byMember = new Map<string, (typeof rows.results)[number]>();
  for (const r of rows.results ?? []) if (!byMember.has(r.member_id)) byMember.set(r.member_id, r);
  const out: DuplicateCandidate[] = [];
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM spouse_candidates WHERE member_id = ? OR expires_epoch <= ?").bind(memberId, epochSeconds(now))];
  for (const r of [...byMember.values()].slice(0, 10)) {
    const token = randomToken(24);
    stmts.push(
      db
        .prepare("INSERT INTO spouse_candidates (token_hash, member_id, candidate_member_id, expires_epoch) VALUES (?, ?, ?, ?)")
        .bind(await hashSecret(token), memberId, r.member_id, epochSeconds(now) + CANDIDATE_TTL),
    );
    let name = r.signup_name;
    if (r.dn) {
      try {
        name = JSON.parse(r.dn) as string;
      } catch {
        /* keep sign-up name */
      }
    }
    out.push({ candidate_id: token, display_name: name, avatar_url: r.avatar_url, rank: await approvedRankLabel(db, r.member_id), matched: { country: r.country, number: r.number } });
  }
  await db.batch(stmts);
  return out;
}

/** Resolves a candidate id issued to this member. Returns the other member's id, or null. */
export async function resolveCandidate(db: D1Database, memberId: string, candidateId: string, now: Date): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(candidateId)) return null;
  const r = await db
    .prepare("SELECT candidate_member_id FROM spouse_candidates WHERE token_hash = ? AND member_id = ? AND expires_epoch > ?")
    .bind(await hashSecret(candidateId), memberId, epochSeconds(now))
    .first<{ candidate_member_id: string }>();
  return r?.candidate_member_id ?? null;
}

/** The first number two members share, in the first member's order. */
export function firstShared(a: MemberNumberEntry[], b: MemberNumberEntry[]): MemberNumberEntry | null {
  const keys = new Set(b.map(entryKey));
  return a.find((e) => keys.has(entryKey(e))) ?? null;
}
