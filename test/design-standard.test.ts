import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SITE_CSS } from "../src/web/assets/css";

const doc = readFileSync(new URL("../docs/design-standard.md", import.meta.url), "utf8").toLowerCase();

describe("docs/design-standard.md matches the member site's stylesheet", () => {
  it("lists every colour of the :root palette", () => {
    const root = /:root\{([^}]*)\}/.exec(SITE_CSS)?.[1] ?? "";
    const hex = [...root.matchAll(/--[a-z-]+:(#[0-9a-f]{6})/gi)].map((m) => (m[1] as string).toLowerCase());
    expect(hex.length).toBeGreaterThanOrEqual(14);
    for (const h of hex) expect(doc, h).toContain(h);
  });

  it("states the sizes and colours the Apps must copy", () => {
    for (const must of ["#bcd8c6", "#e6c48c", "#e8b4af", "#f4f1dc", "#6b5b12", "#ddd4a0", "#2563eb", "#f6f8f4", "#0f172a", "#f5b400", "#8b2fe0", "#3d7a06", "#e5303a", "#7ccf1b", "#c3cbbf"]) expect(doc, must).toContain(must);
    for (const must of ["1.4 rem", "16 px", "44", "3.9 rem", ".78 rem", "288×240", "72×80", "2.5"]) expect(doc, must).toContain(must);
  });
});
