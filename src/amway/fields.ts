// Amway area field rules (framework-free). Field keys follow the integration instruction pack, section 4.
// `amway_id` is not here: it was merged into the member number field (section 4B).
// Option lists (education systems, centers, ranks, uplines) live in the database so administrators can
// maintain them; only the structural options `hglobal` and `other` are fixed.

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
  review: "when_hglobal" | "never";
}

export const AMWAY_FIELDS: AmwayFieldDef[] = [
  { key: "education_system", order: 10, label: "教育體系", type: "select_or_custom", max_length: 50, visible_when: null, review: "when_hglobal", help: "找不到時請選「其他」並自行填寫。" },
  { key: "education_center", order: 20, label: "教育中心", type: "select", visible_when: { field: "education_system", equals: HGLOBAL }, review: "never" },
  { key: "rank", order: 30, label: "獎銜", type: "select", visible_when: null, review: "when_hglobal" },
  { key: "referrer", order: 40, label: "推薦人", type: "text", max_length: 50, visible_when: null, review: "never" },
  { key: "upline_crown_ambassador", order: 50, label: "上手皇冠大使", type: "select_or_custom", max_length: 50, visible_when: null, review: "never" },
  { key: "upline_diamond", order: 60, label: "上手鑽石", type: "select_or_custom", max_length: 50, visible_when: null, review: "never" },
  { key: "upline_platinum", order: 70, label: "上手白金", type: "select_or_custom", max_length: 50, visible_when: null, review: "never" },
];

/** The six fields reviewers may adjust directly (treated as approved). */
export const REVIEWER_ADJUSTABLE = ["education_system", "education_center", "rank", "upline_diamond", "upline_platinum", "upline_crown_ambassador"];

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
 * Whether a new value needs review. Education system "hglobal" needs review; rank needs review while the
 * member's education system (effective or pending) is "hglobal". Everything else applies at once.
 */
export function needsReview(def: AmwayFieldDef, value: AmwayValue, educationSystem: { effective: string | null; pending: string | null }): boolean {
  if (def.review === "never" || value === null) return false;
  if (def.key === "education_system") return optionOf(value) === HGLOBAL;
  if (def.key === "rank") return educationSystem.effective === HGLOBAL || educationSystem.pending === HGLOBAL;
  return false;
}

export function sameValue(a: AmwayValue, b: AmwayValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
