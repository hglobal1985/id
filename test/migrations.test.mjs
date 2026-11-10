import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// vite strips the "node:" prefix, so load the experimental sqlite module via require.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
// Every new table must be added to test/tables.json (same rule as the Starry system).
const expectedTables = JSON.parse(readFileSync(new URL("./tables.json", import.meta.url), "utf8"));

describe("D1 migrations", () => {
  it("are numbered 0001.. without gaps or duplicates", () => {
    files.forEach((name, i) => {
      expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
      expect(Number(name.slice(0, 4))).toBe(i + 1);
    });
  });

  it("apply in order on an empty database and create exactly the registered tables", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files) db.exec(readFileSync(join(dir, f), "utf8"));
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all();
    expect(rows.map((r) => r.name)).toEqual([...expectedTables].sort());
    db.close();
  });

  it("seed the owner's rank ladder (low to high) and no member data", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files) db.exec(readFileSync(join(dir, f), "utf8"));
    const ranks = db.prepare("SELECT label FROM amway_options WHERE field_key = 'rank' AND active = 1 ORDER BY sort_order").all();
    expect(ranks.map((r) => r.label)).toEqual([
      "3%", "9%", "12%初階", "12%", "15%", "15%銅章", "18%", "21%", "銀章", "金章",
      "白金", "創辦人白金", "紅寶石", "創辦人紅寶石", "藍寶石", "創辦人藍寶石", "翡翠", "鑽石級以上",
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM members").get().n).toBe(0);
    db.close();
  });
});
