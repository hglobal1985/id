// Suggestion vocabularies (framework-free). Free-text fields remember what members typed and offer it back as
// related words; administrators curate each pool. Pools shared by several fields use one vocabulary.

export interface PoolInfo {
  label: string;
  /** Profile field keys feeding this pool. */
  profileFields: readonly string[];
  /** Amway field keys feeding this pool. */
  amwayFields: readonly string[];
}

export const POOLS = {
  occupation: { label: "職業", profileFields: ["occupation"], amwayFields: [] },
  organization: { label: "公司／單位", profileFields: ["organization"], amwayFields: [] },
  job_title: { label: "職稱", profileFields: ["job_title"], amwayFields: [] },
  interests: { label: "興趣與專長", profileFields: ["interests"], amwayFields: [] },
  school: { label: "學校名稱（大學、碩士、博士共用）", profileFields: ["university", "grad_school", "phd_school"], amwayFields: [] },
  dept: { label: "系所名稱（大學、碩士、博士共用）", profileFields: ["university_dept", "grad_dept", "phd_dept"], amwayFields: [] },
  education_system: { label: "直銷商培訓系統", profileFields: [], amwayFields: ["education_system"] },
  education_center: { label: "地區教育中心（直銷商培訓系統為寰宇時的專屬關聯詞）", profileFields: [], amwayFields: ["education_center"] },
  upline_diamond: { label: "上手鑽石", profileFields: [], amwayFields: ["upline_diamond"] },
  upline_platinum: { label: "上手白金", profileFields: [], amwayFields: ["upline_platinum"] },
  upline_crown_ambassador: { label: "皇冠大使", profileFields: [], amwayFields: ["upline_crown_ambassador"] },
} as const satisfies Record<string, PoolInfo>;

export type PoolKey = keyof typeof POOLS;
export const POOL_KEYS = Object.keys(POOLS) as PoolKey[];
export const isPool = (v: unknown): v is PoolKey => typeof v === "string" && (POOL_KEYS as string[]).includes(v);

const FIELD_TO_POOL = new Map<string, PoolKey>();
for (const k of POOL_KEYS) for (const f of [...POOLS[k].profileFields, ...POOLS[k].amwayFields]) FIELD_TO_POOL.set(f, k);

/** The vocabulary a field draws suggestions from, or null (free text without suggestions). */
export function poolOfField(field: string): PoolKey | null {
  return FIELD_TO_POOL.get(field) ?? null;
}

export const TERM_MAX_LENGTH = 100;

/** Spelling used to compare terms: width-folded, trimmed, whitespace-collapsed, lower case. */
export function normTerm(s: string): string {
  return s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Characters that confirm one item in a multi-item field (occupation, company, interests and skills):
 * , ; : - # * / \ ' ， 、 。 and spaces or dots (the Enter key is handled by the page).
 * Used by every client so the pages and Apps behave the same.
 */
export const TOKEN_SEPARATORS = String.raw`[\s,;:\-#*/\\'’，、；：。.．]+`;

export function splitTokens(raw: string): string[] {
  return raw
    .split(new RegExp(TOKEN_SEPARATORS))
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * How well a term matches what was typed: the number of distinct typed characters that appear anywhere in the term
 * (any order, any position). 0 = no match. Typing "大學" finds every term containing 大 or 學, best matches first.
 */
export function matchScore(term: string, query: string): number {
  const t = normTerm(term);
  const seen = new Set<string>();
  let score = 0;
  for (const ch of normTerm(query)) {
    if (ch === " " || seen.has(ch)) continue;
    seen.add(ch);
    if (t.includes(ch)) score++;
  }
  return score;
}

/** Pools whose terms are kept in the administrator's own order (the sort order wins over how often a term was used). */
export const ORDERED_POOLS: readonly string[] = ["education_center"];

export function rankTerms<T extends { term: string; uses: number; sort_order?: number }>(terms: readonly T[], query: string, limit: number, ordered = false): T[] {
  const place = (t: T) => (t.sort_order && t.sort_order > 0 ? t.sort_order : 1e9);
  return terms
    .map((t) => ({ t, s: matchScore(t.term, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (ordered ? place(a.t) - place(b.t) : 0) || b.t.uses - a.t.uses || a.t.term.localeCompare(b.t.term))
    .slice(0, limit)
    .map((x) => x.t);
}
