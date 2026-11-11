// Public profile (framework-free): which fields a visitor may see. The avatar and member number are always
// public; every other field follows the member's visibility choice or the field's default.
import { fieldDefinitions, type FieldValue, type Visibility } from "./definitions";
import { applyOrder } from "./layout";

export interface PublicItem {
  key: string;
  label: string;
  type: string;
  value: string | string[];
}

export function publicItems(values: Map<string, { value: FieldValue }>, visibility: Map<string, Visibility>, fallbackName: string | null, layout: ReadonlyMap<string, number> = new Map()): PublicItem[] {
  const out: PublicItem[] = [];
  const rank: Record<string, number> = { basic: 0, education: 1, contact: 2, birthday: 3 };
  const defs = applyOrder(fieldDefinitions(), layout).sort((a, b) => (rank[a.group] ?? 9) - (rank[b.group] ?? 9) || a.order - b.order);
  for (const def of defs) {
    if ((visibility.get(def.key) ?? def.visibility.default) !== "public") continue;
    let v = values.get(def.key)?.value ?? null;
    if (def.key === "display_name" && v === null) v = fallbackName;
    if (v === null || (Array.isArray(v) && !v.length)) continue;
    if (def.type === "select") {
      const opt = def.options?.find((o) => o.value === v);
      v = opt?.label ?? (v as string);
    }
    out.push({ key: def.key, label: def.label, type: def.type, value: v });
  }
  return out;
}
