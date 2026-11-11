// Member number rules (framework-free). "Member number" and "Amway member number" are the same field;
// only the label differs. Duplicates are allowed on purpose (they reveal spouses), so nothing here or in
// the database enforces uniqueness — except that system-generated random numbers avoid existing ones.

import { COUNTRY_SET } from "./definitions";

export interface MemberNumberEntry {
  country: string;
  number: string;
}

export const MAX_ENTRIES_DEFAULT = 1;
export const MAX_ENTRIES_AMWAY = 50;
export const SELF_CHANGES_PER_DAY = 3;

const NUMBER_RE = /^[A-Z0-9-]{1,20}$/;

export type ListCheck = { ok: true; value: MemberNumberEntry[] } | { ok: false; reason: string; message: string };

/** Validates and normalizes an ordered list of {country, number}. The first entry is the default. */
export function validateMemberNumbers(raw: unknown, maxEntries: number): ListCheck {
  if (!Array.isArray(raw)) return { ok: false, reason: "type", message: "格式不正確" };
  if (raw.length === 0) return { ok: false, reason: "required", message: "至少要有一組編號" };
  if (raw.length > maxEntries) {
    return { ok: false, reason: "too_many", message: maxEntries === 1 ? "只能設定一組編號" : `最多 ${maxEntries} 組` };
  }
  const out: MemberNumberEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, reason: "type", message: "格式不正確" };
    const { country, number } = item as Record<string, unknown>;
    if (typeof country !== "string" || !COUNTRY_SET.has(country.trim().toUpperCase())) {
      return { ok: false, reason: "country", message: "請選擇國家" };
    }
    if (typeof number !== "string") return { ok: false, reason: "type", message: "格式不正確" };
    const n = number.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
    if (!NUMBER_RE.test(n)) return { ok: false, reason: "format", message: "編號只能包含英文字母、數字與連字號，最多 20 字" };
    const entry = { country: country.trim().toUpperCase(), number: n };
    const k = entryKey(entry);
    if (seen.has(k)) return { ok: false, reason: "duplicate_entry", message: "清單中有重複的編號" };
    seen.add(k);
    out.push(entry);
  }
  return { ok: true, value: out };
}

/**
 * The member's public identifier: the ISO country code directly followed by the number, no space (TW9475831).
 * Numbers the system generated already start with the country code (TW0112342) and are not prefixed twice.
 */
export function publicId(e: MemberNumberEntry): string {
  return e.number.startsWith(e.country) ? e.number : `${e.country}${e.number}`;
}

export function entryKey(e: MemberNumberEntry): string {
  return `${e.country}:${e.number}`;
}

export function sameList(a: MemberNumberEntry[], b: MemberNumberEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => entryKey(e) === entryKey(b[i] as MemberNumberEntry));
}

/** Uniform random decimal digit by rejection sampling over crypto-grade random bytes. */
export function randomDigit(randomBytes: (n: number) => Uint8Array): number {
  for (;;) {
    for (const b of randomBytes(16)) if (b < 250) return b % 10;
  }
}

/**
 * Random member number: `<ISO country><0 followed by digits>`, 7 digits to start (e.g. TW0112342).
 * When `attemptsPerLength` draws in a row are taken, the length grows to 8, 9, then 10 digits.
 */
export async function generateMemberNumber(
  country: string,
  isTaken: (number: string) => Promise<boolean>,
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
  attemptsPerLength = 8,
): Promise<MemberNumberEntry> {
  const cc = COUNTRY_SET.has(country) ? country : "TW";
  for (let digits = 7; digits <= 10; digits++) {
    for (let i = 0; i < attemptsPerLength; i++) {
      let n = "0";
      for (let d = 1; d < digits; d++) n += String(randomDigit(randomBytes));
      const number = `${cc}${n}`;
      if (!(await isTaken(number))) return { country: cc, number };
    }
  }
  throw new Error("member number space exhausted");
}

/**
 * Shared list for a newly bound couple: the number that matched first, then the binder's other numbers,
 * then the partner's, without repeats, capped at `max`.
 */
export function mergeForSpouses(
  matched: MemberNumberEntry,
  binder: MemberNumberEntry[],
  partner: MemberNumberEntry[],
  max: number,
): MemberNumberEntry[] {
  const out: MemberNumberEntry[] = [];
  const seen = new Set<string>();
  for (const e of [matched, ...binder, ...partner]) {
    const k = entryKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/** On unbind the member who started the binding always gets a new random number (both cases in the rules). */
export function whoGetsNewNumber(binding: { initiator_id: string; partner_id: string }): string {
  return binding.initiator_id;
}
