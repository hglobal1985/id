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

  it("0015 turns education-center codes into text and seeds the center vocabulary in the owner's order", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 15)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-11T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('m1','g1','active','${ts}','${ts}')`);
    db.exec(`INSERT INTO amway_options (field_key, value, label, sort_order) VALUES ('education_center', 'c_tp', '台北中心', 10)`);
    db.prepare("INSERT INTO amway_field_values (member_id, field_key, value, status, updated_at) VALUES ('m1', 'education_center', ?, 'not_required', ?)").run(JSON.stringify("c_tp"), ts);
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0015"))), "utf8"));
    expect(JSON.parse(db.prepare("SELECT value FROM amway_field_values WHERE member_id = 'm1' AND field_key = 'education_center'").get().value)).toBe("台北中心");
    const centers = db.prepare("SELECT term FROM vocab_terms WHERE pool = 'education_center' ORDER BY sort_order").all().map((r) => r.term);
    expect(centers.slice(0, 5)).toEqual(["無", "飛登", "南京", "自強", "明星"]);
    expect(centers.slice(0, 29).at(-1)).toBe("越南");
    expect(centers).toContain("台北中心"); // options the administrator had defined are kept as terms
    expect(db.prepare("SELECT hglobal FROM vocab_terms WHERE pool = 'education_system' AND term = '寰宇'").get()).toEqual({ hglobal: 1 });
    db.close();
  });

  it("0016 marks an already typed 寰宇 as meaning H-Global1985", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 15)) db.exec(readFileSync(join(dir, f), "utf8"));
    db.exec("INSERT INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at) VALUES ('education_system', '寰宇', '寰宇', 3, 0, 'x', 'x')");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) >= 15)) db.exec(readFileSync(join(dir, f), "utf8"));
    expect(db.prepare("SELECT hglobal, uses FROM vocab_terms WHERE pool = 'education_system' AND norm = '寰宇'").get()).toEqual({ hglobal: 1, uses: 3 });
    db.close();
  });

  it("0017 deletes nicknames, flags members who changed their number, and replaces the center list", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 17)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-11T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('m1','g1','active','${ts}','${ts}'), ('m2','g2','active','${ts}','${ts}')`);
    db.exec(`INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES ('m1','nickname','"阿明"','${ts}'), ('m1','bio','"hi"','${ts}')`);
    db.exec(`INSERT INTO member_numbers (member_id, position, country, number, updated_at) VALUES ('m1', 0, 'TW', '9475831', '${ts}'), ('m2', 0, 'TW', 'TW0112342', '${ts}')`);
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0017"))), "utf8"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM profile_field_values WHERE field_key = 'nickname'").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM profile_field_values WHERE field_key = 'bio'").get().n).toBe(1);
    expect(db.prepare("SELECT id, number_customized AS c FROM members ORDER BY id").all()).toEqual([{ id: "m1", c: 1 }, { id: "m2", c: 0 }]);
    const centers = db.prepare("SELECT term FROM vocab_terms WHERE pool = 'education_center' ORDER BY sort_order").all().map((r) => r.term);
    expect(centers).toHaveLength(16);
    expect(centers.slice(0, 3)).toEqual(["飛登 013", "飛登蓁分享", "南京 062"]);
    expect(centers.at(-1)).toBe("屏東 221");
    db.close();
  });

  it("0018 turns the old 社群連結 (website) values into custom links and seeds the 18 platforms", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 18)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-11T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('m1','g1','active','${ts}','${ts}')`);
    db.exec(`INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES ('m1','website','"https://me.example.com/"','${ts}')`);
    db.exec(`INSERT INTO profile_visibility (member_id, field_key, visibility, updated_at) VALUES ('m1','website','public','${ts}')`);
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0018"))), "utf8"));
    expect(db.prepare("SELECT platform_key, url FROM social_links").all()).toEqual([{ platform_key: "custom", url: "https://me.example.com/" }]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM profile_field_values WHERE field_key = 'website'").get().n).toBe(0);
    const names = db.prepare("SELECT name FROM social_platforms ORDER BY sort_order").all().map((r) => r.name);
    expect(names).toHaveLength(18);
    expect(names[0]).toBe("安麗分享購");
    expect(names.at(-1)).toBe("自定義");
    expect(db.prepare("SELECT custom FROM social_platforms WHERE key = 'custom'").get().custom).toBe(1);
    db.close();
  });

  it("0019 shows the training system as 寰宇: H-Global1985 values and the suggestion term become 寰宇", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 19)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-11T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('m1','g1','active','${ts}','${ts}'), ('m2','g2','active','${ts}','${ts}')`);
    const av = db.prepare("INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, updated_at) VALUES (?, 'education_system', ?, ?, 'approved', ?)");
    av.run("m1", JSON.stringify("H-Global1985"), null, ts);
    av.run("m2", null, JSON.stringify("h-global1985"), ts);
    db.exec(`UPDATE vocab_terms SET uses = 4 WHERE pool = 'education_system' AND norm = 'h-global1985'`);
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0019"))), "utf8"));
    expect(JSON.parse(db.prepare("SELECT value FROM amway_field_values WHERE member_id = 'm1'").get().value)).toBe("寰宇");
    expect(JSON.parse(db.prepare("SELECT pending_value FROM amway_field_values WHERE member_id = 'm2'").get().pending_value)).toBe("寰宇");
    expect(db.prepare("SELECT term, hglobal, uses FROM vocab_terms WHERE pool = 'education_system'").all()).toEqual([{ term: "寰宇", hglobal: 1, uses: 4 }]);
    db.close();
  });

  it("0021 sends values that skipped review (training system 寰宇 and the rank under it) to the standard review", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 21)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-11T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('boss','g1','active','${ts}','${ts}'), ('m2','g2','active','${ts}','${ts}')`);
    db.exec(`INSERT INTO staff_roles (member_id, role, granted_at, granted_by) VALUES ('boss', 'super_admin', '${ts}', NULL)`);
    const ins = db.prepare("INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)");
    ins.run("boss", "education_system", JSON.stringify("寰宇"), "not_required", 0, ts); // never reviewed
    ins.run("boss", "rank", JSON.stringify("r09"), "not_required", 0, ts); // never reviewed
    ins.run("boss", "upline_crown_ambassador", JSON.stringify("某人"), "not_required", 0, ts); // needs no review
    ins.run("m2", "education_system", JSON.stringify("寰宇"), "approved", 1, ts); // already reviewed
    ins.run("m2", "rank", JSON.stringify("r09"), "approved", 1, ts);
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0021"))), "utf8"));
    const rows = db.prepare("SELECT member_id, field_key, value, pending_value, status FROM amway_field_values ORDER BY member_id, field_key").all();
    expect(rows).toEqual([
      { member_id: "boss", field_key: "education_system", value: null, pending_value: JSON.stringify("寰宇"), status: "pending" },
      { member_id: "boss", field_key: "rank", value: null, pending_value: JSON.stringify("r09"), status: "pending" },
      { member_id: "boss", field_key: "upline_crown_ambassador", value: JSON.stringify("某人"), pending_value: null, status: "not_required" },
      { member_id: "m2", field_key: "education_system", value: JSON.stringify("寰宇"), pending_value: null, status: "approved" },
      { member_id: "m2", field_key: "rank", value: JSON.stringify("r09"), pending_value: null, status: "approved" },
    ]);
    expect(db.prepare("SELECT member_id, field_key, status FROM amway_review_requests ORDER BY field_key").all()).toEqual([
      { member_id: "boss", field_key: "education_system", status: "pending" },
      { member_id: "boss", field_key: "rank", status: "pending" },
    ]);
    expect(db.prepare("SELECT member_id, kind FROM notifications").all()).toEqual([
      { member_id: "boss", kind: "staff.review.requested" },
      { member_id: "boss", kind: "staff.review.requested" },
    ]);
    db.close();
  });

  it("0022 keeps the staff, allows the new positions and flags 寰宇 as the reviewed system again", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 22)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-11T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('boss','g1','active','${ts}','${ts}')`);
    db.exec(`INSERT INTO staff_roles (member_id, role, granted_at, granted_by) VALUES ('boss', 'super_admin', '${ts}', NULL)`);
    db.exec(`UPDATE vocab_terms SET hglobal = 0 WHERE pool = 'education_system' AND norm = '寰宇'`); // the owner had unmarked it
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0022"))), "utf8"));
    expect(db.prepare("SELECT member_id, role FROM staff_roles").all()).toEqual([{ member_id: "boss", role: "super_admin" }]);
    for (const role of ["president", "course", "sound", "ticket", "activity", "reviewer", "secretary"]) {
      db.exec(`INSERT INTO staff_roles (member_id, role, granted_at, granted_by) VALUES ('boss', '${role}', '${ts}', NULL)`);
    }
    expect(() => db.exec(`INSERT INTO staff_roles (member_id, role, granted_at, granted_by) VALUES ('boss', 'king', '${ts}', NULL)`)).toThrow();
    expect(db.prepare("SELECT hglobal FROM vocab_terms WHERE pool = 'education_system' AND norm = '寰宇'").get().hglobal).toBe(1);
    db.close();
  });

  it("0025 turns a saved 職稱 text into a one-item list and leaves lists alone", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of files.filter((x) => Number(x.slice(0, 4)) < 25)) db.exec(readFileSync(join(dir, f), "utf8"));
    const ts = "2026-11-14T10:00:00+08:00";
    db.exec(`INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES ('m1','g1','active','${ts}','${ts}'), ('m2','g2','active','${ts}','${ts}')`);
    const pv = db.prepare("INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES (?, ?, ?, ?)");
    pv.run("m1", "job_title", JSON.stringify("經理"), ts);
    pv.run("m2", "job_title", JSON.stringify(["講師", "顧問"]), ts);
    db.exec(readFileSync(join(dir, files.find((x) => x.startsWith("0025"))), "utf8"));
    const val = (m) => JSON.parse(db.prepare("SELECT value FROM profile_field_values WHERE member_id = ? AND field_key = 'job_title'").get(m).value);
    expect(val("m1")).toEqual(["經理"]);
    expect(val("m2")).toEqual(["講師", "顧問"]);
  });
});

