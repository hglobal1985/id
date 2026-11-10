// Uses made-up sample rows only; real member data never enters the repository.
import { describe, it, expect } from "vitest";
import { createTestD1 } from "./helpers/d1.mjs";
import { planImport, RANK_LADDER, type LegacyUser } from "../src/import/legacy";
import { loadLadder, loadMemberEligibility } from "../src/db/eligibility";
import { evaluate } from "../src/eligibility/rules";

const base: LegacyUser = {
  id: "u1", name: "範例甲", email: "a@example.com", amwayId: "1234567", phone: "0912345678", center: "台中",
  rank: "白金", approvedRank: null, rankApproved: 1, rankAuditStatus: "approved", avatar: "https://example.com/a.png", googleAvatar: null,
  joinReason: "想學習", stayReason: "", notes: "備註內容", sponsor: "推薦人乙", platinumUpline: "上手白金丙", diamondUpline: "自填鑽石",
  birthDate: null, birthday: "1990/7/23", residence: "台中市", motto: "加油", registerDate: "2025-01-02", isAdminUser: 1, isBlocked: 0,
  talentNumber: 7, googleSubject: "g-sub-1",
};

function run(users: LegacyUser[]) {
  const db = createTestD1();
  const { sql, report } = planImport(users, [{ kind: "platinum", name: "上手白金丙" }], new Date("2026-11-10T00:00:00Z"), (i) => `TW0${String(100000 + i)}`);
  for (const s of sql) db.raw.exec(s);
  return { db, report };
}

describe("legacy import", () => {
  it("imports members with a Google subject only, and reports counts without values", () => {
    const { db, report } = run([base, { ...base, id: "u2", googleSubject: null }, { ...base, id: "u3" }]);
    expect(report).toMatchObject({ imported: 1, skippedNoGoogle: 1, skippedDuplicateGoogle: 1, superAdmins: 1, unknownRanks: [] });
    expect(JSON.stringify(report)).not.toContain("範例甲");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members").get()?.n).toBe(1);
  });

  it("maps every field as decided by the owner", async () => {
    const { db } = run([base]);
    const m = db.raw.prepare("SELECT * FROM members").get()!;
    expect(m).toMatchObject({ google_sub: "g-sub-1", display_name: "範例甲", amway_enabled: 1, avatar_url: "https://example.com/a.png", created_at: "2025-01-02T00:00:00.000+08:00" });
    const f = Object.fromEntries(db.raw.prepare("SELECT field_key, value FROM profile_field_values").all().map((r) => [r.field_key, JSON.parse(String(r.value))]));
    expect(f).toEqual({
      display_name: "範例甲", contact_email: "a@example.com", phone: "0912345678", birthday: "1990-07-23", city: "台中市", motto: "加油",
      bio: "加入原因：想學習\n備註：備註內容", talent_number: "7",
    });
    expect(db.raw.prepare("SELECT country, number FROM member_numbers").get()).toEqual({ country: "TW", number: "1234567" });
    const a = Object.fromEntries(db.raw.prepare("SELECT field_key, value, status, value_approved FROM amway_field_values").all().map((r) => [r.field_key, [JSON.parse(String(r.value)), r.status, r.value_approved]]));
    expect(a.education_system).toEqual([{ option: "hglobal", custom_text: null }, "approved", 1]);
    expect(a.rank).toEqual(["platinum", "approved", 1]);
    expect(a.education_center?.[0]).toMatch(/^center_\d{2}$/);
    expect(a.referrer?.[0]).toBe("推薦人乙");
    expect(a.upline_platinum?.[0]).toEqual({ option: "up_01", custom_text: null });
    expect(a.upline_diamond?.[0]).toEqual({ option: "other", custom_text: "自填鑽石" });
    expect(db.raw.prepare("SELECT role FROM staff_roles").get()?.role).toBe("super_admin");

    // Eligibility works once the member accepts the current consent.
    db.raw.prepare("INSERT INTO consent_records (id, member_id, document, version, action, occurred_at) VALUES ('c', ?, 'amway_data_sharing', '2', 'accept', 'x')").run(m.id);
    const elig = await loadMemberEligibility(db, String(m.id));
    expect(evaluate({ audience: "hglobal_verified", min_rank: "r21" }, elig, await loadLadder(db))).toEqual({ allowed: true, reason: "ok" });
    expect(evaluate({ audience: "hglobal_verified", min_rank: "f_platinum" }, elig, await loadLadder(db))).toEqual({ allowed: false, reason: "rank_too_low" });
  });

  it("without consent the imported member is not yet eligible (all members must accept version 2)", async () => {
    const { db } = run([base]);
    const id = String(db.raw.prepare("SELECT id FROM members").get()?.id);
    expect(evaluate({ audience: "hglobal_verified" }, await loadMemberEligibility(db, id), await loadLadder(db))).toEqual({ allowed: false, reason: "amway_disabled" });
  });

  it("「無」 means no rank; missing Amway ids get a random number; invalid values are dropped and counted; re-running is idempotent", () => {
    const u = { ...base, rank: "無", amwayId: "", phone: "not a phone", isAdminUser: 0 };
    const { db, report } = run([u]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM amway_field_values WHERE field_key = 'rank'").get()?.n).toBe(0);
    expect(db.raw.prepare("SELECT number FROM member_numbers").get()?.number).toBe("TW0100000");
    expect(report.invalidValuesDropped).toEqual({ phone: 1 });
    const again = planImport([u], [], new Date(), () => "TW0999999");
    for (const s of again.sql) db.raw.exec(s);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM members").get()?.n).toBe(1);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM member_numbers").get()?.n).toBe(1);
  });

  it("ladder order matches the owner's list and unknown ranks are reported", () => {
    expect(RANK_LADDER.map((r) => r[1])).toEqual(["3%", "9%", "12%初階", "12%", "15%", "15%銅章", "18%", "21%", "銀章", "金章", "白金", "創辦人白金", "紅寶石", "創辦人紅寶石", "藍寶石", "創辦人藍寶石", "翡翠", "鑽石級以上"]);
    const { report } = run([{ ...base, rank: "皇冠" }]);
    expect(report.unknownRanks).toEqual(["皇冠"]);
  });
});
