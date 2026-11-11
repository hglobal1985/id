// Fields that are always public (framework-free): they show on the public page whenever they are filled, and the
// member cannot hide them (owner decision 2026-11-11). Everything else follows the member's own switch.
import type { Visibility } from "./definitions";

export const FORCED_PUBLIC: ReadonlySet<string> = new Set([
  "display_name",
  "country",
  "derived", // zodiac and the 生命靈數 chart
  "education_system",
  "education_center",
  "rank",
  "referrer",
  "upline_platinum",
  "upline_diamond",
]);

export const isForcedPublic = (key: string): boolean => FORCED_PUBLIC.has(key);

/** The visibility to use: forced fields are public whatever was stored. */
export function visibilityOf(key: string, stored: Visibility | undefined, fallback: Visibility): Visibility {
  return isForcedPublic(key) ? "public" : (stored ?? fallback);
}
