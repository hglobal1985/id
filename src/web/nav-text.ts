// Text shaping for the main menu (framework-free): the member's name is cut to 4 Chinese-character widths with an
// ellipsis, and the rank shown beside it fits a fixed 5-character box by shrinking its font.

/** Width of one character in Chinese-character units: CJK and full-width forms count 1, Latin letters, digits and % less. */
export function charUnits(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if ((cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0x20000 && cp <= 0x2fa1f)) return 1;
  if (cp > 0x2000) return 1; // symbols and emoji are wide too
  return 0.55;
}

export function textUnits(text: string): number {
  let n = 0;
  for (const ch of text) n += charUnits(ch);
  return n;
}

/** At most `max` Chinese-character widths; longer names end with "…". */
export function clipName(name: string, max = 4): string {
  let used = 0;
  let out = "";
  for (const ch of name.trim()) {
    const w = charUnits(ch);
    if (used + w > max + 1e-9) return `${out}…`;
    out += ch;
    used += w;
  }
  return out;
}

export interface RankBadge {
  text: string;
  /** 0 = fits at the normal size; 1–3 = progressively smaller font so the text fits the fixed 5-character box. */
  size: 0 | 1 | 2 | 3;
}

/** Text for a fixed 5-character box: the font size step that makes it fit. */
export function fitBadge(text: string): RankBadge {
  const units = textUnits(text);
  return { text, size: units <= 5 ? 0 : units <= 6 ? 1 : units <= 7.5 ? 2 : 3 };
}

/** The rank for the main menu: 「創辦人」 becomes the letter F; null when there is nothing to show. */
export function rankBadge(label: string | null | undefined): RankBadge | null {
  const text = (label ?? "").trim().replaceAll("創辦人", "F");
  if (!text || text === "無") return null;
  return fitBadge(text);
}

/** Font step for the name at the top of a page: it always stays on one line, so a long name shrinks (0 = normal). */
export function nameSize(name: string): 0 | 1 | 2 | 3 {
  const units = textUnits(name.trim());
  return units <= 6 ? 0 : units <= 8 ? 1 : units <= 10 ? 2 : 3;
}
