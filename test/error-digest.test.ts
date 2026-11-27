import { describe, it, expect } from "vitest";
import { ErrorReportError, digestText, isDigestDue, normalizePage, normalizeReport, normalizeReports, summarize } from "../src/platform/error-digest";
import { runErrorDigest } from "../src/jobs/error-digest";
import { addErrorCounts, claimDigestRun, loadErrorCounts, saveEcoSettings } from "../src/db/eco-features";
import { ECO_CATALOG } from "../src/platform/eco-features";
import { createTestD1 } from "./helpers/d1.mjs";

describe("錯誤回報：驗證規則", () => {
  it("頁面只留路徑，去掉查詢字串並把識別碼換成 :id", () => {
    expect(normalizePage("/courses/12345678?token=abc#x")).toBe("/courses/:id");
    expect(normalizePage("/orders/550e8400-e29b-41d4-a716-446655440000/pay")).toBe("/orders/:id/pay");
    expect(normalizePage("/tabs/2")).toBe("/tabs/2");
    expect(normalizePage("/")).toBe("/");
    for (const bad of ["courses", "/a b", "/中文", `/${"a".repeat(130)}`]) expect(() => normalizePage(bad)).toThrow(ErrorReportError);
  });

  it("種類、版本、次數都有範圍，自由文字進不來", () => {
    expect(normalizeReport({ kind: "network", page: "/x", app_version: "1.4.0" })).toEqual({ kind: "network", page: "/x", app_version: "1.4.0", count: 1 });
    for (const bad of [{ kind: "boom", page: "/x", app_version: "1.0.0" }, { kind: "api", page: "/x", app_version: "v1 beta" }, { kind: "api", page: "/x", app_version: "1.0.0", count: 0 }, { kind: "api", page: "/x", app_version: "1.0.0", count: 1001 }, "x", null]) {
      expect(() => normalizeReport(bad)).toThrow(ErrorReportError);
    }
    expect(() => normalizeReports([])).toThrow(ErrorReportError);
    expect(() => normalizeReports(new Array(21).fill({ kind: "api", page: "/x", app_version: "1.0.0" }))).toThrow(ErrorReportError);
  });

  it("只在設定的星期、台北 09:00～09:04 才到寄送時間", () => {
    // 2026-11-30 是星期一；台北 09:02 = UTC 01:02
    expect(isDigestDue(1, new Date("2026-11-30T01:02:00Z"))).toBe(true);
    expect(isDigestDue(1, new Date("2026-11-30T01:05:00Z"))).toBe(false);
    expect(isDigestDue(1, new Date("2026-11-30T02:02:00Z"))).toBe(false);
    expect(isDigestDue(2, new Date("2026-11-30T01:02:00Z"))).toBe(false);
  });

  it("彙整：依次數排序，列出種類、常見頁面與版本", () => {
    const d = summarize(
      [
        { app_id: "learn", kind: "network", page: "/a", app_version: "1.0.0", count: 3 },
        { app_id: "learn", kind: "api", page: "/a", app_version: "1.1.0", count: 2 },
        { app_id: "check", kind: "crash", page: "/b", app_version: "2.0.0", count: 1 },
      ],
      new Map([["learn", "行動大學"]]),
    );
    expect(d.map((x) => [x.name, x.total])).toEqual([["行動大學", 5], ["check", 1]]);
    expect(d[0]?.top_pages).toEqual([{ page: "/a", count: 5 }]);
    expect(digestText(d, "2026-11-24", "2026-11-30")).toContain("共 6 次");
  });
});

describe("錯誤回報週報工作", () => {
  const sa = "m-admin";
  function setup() {
    const db = createTestD1();
    db.raw.prepare("INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES (?, 'g-admin', 'active', 'x', 'x')").run(sa);
    db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, 'super_admin', 'x')").run(sa);
    db.raw.prepare("INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES (?, 'contact_email', ?, 'x')").run(sa, JSON.stringify("boss@example.com"));
    return db;
  }
  const monday = new Date("2026-11-30T01:01:00Z");

  it("累加同一組合、超過每日上限不再新增新組合", async () => {
    const db = setup();
    await addErrorCounts(db, "learn", [{ kind: "api", page: "/a", app_version: "1.0.0", count: 2 }], monday);
    await addErrorCounts(db, "learn", [{ kind: "api", page: "/a", app_version: "1.0.0", count: 3 }], monday);
    expect((await loadErrorCounts(db, "2026-11-01"))[0]?.count).toBe(5);
    const many = Array.from({ length: 20 }, (_, i) => ({ kind: "api" as const, page: `/p${i}`, app_version: "1.0.0", count: 1 }));
    for (let n = 0; n < 11; n++) await addErrorCounts(db, "check", many.map((m) => ({ ...m, page: `${m.page}x${n}` })), monday);
    const stored = (await loadErrorCounts(db, "2026-11-01")).filter((r) => r.app_id === "check").length;
    expect(stored).toBe(200);
  });

  it("到時間寄一次週報（站內通知＋Email），同一天不重寄，沒錯誤不寄", async () => {
    const db = setup();
    await saveEcoSettings(db, "error_digest", { ...ECO_CATALOG.error_digest.defaults, weekday: 1 }, { memberId: sa, requestId: "r" }, monday);
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer = { from: "n@x", name: "會員中心", binding: { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) } };
    expect(await runErrorDigest(db, mailer, monday)).toBe(0); // 本週沒有錯誤
    expect(sent).toHaveLength(0);
    // 沒錯誤那次已經占用當天；換下一週測有錯誤的情況
    const next = new Date(monday.getTime() + 7 * 86400_000);
    await addErrorCounts(db, "learn", [{ kind: "network", page: "/courses/:id", app_version: "1.4.0", count: 4 }], next);
    expect(await runErrorDigest(db, mailer, new Date(next.getTime() - 3600_000))).toBe(0); // 還沒到 09:00
    expect(await runErrorDigest(db, mailer, next)).toBe(4);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "boss@example.com" });
    expect(sent[0]?.text).toContain("網路連線錯誤 4");
    expect(await runErrorDigest(db, mailer, new Date(next.getTime() + 60_000))).toBe(0); // 同一天不重寄
    expect(sent).toHaveLength(1);
    const n = db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'eco.error_digest'").get() as { n: number };
    expect(n.n).toBe(1);
    expect(await claimDigestRun(db, "2026-12-07", next)).toBe(false);
  });

  it("功能關閉時不寄", async () => {
    const db = setup();
    await saveEcoSettings(db, "error_digest", { ...ECO_CATALOG.error_digest.defaults, enabled: false }, { memberId: sa, requestId: "r" }, monday);
    await addErrorCounts(db, "learn", [{ kind: "api", page: "/a", app_version: "1.0.0", count: 1 }], monday);
    expect(await runErrorDigest(db, undefined, monday)).toBe(0);
  });
});
