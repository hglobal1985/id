// Suggestion vocabularies: remembering what members type, offering it back, and administrator curation
// (edit, merge, delete). Values members already saved are rewritten when a term is edited or merged.
import { taipeiIso } from "../lib/time";
import { auditStatement } from "./audit";
import { ORDERED_POOLS, POOLS, TERM_MAX_LENGTH, normTerm, rankTerms, type PoolKey } from "../vocab/terms";

export interface TermRow {
  term: string;
  uses: number;
  hglobal: boolean;
}

interface Row {
  term: string;
  norm: string;
  uses: number;
  hglobal: number;
  sort_order?: number;
}

const toRow = (r: Row): TermRow => ({ term: r.term, uses: r.uses, hglobal: r.hglobal === 1 });

export async function listTerms(db: D1Database, pool: PoolKey): Promise<TermRow[]> {
  const ordered = ORDERED_POOLS.includes(pool);
  const r = await db
    .prepare(`SELECT term, norm, uses, hglobal, sort_order FROM vocab_terms WHERE pool = ? ORDER BY ${ordered ? "CASE WHEN sort_order > 0 THEN sort_order ELSE 1000000 END, uses DESC, term" : "uses DESC, term"} LIMIT 2000`)
    .bind(pool)
    .all<Row>();
  return (r.results ?? []).map(toRow);
}

/** Terms matching what was typed (any typed character, any order), best first. */
export async function suggestTerms(db: D1Database, pool: PoolKey, query: string, limit = 8): Promise<string[]> {
  const r = await db.prepare("SELECT term, norm, uses, hglobal, sort_order FROM vocab_terms WHERE pool = ? ORDER BY uses DESC LIMIT 1000").bind(pool).all<Row>();
  return rankTerms(r.results ?? [], query, limit, ORDERED_POOLS.includes(pool)).map((t) => t.term);
}

/** Spellings already in the pool win: "TAIPEI university" is saved as the existing "Taipei University". */
export async function canonicalTerms(db: D1Database, pool: PoolKey, terms: string[]): Promise<string[]> {
  if (!terms.length) return terms;
  const r = await db
    .prepare(`SELECT term, norm FROM vocab_terms WHERE pool = ? AND norm IN (${terms.map(() => "?").join(",")})`)
    .bind(pool, ...terms.map(normTerm))
    .all<{ term: string; norm: string }>();
  const known = new Map((r.results ?? []).map((x) => [x.norm, x.term]));
  return terms.map((t) => known.get(normTerm(t)) ?? t);
}

/** Remembers the terms of a saved value (counts one use each). */
export async function recordTerms(db: D1Database, pool: PoolKey, terms: string[], now: Date): Promise<void> {
  const ts = taipeiIso(now);
  const unique = [...new Map(terms.map((t) => [normTerm(t), t.normalize("NFKC").trim()])).entries()].filter(([n, t]) => n && t.length <= TERM_MAX_LENGTH);
  if (!unique.length) return;
  await db.batch(
    unique.map(([norm, term]) =>
      db
        .prepare(
          `INSERT INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)
           ON CONFLICT (pool, norm) DO UPDATE SET uses = uses + 1, updated_at = excluded.updated_at`,
        )
        .bind(pool, norm, term, ts, ts),
    ),
  );
}

/** Normalized spellings of the education-system terms that mean H-Global1985. */
export async function hglobalNorms(db: D1Database): Promise<Set<string>> {
  const r = await db.prepare("SELECT norm FROM vocab_terms WHERE pool = 'education_system' AND hglobal = 1").all<{ norm: string }>();
  return new Set((r.results ?? []).map((x) => x.norm));
}

// ---------- administrator curation ----------

export interface Actor {
  memberId: string;
  requestId: string;
  now: Date;
}

const audit = (db: D1Database, a: Actor, action: string, pool: string) =>
  auditStatement(db, { actorType: "staff", actorId: a.memberId, action, targetType: "vocab", targetId: pool, result: "success", requestId: a.requestId, detail: { pool } }, a.now);

