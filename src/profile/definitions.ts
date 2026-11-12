// Profile field definitions and validation (framework-free).
// Field keys and scopes follow the integration instruction pack, section 4A. Apps render the profile page
// entirely from these definitions (group, order, label, help, type, options, visible_when, read_only, info),
// so labels and limits live here, never in the apps.

import { countryRows } from "./countries";
import { isForcedPublic } from "./visibility";

export const DEFINITIONS_VERSION = "2026-11-12.1";

export type FieldType = "text" | "textarea" | "url" | "email" | "phone" | "date" | "select" | "tags";
export type Visibility = "public" | "private";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  key: string;
  group: GroupKey;
  order: number;
  label: string;
  help?: string;
  type: FieldType;
  scope: "profile.basic.write" | "profile.contact.write" | "profile.birthday.write";
  required: boolean;
  read_only: false;
  max_length?: number;
  max_items?: number;
  item_max_length?: number;
  options?: FieldOption[];
  /** Vocabulary the field draws related words from (GET /v1/vocab/suggestions); free typing is always allowed. */
  suggest?: string;
  /** Type-to-search box over a fixed list (`options`): the member types, the list narrows. Never a native <select>. */
  ui?: "autocomplete";
  /** Fields sharing a row on the page (for example 大學: school + department). */
  row?: { key: string; label: string; optional_after?: string };
  visible_when?: null;
  visibility: { configurable: boolean; default: Visibility };
}

export type GroupKey = "basic" | "education" | "contact" | "birthday";

export const GROUPS: { key: GroupKey | "avatar" | "member_number"; label: string; order: number }[] = [
  { key: "avatar", label: "頭像", order: 10 },
  { key: "member_number", label: "會員編號", order: 15 },
  { key: "basic", label: "基本資料", order: 20 },
  { key: "education", label: "學歷", order: 25 },
  { key: "contact", label: "聯絡與地區", order: 30 },
  { key: "birthday", label: "生日", order: 40 },
];

// ISO 3166-1 alpha-2 codes. Display names come from Intl (zh-TW) at runtime.
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );
export const COUNTRY_SET = new Set(COUNTRY_CODES);

let countryOptions: FieldOption[] | null = null;
/** Countries in the picker order of the starry.phd member center (Taiwan, nearby countries, then by calling code). */
export function countryOptionsList(): FieldOption[] {
  if (countryOptions) return countryOptions;
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["zh-TW"], { type: "region" });
  } catch {
    names = null;
  }
  const ordered = countryRows().map((r) => ({ value: r.iso, label: names?.of(r.iso) ?? r.iso }));
  const listed = new Set(ordered.map((o) => o.value));
  // Codes outside the calling-code table (islands, territories) follow in code order.
  countryOptions = [...ordered, ...COUNTRY_CODES.filter((c) => !listed.has(c)).map((c) => ({ value: c, label: names?.of(c) ?? c }))];
  return countryOptions;
}

/** Countries for the member-number picker: label "台灣（TW）+886", same order as the starry.phd member center. */
export function memberNumberCountryOptions(): FieldOption[] {
  const names = new Map(countryOptionsList().map((o) => [o.value, o.label]));
  return countryRows().map((r) => ({ value: r.iso, label: `${names.get(r.iso) ?? r.iso}（${r.iso}）+${r.callingCode}` }));
}

/** Resolves what a member typed (a code, a Chinese or an English name) to an ISO code, or null. */
export function resolveCountry(input: string): string | null {
  const t = input.normalize("NFKC").trim();
  if (!t) return null;
  const upper = t.toUpperCase();
  if (COUNTRY_SET.has(upper)) return upper;
  const lower = t.toLowerCase();
  let en: Intl.DisplayNames | null = null;
  try {
    en = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    en = null;
  }
  for (const o of countryOptionsList()) {
    if (o.label === t || o.label.toLowerCase() === lower || en?.of(o.value)?.toLowerCase() === lower) return o.value;
  }
  return null;
}

