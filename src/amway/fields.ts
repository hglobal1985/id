// Amway area field rules (framework-free). Field keys follow the integration instruction pack, section 4.
// `amway_id` is not here: it was merged into the member number field (section 4B).
// The rank ladder lives in the database (a fixed 33-step ladder). The training system, the regional education center
// and the upline fields are free text with suggestion vocabularies (src/vocab); the education-system terms marked
// H-Global1985 by the administrator unlock eligibility (choosing 寰宇 alone passes at once); a member who is 寰宇 and also
// fills in a regional center has the center and the rank reviewed, and only for those members does the center field offer
// its own vocabulary.

import { normTerm } from "../vocab/terms";

export const HGLOBAL = "hglobal";
export const OTHER = "other";

export type AmwayFieldType = "select" | "select_or_custom" | "text";
export type ReviewStatus = "pending" | "approved" | "rejected" | "not_required";

export interface AmwayFieldDef {
  key: string;
  order: number;
  label: string;
  help?: string;
  type: AmwayFieldType;
  max_length?: number;
  /** "hglobal_only": shown only when education_system is hglobal. */
  visible_when: { field: "education_system"; equals: typeof HGLOBAL } | null;
  /** How review is decided; the central system decides, apps only show `status`. */
  review: "when_hglobal_center" | "never";
  /** Vocabulary of related words offered while typing (free typing is always allowed). */
  suggest?: string;
  /** The suggestions apply only while the member's training system means H-Global1985 (otherwise plain free text). */
  suggest_when_hglobal?: boolean;
}

export const AMWAY_FIELDS: AmwayFieldDef[] = [
  { key: "education_system", order: 10, label: "直銷商培訓系統", type: "text", max_length: 50, visible_when: null, review: "never", suggest: "education_system" },
  { key: "education_center", order: 20, label: "地區教育中心", type: "text", max_length: 50, visible_when: null, review: "when_hglobal_center", suggest: "education_center", suggest_when_hglobal: true },
  { key: "rank", order: 30, label: "獎銜", type: "select", visible_when: null, review: "when_hglobal_center" },
  { key: "referrer", order: 40, label: "推薦人", type: "text", max_length: 50, visible_when: null, review: "never" },
  { key: "upline_crown_ambassador", order: 50, label: "皇冠大使", type: "text", max_length: 50, visible_when: null, review: "never", suggest: "upline_crown_ambassador" },
  { key: "upline_diamond", order: 60, label: "上手鑽石", type: "text", max_length: 50, visible_when: null, review: "never", suggest: "upline_diamond" },
  { key: "upline_platinum", order: 70, label: "上手白金", type: "text", max_length: 50, visible_when: null, review: "never", suggest: "upline_platinum" },
];

/** The fields the head office may change for a member directly (treated as approved): 系統, 中心, 獎銜. */
export const REVIEWER_ADJUSTABLE = ["education_system", "education_center", "rank"];

export const AMWAY_KEYS = AMWAY_FIELDS.map((f) => f.key);
const BY_KEY = new Map(AMWAY_FIELDS.map((f) => [f.key, f]));
export function getAmwayField(key: string): AmwayFieldDef | undefined {
  return BY_KEY.get(key);
}

export interface Option {
  value: string;
  label: string;
}

export type AmwayValue = string | { option: string; custom_text: string | null } | null;
export type Check = { ok: true; value: AmwayValue } | { ok: false; reason: string; message: string };

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001F\u007F\u2028\u2029]/;

function cleanText(raw: string, max: number): { ok: true; text: string } | { ok: false; reason: string; message: string } {
  const t = raw.normalize("NFC").trim();
  if (CONTROL.test(t)) return { ok: false, reason: "invalid_characters", message: "含有不允許的字元" };
  if ([...t].length > max) return { ok: false, reason: "too_long", message: `最多 ${max} 字` };
  return { ok: true, text: t };
}

/** Validates a value against the field type and its current option list. `null` clears the field. */
export function validateAmwayValue(def: AmwayFieldDef, raw: unknown, options: Option[]): Check {
  if (raw === null || raw === "") return { ok: true, value: null };
  const has = (v: string) => options.some((o) => o.value === v);
  switch (def.type) {
    case "text": {
      if (typeof raw !== "string") return { ok: false, reason: "type", message: "格式不正確" };
      const t = cleanText(raw, def.max_length ?? 50);
      if (!t.ok) return t;
      return { ok: true, value: t.text || null };
    }
    case "select": {
      if (typeof raw !== "string") return { ok: false, reason: "type", message: "格式不正確" };
      if (!has(raw)) return { ok: false, reason: "not_an_option", message: "請從選項中選擇" };
      return { ok: true, value: raw };
    }
    case "select_or_custom": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "type", message: "格式不正確" };
      const { option, custom_text } = raw as Record<string, unknown>;
      if (typeof option !== "string") return { ok: false, reason: "type", message: "格式不正確" };
      if (option === OTHER) {
        if (typeof custom_text !== "string") return { ok: false, reason: "custom_text_required", message: "請填寫內容" };
        const t = cleanText(custom_text, def.max_length ?? 50);
        if (!t.ok) return t;
        if (!t.text) return { ok: false, reason: "custom_text_required", message: "請填寫內容" };
        return { ok: true, value: { option: OTHER, custom_text: t.text } };
      }
      if (!has(option)) return { ok: false, reason: "not_an_option", message: "請從選項中選擇" };
      return { ok: true, value: { option, custom_text: null } };
    }
  }
}

export function optionOf(v: AmwayValue): string | null {
  if (v === null) return null;
  return typeof v === "string" ? v : v.option;
}

/**
 * Which training system a value means: "hglobal" when its text is one of the terms the administrator marked as
 * H-Global1985, otherwise the text itself (or null). `hglobalNorms` holds the normalized spellings of those terms.
 */
export function systemKey(v: AmwayValue, hglobalNorms: ReadonlySet<string>): string | null {
  const text = optionOf(v);
  if (text === null) return null;
  return hglobalNorms.has(normTerm(text)) ? HGLOBAL : text;
}

/** What the review rule needs to know about the member: the training system (effective / pending) and whether a regional center is filled in. */
export interface ReviewContext {
  system: { effective: string | null; pending: string | null };
  /** A regional center is saved or waiting for review (the value being written counts). */
  hasCenter: boolean;
}

/**
 * Whether a new value needs review. The training system itself never does: choosing 寰宇 alone passes at once. Only a member
 * who is 寰宇 AND names a regional center is reviewed: the center (by a reviewer of that same center) and the rank.
 * Everything else applies at once.
 */
export function needsReview(def: AmwayFieldDef, value: AmwayValue, ctx: ReviewContext): boolean {
  if (def.review === "never" || value === null) return false;
  const isHglobal = ctx.system.effective === HGLOBAL || ctx.system.pending === HGLOBAL;
  if (def.key === "education_center") return isHglobal;
  if (def.key === "rank") return isHglobal && ctx.hasCenter;
  return false;
}

export function sameValue(a: AmwayValue, b: AmwayValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