/** Rewrites every saved value that used one of `fromNorms` so it uses `to` (profile tags and text, Amway text). */
async function rewriteValues(db: D1Database, pool: PoolKey, fromNorms: Set<string>, to: string | null, ts: string): Promise<number> {
  const info = POOLS[pool];
  let changed = 0;
  const map = (v: unknown): { next: unknown; hit: boolean } => {
    if (typeof v === "string") {
      if (!fromNorms.has(normTerm(v))) return { next: v, hit: false };
      return { next: to, hit: true };
    }
    if (Array.isArray(v)) {
      let hit = false;
      const out: string[] = [];
      for (const x of v) {
        if (typeof x === "string" && fromNorms.has(normTerm(x))) {
          hit = true;
          if (to !== null && !out.some((o) => normTerm(o) === normTerm(to))) out.push(to);
        } else if (typeof x === "string") out.push(x);
      }
      return { next: out.length ? out : null, hit };
    }
    return { next: v, hit: false };
  };
  const stmts: D1PreparedStatement[] = [];
  for (const key of info.profileFields) {
    const rows = await db.prepare("SELECT member_id, value FROM profile_field_values WHERE field_key = ?").bind(key).all<{ member_id: string; value: string }>();
    for (const r of rows.results ?? []) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.value);
      } catch {
        continue;
      }
      const { next, hit } = map(parsed);
      if (!hit) continue;
      changed++;
      stmts.push(
        next === null
          ? db.prepare("DELETE FROM profile_field_values WHERE member_id = ? AND field_key = ?").bind(r.member_id, key)
          : db.prepare("UPDATE profile_field_values SET value = ?, updated_at = ? WHERE member_id = ? AND field_key = ?").bind(JSON.stringify(next), ts, r.member_id, key),
      );
    }
  }
  for (const key of info.amwayFields) {
    const rows = await db.prepare("SELECT member_id, value, pending_value FROM amway_field_values WHERE field_key = ?").bind(key).all<{ member_id: string; value: string | null; pending_value: string | null }>();
    for (const r of rows.results ?? []) {
      const one = (s: string | null) => {
        if (s === null) return { s, hit: false };
        try {
          const m = map(JSON.parse(s));
          return { s: m.next === null ? null : JSON.stringify(m.next), hit: m.hit };
        } catch {
          return { s, hit: false };
        }
      };
      const v = one(r.value);
      const p = one(r.pending_value);
      if (!v.hit && !p.hit) continue;
      changed++;
      stmts.push(db.prepare("UPDATE amway_field_values SET value = ?, pending_value = ?, updated_at = ? WHERE member_id = ? AND field_key = ?").bind(v.s, p.s, ts, r.member_id, key));
    }
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
  return changed;
}

export type CurateResult = { ok: true; members: number } | { ok: false; reason: "not_found" | "invalid" };

/** Renames a term, or merges it into an existing term when `to` is already in the pool. Saved values follow. */
export async function renameTerm(db: D1Database, pool: PoolKey, from: string, to: string, a: Actor): Promise<CurateResult> {
  const target = to.normalize("NFKC").trim();
  if (!target || target.length > TERM_MAX_LENGTH) return { ok: false, reason: "invalid" };
  const src = await db.prepare("SELECT term, norm, uses, hglobal FROM vocab_terms WHERE pool = ? AND norm = ?").bind(pool, normTerm(from)).first<Row>();
  if (!src) return { ok: false, reason: "not_found" };
  const ts = taipeiIso(a.now);
  const dest = await db.prepare("SELECT term, norm, uses, hglobal FROM vocab_terms WHERE pool = ? AND norm = ?").bind(pool, normTerm(target)).first<Row>();
  const stmts: D1PreparedStatement[] = [];
  if (dest && dest.norm !== src.norm) {
    stmts.push(
      db.prepare("UPDATE vocab_terms SET uses = uses + ?, hglobal = MAX(hglobal, ?), updated_at = ? WHERE pool = ? AND norm = ?").bind(src.uses, src.hglobal, ts, pool, dest.norm),
      db.prepare("DELETE FROM vocab_terms WHERE pool = ? AND norm = ?").bind(pool, src.norm),
    );
  } else {
    stmts.push(db.prepare("UPDATE vocab_terms SET term = ?, norm = ?, updated_at = ? WHERE pool = ? AND norm = ?").bind(target, normTerm(target), ts, pool, src.norm));
  }
  stmts.push(audit(db, a, dest && dest.norm !== src.norm ? "vocab.merge" : "vocab.rename", pool));
  await db.batch(stmts);
  const members = await rewriteValues(db, pool, new Set([src.norm]), dest && dest.norm !== src.norm ? dest.term : target, ts);
  return { ok: true, members };
}

