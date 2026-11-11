// Fields that are always public (framework-free): the display name, the residence country and the 生命靈數 chart show on
// the public page whenever they are filled and cannot be hidden (owner decision 2026-11-11). Everything else follows the
// member's own switch (the Amway fields start public; owner decision 2026-11-11, second round).
import type { Visibility } from "./definitions";

export const FORCED_PUBLIC: ReadonlySet<string> = new Set([
  "display_name",
  "country",
  "derived", // zodiac and the 生命靈數 chart
]);

/** Amway fields start public (the member can hide any of them at will); the crown ambassador starts hidden. */
const AMWAY_DEFAULT_PUBLIC: ReadonlySet<string> = new Set(["education_system", "education_center", "rank", "referrer", "upline_platinum", "upline_diamond"]);
export const amwayDefault = (key: string): Visibility => (AMWAY_DEFAULT_PUBLIC.has(key) ? "public" : "private");

export const isForcedPublic = (key: string): boolean => FORCED_PUBLIC.has(key);

/** The visibility to use: forced fields are public whatever was stored. */
export function visibilityOf(key: string, stored: Visibility | undefined, fallback: Visibility): Visibility {
  return isForcedPublic(key) ? "public" : (stored ?? fallback);
}