const LOCALES: FieldOption[] = [
  { value: "zh-TW", label: "繁體中文" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

type Def = Omit<FieldDefinition, "read_only" | "visible_when" | "visibility" | "required" | "scope"> & {
  required?: boolean;
  visibility?: Visibility;
};

const basic = (d: Def): FieldDefinition => ({
  required: false,
  ...d,
  scope: "profile.basic.write",
  read_only: false,
  visible_when: null,
  // Always-public fields (see visibility.ts) have no switch.
  visibility: isForcedPublic(d.key) ? { configurable: false, default: "public" } : { configurable: true, default: d.visibility ?? "public" },
});
const contact = (d: Def): FieldDefinition => ({
  ...basic(d),
  scope: "profile.contact.write",
  visibility: isForcedPublic(d.key) ? { configurable: false, default: "public" } : { configurable: true, default: d.visibility ?? "private" },
});

const RAW: FieldDefinition[] = [
  basic({ key: "display_name", group: "basic", order: 10, label: "顯示名稱", type: "text", max_length: 50, required: true }),
  // 真實姓名 (restored 2026-11-12, key legal_name; the deleted primary_name stays gone): used only to match payers in paid-course
  // sign-ups and reconciliation. Private by default; an App reads it for the signed-in member only (GET /v1/me/profile).
  basic({ key: "legal_name", group: "basic", order: 20, label: "真實姓名", help: "用於付費課程報名與對帳，預設不公開。", type: "text", max_length: 50, visibility: "private" }),
  basic({ key: "motto", group: "basic", order: 30, label: "座右銘", type: "text", max_length: 100 }),
  basic({ key: "bio", group: "basic", order: 40, label: "自我介紹", type: "textarea", max_length: 1000 }),
  basic({ key: "occupation", group: "basic", order: 50, label: "職業", help: "可填多個；輸入後按 Enter 或逗號、頓號、空格等符號確認一項。", type: "tags", max_items: 10, item_max_length: 50, suggest: "occupation" }),
  basic({ key: "organization", group: "basic", order: 60, label: "公司／單位", help: "可填多個；輸入後按 Enter 或逗號、頓號、空格等符號確認一項。", type: "tags", max_items: 10, item_max_length: 80, suggest: "organization" }),
  basic({ key: "languages", group: "basic", order: 80, label: "使用語言", type: "tags", max_items: 20, item_max_length: 30 }),
  basic({ key: "interests", group: "basic", order: 90, label: "興趣與專長", help: "可填多個；輸入後按 Enter 或逗號、頓號、空格等符號確認一項。", type: "tags", max_items: 30, item_max_length: 30, suggest: "interests" }),
  basic({ key: "university", group: "education", order: 10, label: "大學校名", type: "text", max_length: 100, suggest: "school", row: { key: "university", label: "大學" } }),
  basic({ key: "university_dept", group: "education", order: 20, label: "大學系名", type: "text", max_length: 100, suggest: "dept", row: { key: "university", label: "大學" } }),
  basic({ key: "grad_school", group: "education", order: 30, label: "碩士校名", type: "text", max_length: 100, suggest: "school", row: { key: "master", label: "碩士", optional_after: "university" } }),
  basic({ key: "grad_dept", group: "education", order: 40, label: "碩士系名", type: "text", max_length: 100, suggest: "dept", row: { key: "master", label: "碩士", optional_after: "university" } }),
  basic({ key: "phd_school", group: "education", order: 50, label: "博士校名", type: "text", max_length: 100, suggest: "school", row: { key: "doctor", label: "博士", optional_after: "master" } }),
  basic({ key: "phd_dept", group: "education", order: 60, label: "博士系名", type: "text", max_length: 100, suggest: "dept", row: { key: "doctor", label: "博士", optional_after: "master" } }),
  basic({ key: "locale", group: "basic", order: 160, label: "介面語言", type: "select", options: LOCALES, visibility: "private" }),
  contact({ key: "contact_email", group: "contact", order: 10, label: "聯絡信箱", help: "修改後立即生效，不影響登入。", type: "email", max_length: 254 }),
  contact({ key: "phone", group: "contact", order: 20, label: "手機", help: "可加國碼，例如 +886912345678。", type: "phone", max_length: 20 }),
  contact({ key: "country", group: "contact", order: 30, label: "居住國家／地區", help: "輸入國名或代碼，從建議中選擇。", type: "select", ui: "autocomplete" }),
  contact({ key: "region", group: "contact", order: 40, label: "縣市／州", type: "text", max_length: 50 }),
  contact({ key: "city", group: "contact", order: 50, label: "鄉鎮市區", type: "text", max_length: 50 }),
  {
    ...basic({ key: "birthday", group: "birthday", order: 10, label: "生日", type: "date", visibility: "private" }),
    scope: "profile.birthday.write",
  },
];

export const FIELD_KEYS = RAW.map((f) => f.key);
const BY_KEY = new Map(RAW.map((f) => [f.key, f]));

export function getFieldDefinition(key: string): FieldDefinition | undefined {
  return BY_KEY.get(key);
}

export function fieldDefinitions(): FieldDefinition[] {
  return RAW.map((f) => (f.key === "country" ? { ...f, options: countryOptionsList() } : f));
}

/** Read-only information blocks shown on the profile page (derived from the birthday; not editable). */
export const INFO_BLOCKS = [
  { key: "zodiac", group: "birthday", order: 20, label: "星座", type: "text", collapsed: false },
  { key: "life_path_number", group: "birthday", order: 30, label: "生命靈數", type: "text", collapsed: false },
  { key: "talent_number", group: "birthday", order: 40, label: "天賦數字", type: "text", collapsed: false },
] as const;

/**
 * Member number (= Amway member number): an ordered list of {country, number}; the first entry is the default
 * (public profile URL and support id). Label and maximum depend on the "我是Amway會員" switch.
 * Always public (it is the public URL), so its visibility cannot be changed.
 */
export const MEMBER_NUMBER_DEFINITION = {
  key: "member_number",
  group: "member_number",
  order: 5,
  label: "會員編號",
  label_when_amway: "Amway會員編號",
  help: "第一組為預設編號，用於公開基本資料網址與客服查詢。修改編號後，舊網址會失效。",
  help_when_amway: "建議修改會員編號",
  help_when_not_amway: "隨機產生，不可修改",
  type: "member_numbers",
  scope: "profile.basic.write",
  required: true,
  read_only: false,
  max_items: 1,
  max_items_when_amway: 50,
  item_max_length: 20,
  visible_when: null,
  visibility: { configurable: false, default: "public" as const },
  limits: { self_changes_per_day: 3 },
};

export const AVATAR_DEFINITION = {
  group: "avatar",
  order: 10,
  label: "頭像",
  always_public: true,
  upload: { square: true, max_edge_px: 512, max_bytes: 2 * 1024 * 1024, mime_types: ["image/jpeg", "image/png", "image/webp"] },
  actions: ["upload", "use_google", "remove"],
} as const;

// ---------- validation ----------

export type FieldValue = string | string[] | null;
export type Validation = { ok: true; value: FieldValue } | { ok: false; reason: string; message: string };

const fail = (reason: string, message: string): Validation => ({ ok: false, reason, message });

// Control characters (except tab/newline in textarea) are never accepted.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/;
const EMAIL = /^[^\s@"<>()[\]\\,;:]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE = /^\+?[0-9](?:[0-9 ()-]{4,18}[0-9])$/;

function chars(s: string): number {
  return [...s].length;
}

export function isValidIsoDate(s: string, today: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  // "Today" in Taipei.
  const t = new Date(today.getTime() + 8 * 3600 * 1000);
  const todayUtc = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  return y >= 1900 && dt.getTime() <= todayUtc;
}

/** Validates and normalizes a value for a field. `null` (or an empty string / empty list) clears the field. */
export function validateFieldValue(def: FieldDefinition, raw: unknown, today: Date): Validation {
  if (raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
    return def.required ? fail("required", "此欄位不可空白") : { ok: true, value: null };
  }
  if (def.type === "tags") {
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return fail("type", "格式不正確");
    const items = [...new Set(raw.map((x: string) => x.normalize("NFC").trim()).filter(Boolean))];
    if (items.length > (def.max_items ?? 20)) return fail("too_many", `最多 ${def.max_items} 項`);
    for (const it of items) {
      if (CONTROL.test(it) || /[\n\t]/.test(it)) return fail("invalid_characters", "含有不允許的字元");
      if (chars(it) > (def.item_max_length ?? 30)) return fail("too_long", `每項最多 ${def.item_max_length} 字`);
    }
    return { ok: true, value: items.length ? items : null };
  }
  if (typeof raw !== "string") return fail("type", "格式不正確");
  let v = raw.normalize("NFC").trim();
  if (!v) return def.required ? fail("required", "此欄位不可空白") : { ok: true, value: null };
  const allowNewlines = def.type === "textarea";
  if (CONTROL.test(v) || (!allowNewlines && /[\n\r\t]/.test(v))) return fail("invalid_characters", "含有不允許的字元");
  if (allowNewlines) v = v.replace(/\r\n?/g, "\n");
  if (def.max_length !== undefined && chars(v) > def.max_length) return fail("too_long", `最多 ${def.max_length} 字`);

  switch (def.type) {
    case "email":
      if (!EMAIL.test(v)) return fail("format", "信箱格式不正確");
      return { ok: true, value: v };
    case "phone":
      if (!PHONE.test(v)) return fail("format", "手機格式不正確");
      return { ok: true, value: v };
    case "url": {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        return fail("format", "網址格式不正確");
      }
      if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return fail("format", "請輸入 https:// 開頭的網址");
      return { ok: true, value: u.toString() };
    }
    case "date":
      if (!isValidIsoDate(v, today)) return fail("format", "日期格式不正確");
      return { ok: true, value: v };
    case "select": {
      if (def.key === "country") {
        const code = resolveCountry(v);
        return code ? { ok: true, value: code } : fail("not_an_option", "找不到這個國家／地區，請從建議中選擇");
      }
      if (!(def.options ?? []).some((o) => o.value === v)) return fail("not_an_option", "請從選項中選擇");
      return { ok: true, value: v };
    }
    default:
      return { ok: true, value: v };
  }
}
