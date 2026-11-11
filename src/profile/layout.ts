// Field order on the member pages (framework-free). The super admin orders the fields of each group; members all
// see that order. Groups: basic (基本資料), contact (聯絡與地區), amway (Amway 欄位). The education lines, the
// birthday and the member number keep their fixed places.
import { fieldDefinitions } from "./definitions";
import { AMWAY_FIELDS } from "../amway/fields";

export const LAYOUT_GROUPS = ["basic", "contact", "amway"] as const;
export type LayoutGroup = (typeof LAYOUT_GROUPS)[number];
export const LAYOUT_GROUP_LABELS: Record<LayoutGroup, string> = { basic: "基本資料", contact: "聯絡與地區", amway: "Amway 專區" };

export interface LayoutItem {
  key: string;
  label: string;
}

/** The built-in order of one group. */
export function defaultLayout(group: LayoutGroup): LayoutItem[] {
  if (group === "amway") return AMWAY_FIELDS.slice().sort((a, b) => a.order - b.order).map((f) => ({ key: f.key, label: f.label }));
  return fieldDefinitions()
    .filter((f) => f.group === group)
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ key: f.key, label: f.label }));
}

export type LayoutCheck = { ok: true; value: Record<LayoutGroup, string[]> } | { ok: false; message: string };

/** Every group must list exactly the group's fields, each once (a permutation of the built-in list). */
export function validateLayout(input: unknown): LayoutCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, message: "格式不正確" };
  const out = {} as Record<LayoutGroup, string[]>;
  for (const g of LAYOUT_GROUPS) {
    const list = (input as Record<string, unknown>)[g];
    const want = defaultLayout(g).map((i) => i.key);
    if (!Array.isArray(list) || list.length !== want.length || !list.every((k) => typeof k === "string") || new Set(list).size !== want.length || !list.every((k) => want.includes(k as string))) {
      return { ok: false, message: `「${LAYOUT_GROUP_LABELS[g]}」的欄位清單不完整或有重複` };
    }
    out[g] = list as string[];
  }
  return { ok: true, value: out };
}

/** `order` of every item replaced by its place in the saved layout (items without a saved place keep theirs). */
export function applyOrder<T extends { key: string; order: number }>(items: readonly T[], layout: ReadonlyMap<string, number>): T[] {
  return items.map((i) => ({ ...i, order: layout.get(i.key) ?? i.order }));
}