/** Merges several terms into one (created when it is new). Saved values follow. */
export async function mergeTerms(db: D1Database, pool: PoolKey, froms: string[], into: string, a: Actor): Promise<CurateResult> {
  const target = into.normalize("NFKC").trim();
  if (!target || target.length > TERM_MAX_LENGTH || !froms.length) return { ok: false, reason: "invalid" };
  const norms = [...new Set(froms.map(normTerm))].filter((n) => n !== normTerm(target));
  const ts = taipeiIso(a.now);
  let uses = 0;
  let hg = 0;
  const found: string[] = [];
  for (const n of norms) {
    const r = await db.prepare("SELECT term, norm, uses, hglobal FROM vocab_terms WHERE pool = ? AND norm = ?").bind(pool, n).first<Row>();
    if (!r) continue;
    found.push(r.norm);
    uses += r.uses;
    hg = Math.max(hg, r.hglobal);
  }
  if (!found.length) return { ok: false, reason: "not_found" };
  await db.batch([
    db
      .prepare(
        `INSERT INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (pool, norm) DO UPDATE SET uses = uses + excluded.uses, hglobal = MAX(hglobal, excluded.hglobal), updated_at = excluded.updated_at`,
      )
      .bind(pool, normTerm(target), target, uses, hg, ts, ts),
    ...found.map((n) => db.prepare("DELETE FROM vocab_terms WHERE pool = ? AND norm = ?").bind(pool, n)),
    audit(db, a, "vocab.merge", pool),
  ]);
  const members = await rewriteValues(db, pool, new Set(found), (await db.prepare("SELECT term FROM vocab_terms WHERE pool = ? AND norm = ?").bind(pool, normTerm(target)).first<{ term: string }>())?.term ?? target, ts);
  return { ok: true, members };
}

/**
 * Deletes a term from the suggestions. Values members already saved are left as they are (use merge or edit to
 * change those). The H-Global1985 mark cannot be removed by deleting its last term.
 */
export async function deleteTerm(db: D1Database, pool: PoolKey, term: string, a: Actor): Promise<boolean> {
  const n = normTerm(term);
  const r = await db.prepare("DELETE FROM vocab_terms WHERE pool = ? AND norm = ?").bind(pool, n).run();
  if (!r.meta.changes) return false;
  await audit(db, a, "vocab.delete", pool).run();
  return true;
}

/** Adds a term by hand (zero uses). */
export async function addTerm(db: D1Database, pool: PoolKey, term: string, a: Actor): Promise<boolean> {
  const t = term.normalize("NFKC").trim();
  if (!t || t.length > TERM_MAX_LENGTH) return false;
  const ts = taipeiIso(a.now);
  await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO vocab_terms (pool, norm, term, uses, hglobal, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM vocab_terms WHERE pool = ?), ?, ?)")
      .bind(pool, normTerm(t), t, pool, ts, ts),
    audit(db, a, "vocab.add", pool),
  ]);
  return true;
}

/** Marks (or unmarks) an education-system term as meaning H-Global1985. */
export async function setHglobalTerm(db: D1Database, term: string, flag: boolean, a: Actor): Promise<boolean> {
  const r = await db.prepare("UPDATE vocab_terms SET hglobal = ?, updated_at = ? WHERE pool = 'education_system' AND norm = ?").bind(flag ? 1 : 0, taipeiIso(a.now), normTerm(term)).run();
  if (!r.meta.changes) return false;
  await audit(db, a, flag ? "vocab.hglobal.mark" : "vocab.hglobal.unmark", "education_system").run();
  return true;
}
