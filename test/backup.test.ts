import { describe, it, expect } from "vitest";
import { BACKUP_TABLES, backupsToDelete, isBackupDue, restoreReadme } from "../src/platform/backup";
import { runWeeklyBackup } from "../src/jobs/backup";
import { saveEcoSettings } from "../src/db/eco-features";
import { ECO_CATALOG } from "../src/platform/eco-features";
import { createTestD1 } from "./helpers/d1.mjs";
import tables from "./tables.json";

/** 只實作備份會用到的 R2 功能（字串內容、delimiter 列資料夾、批次刪除）。 */
function bucket(failPut = false) {
  const store = new Map<string, string>();
  const b = {
    store,
    async put(key: string, v: string) { if (failPut) throw new Error("r2 down"); store.set(key, v); },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k); },
    async list(o: { prefix?: string; delimiter?: string }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(o.prefix ?? ""));
      if (o.delimiter) return { objects: [], delimitedPrefixes: [...new Set(keys.map((k) => k.slice(0, (o.prefix ?? "").length + k.slice((o.prefix ?? "").length).indexOf("/") + 1)))], truncated: false };
      return { objects: keys.map((key) => ({ key })), delimitedPrefixes: [], truncated: false };
    },
  };
  return b as typeof b & R2Bucket;
}

describe("每週備份：規則", () => {
  it("只在設定的星期、台北 03:00～03:04 才到備份時間", () => {
    // 2026-11-29 是星期日；台北 03:02 = 11-28 UTC 19:02
    expect(isBackupDue(0, new Date("2026-11-28T19:02:00Z"))).toBe(true);
    expect(isBackupDue(0, new Date("2026-11-28T19:05:00Z"))).toBe(false);
    expect(isBackupDue(1, new Date("2026-11-28T19:02:00Z"))).toBe(false);
  });

  it("備份範圍不含 Amway、登入暫存、密碼雜湊與圖檔；每張表都真的存在", () => {
    const names = Object.keys(BACKUP_TABLES);
    for (const n of names) expect(tables).toContain(n);
    for (const t of names) expect(t).not.toMatch(/amway|token|nonce|session|login|credential|webhook|code|sso/);
    for (const cols of Object.values(BACKUP_TABLES)) for (const c of cols) expect(c).not.toMatch(/hash|secret|token|icon_data|^data$|amway/);
    expect(BACKUP_TABLES.members).not.toContain("amway_enabled");
  });

  it("只留最近 keep 份，日期格式不對的資料夾不動", () => {
    const f = ["2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22"].map((d) => `backups/${d}/`).concat("backups/other/");
    expect(backupsToDelete(f, 2)).toEqual(["backups/2026-11-08/", "backups/2026-11-01/"]);
    expect(backupsToDelete(f, 12)).toEqual([]);
  });

  it("還原說明要求先在測試環境驗證、需杜杜龍核准", () => {
    const t = restoreReadme("2026-11-29");
    expect(t).toContain("杜杜龍");
    expect(t).toContain("staging");
  });
});

describe("每週備份：工作", () => {
  const sun = new Date("2026-11-28T19:02:00Z"); // 台北 2026-11-29（日）03:02
  function setup() {
    const db = createTestD1();
    db.raw.prepare("INSERT INTO members (id, google_sub, google_email, amway_enabled, status, created_at, updated_at) VALUES ('m1', 'g1', 'a@example.com', 1, 'active', 'x', 'x')").run();
    db.raw.prepare("INSERT INTO amway_field_values (member_id, field_key, value, status, updated_at) VALUES ('m1', 'rank', '\"gold\"', 'approved', 'x')").run();
    db.raw.prepare("INSERT INTO login_sessions (id, token_hash, member_id, auth_time_epoch, expires_epoch, created_at) VALUES ('s1', 'SECRETHASH', 'm1', 1, 2, 'x')").run();
    return db;
  }

  it("到時間就備份：寫資料檔、說明與 manifest，不含 Amway 與登入資料；同一天只做一次", async () => {
    const db = setup();
    const b = bucket();
    expect(await runWeeklyBackup(db, b, sun)).toBeGreaterThan(0);
    const keys = [...b.store.keys()];
    expect(keys).toContain("backups/2026-11-29/manifest.json");
    expect(keys).toContain("backups/2026-11-29/README.txt");
    const all = [...b.store.values()].join("\n");
    expect(all).toContain("g1");
    expect(all).not.toContain("SECRETHASH");
    expect(all).not.toContain("AMWAYVALUE");
    expect(all).not.toContain("amway_enabled");
    const manifest = JSON.parse(b.store.get("backups/2026-11-29/manifest.json") ?? "{}");
    expect(manifest.tables.members.rows).toBe(1);
    expect(await runWeeklyBackup(db, b, new Date(sun.getTime() + 60_000))).toBe(0);
    expect(db.raw.prepare("SELECT last_status FROM eco_feature_apps WHERE feature_key = 'weekly_backup'").get()).toEqual({ last_status: "ok" });
  });

  it("功能關閉、沒到時間、沒有 R2 都不備份", async () => {
    const db = setup();
    const b = bucket();
    expect(await runWeeklyBackup(db, b, new Date("2026-11-29T19:02:00Z"))).toBe(0);
    expect(await runWeeklyBackup(db, undefined, sun)).toBe(0);
    await saveEcoSettings(db, "weekly_backup", { ...ECO_CATALOG.weekly_backup.defaults, enabled: false }, { memberId: "m1", requestId: "r" }, sun);
    expect(await runWeeklyBackup(db, b, sun)).toBe(0);
    expect(b.store.size).toBe(0);
  });

  it("超過保留份數的舊備份會被刪掉", async () => {
    const db = setup();
    const b = bucket();
    await saveEcoSettings(db, "weekly_backup", { ...ECO_CATALOG.weekly_backup.defaults, keep: 2 }, { memberId: "m1", requestId: "r" }, sun);
    for (const d of ["2026-11-08", "2026-11-15", "2026-11-22"]) b.store.set(`backups/${d}/manifest.json`, "{}");
    await runWeeklyBackup(db, b, sun);
    const folders = new Set([...b.store.keys()].map((k) => k.split("/")[1]));
    expect([...folders].sort()).toEqual(["2026-11-22", "2026-11-29"]);
  });

  it("寫入失敗：回寫失敗結果、通知超級管理員、不留 manifest", async () => {
    const db = setup();
    db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES ('m1', 'super_admin', 'x')").run();
    const b = bucket(true);
    await expect(runWeeklyBackup(db, b, sun)).rejects.toThrow();
    expect(db.raw.prepare("SELECT last_status FROM eco_feature_apps WHERE feature_key = 'weekly_backup'").get()).toEqual({ last_status: "fail" });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'eco.backup_failed'").get()).toEqual({ n: 1 });
    expect(b.store.size).toBe(0);
  });
});
