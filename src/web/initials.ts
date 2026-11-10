// Two letters for a member without a photo (framework-free).
/**
 * "John Smith" → "JS"; "王小明" → "王小" (family name, then the first character of the given name); one character
 * stays. Nothing usable gives "H" (H-Global1985).
 */
export function initialsOf(name: string | null | undefined): string {
  const text = (name ?? "").trim();
  if (!text) return "H";
  const parts = text.split(/\s+/).filter(Boolean);
  const chars = (s: string) => Array.from(s);
  if (parts.length >= 2) return (chars(parts[0] as string).slice(0, 1).join("") + chars(parts[parts.length - 1] as string).slice(0, 1).join("")).toUpperCase();
  const all = chars(parts[0] as string);
  return (all.length >= 2 ? (all[0] as string) + (all[1] as string) : (all[0] as string)).toUpperCase();
}

/** Stable colour class (c0–c7) for an App's letter icon, from its app_id. */
export function tileClass(appId: string): string {
  let h = 0;
  for (const ch of appId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `c${h % 8}`;
}
