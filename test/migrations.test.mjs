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

  it("seed the owner's corrected rank ladder (low to high) and no member data", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files) db.exec(readFileSync(join(dir, f), "utf8"));
    const ranks = db.prepare("SELECT label FROM amway_options WHERE field_key = 'rank' AND active = 1 ORDER BY sort_order").all();
    expect(ranks.map((r) => r.label)).toEqual([
      "無", "3%", "6%", "9%", "12%", "12%初階", "15%", "15%銅章", "18%", "21%", "銀章", "金章", "白金", "紅寶石",
      "創辦人白金", "創辦人紅寶石", "藍寶石", "創辦人藍寶石", "明珠", "翡翠", "創辦人翡翠", "鑽石", "創辦人鑽石", "執行專才鑽石", "創辦人執行專才鑽石",
      "雙鑽石", "創辦人雙鑽石", "參鑽石", "創辦人參鑽石", "皇冠", "創辦人皇冠", "皇冠大使", "創辦人皇冠大使",
    ]);
    // 「鑽石級以上」 was withdrawn in 0010.
    expect(db.prepare("SELECT COUNT(*) AS n FROM amway_options WHERE field_key = 'rank' AND value = 'diamond_plus'").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM members").get().n).toBe(0);
    db.close();
  });

  it("0013 converts existing data: legal name deleted, interests+skills merged, text lists, free-text Amway fields", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 13)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-10T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('m1','g1','active','${ts}','${ts}'), ('m2','g2','active','${ts}','${ts}')`);
    const pv = db.prepare("INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES (?, ?, ?, ?)");
    pv.run("m1", "primary_name", JSON.stringify("王小明"), ts);
    pv.run("m1", "interests", JSON.stringify(["閱讀", "旅行"]), ts);
    pv.run("m1", "skills", JSON.stringify(["旅行", "攝影"]), ts);
    pv.run("m2", "skills", JSON.stringify(["程式"]), ts);
    pv.run("m1", "occupation", JSON.stringify("工程師"), ts);
    pv.run("m1", "organization", JSON.stringify("某公司"), ts);
    db.prepare("INSERT INTO profile_visibility (member_id, field_key, visibility, updated_at) VALUES ('m1','skills','public',?)").run(ts);
    const av = db.prepare("INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, updated_at) VALUES (?, ?, ?, ?, 'not_required', ?)");
    av.run("m1", "education_system", JSON.stringify({ option: "hglobal", custom_text: null }), null, ts);
    av.run("m2", "education_system", null, JSON.stringify({ option: "other", custom_text: "某體系" }), ts);
    av.run("m1", "upline_diamond", JSON.stringify({ option: "other", custom_text: "陳大華" }), null, ts);
    av.run("m2", "upline_diamond", JSON.stringify({ option: "other", custom_text: "陳大華" }), null, ts);
    av.run("m1", "rank", JSON.stringify("12"), null, ts);
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0013"))), "utf8"));

    const val = (m, k) => { const r = db.prepare("SELECT value FROM profile_field_values WHERE member_id = ? AND field_key = ?").get(m, k); return r ? JSON.parse(r.value) : null; };
    expect(val("m1", "primary_name")).toBeNull();
    expect(val("m1", "skills")).toBeNull();
    expect(val("m1", "interests").sort()).toEqual(["攝影", "旅行", "閱讀"]);
    expect(val("m2", "interests")).toEqual(["程式"]);
    expect(val("m1", "occupation")).toEqual(["工程師"]);
    expect(val("m1", "organization")).toEqual(["某公司"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM profile_visibility WHERE field_key = 'skills'").get().n).toBe(0);
    const am = (m, k) => db.prepare("SELECT value, pending_value FROM amway_field_values WHERE member_id = ? AND field_key = ?").get(m, k);
    expect(JSON.parse(am("m1", "education_system").value)).toBe("H-Global1985");
    expect(JSON.parse(am("m2", "education_system").pending_value)).toBe("某體系");
    expect(JSON.parse(am("m1", "upline_diamond").value)).toBe("陳大華");
    expect(JSON.parse(am("m1", "rank").value)).toBe("12");
    const terms = db.prepare("SELECT pool, term, uses, hglobal FROM vocab_terms ORDER BY pool, term").all();
    expect(terms).toEqual(expect.arrayContaining([
      { pool: "education_system", term: "H-Global1985", uses: 0, hglobal: 1 },
      { pool: "upline_diamond", term: "陳大華", uses: 2, hglobal: 0 },
    ]));
    db.close();
  });
});
