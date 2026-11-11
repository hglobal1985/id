import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";
import { decideReview, pendingReviews, staffAdjust } from "../src/db/amway";
import { getAmwayField, needsReview, systemKey, validateAmwayValue } from "../src/amway/fields";

const ISSUER = "https://id.test.example";
const ALL = "openid profile profile.read profile.basic.write profile.spouse.write amway.read amway.write";

const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "amway-test" });
})();

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
interface M {
  id: string;
  token: string;
}
const ctx = () => ({ appId: null, requestId: "req", now: new Date() });

async function member(sub: string, name: string, scope = ALL): Promise<M> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name }, "TW", new Date(), "req");
  const { session } = await createSession(db, member.id, new Date());
  const t = await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId: member.id, sessionId: session.id, scope, authTime: Math.floor(Date.now() / 1000) });
  return { id: member.id, token: t.access_token };
}

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk };
  app = createApp();
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning','e','none','[]',?, 'active','x','x')").run(ALL);
  // Replace the migration-seeded rank ladder with a small fixture ladder.
  db.raw.prepare("DELETE FROM amway_options WHERE field_key = 'rank'").run();
  const opt = db.raw.prepare("INSERT INTO amway_options (field_key, value, label, sort_order) VALUES (?, ?, ?, ?)");
  opt.run("education_system", "sys_b", "其他體系B", 20);
  opt.run("education_center", "c_taipei", "台北中心", 10);
  opt.run("rank", "12a", "12%初階", 10);
  opt.run("rank", "12", "12%", 20);
  opt.run("rank", "15", "15%", 30);
  opt.run("upline_diamond", "d1", "某鑽石", 10);
});

const call = (m: M, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { authorization: `Bearer ${m.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }, env);

const enable = (m: M) => call(m, "PUT", "/v1/me/amway/enabled", { enabled: true });
const put = (m: M, key: string, value: unknown) => call(m, "PUT", `/v1/me/amway/fields/${key}`, { value });
type State = { enabled: boolean; fields: Record<string, { value: unknown; pending_value: unknown; status: string; visibility: string }> };
const me = async (m: M) => (await (await call(m, "GET", "/v1/me/amway")).json()) as State;

describe("definitions", () => {
  it("serves options from the database (rank in ladder order); free-text fields name their vocabulary; visible_when", async () => {
    const m = await member("g-a", "甲");
    const res = await call(m, "GET", "/v1/amway/field-definitions");
    expect(res.status).toBe(200);
    const d = (await res.json()) as { enabled_label: string; fields: { key: string; type: string; label: string; suggest?: string; options?: { value: string; label: string }[]; visible_when: unknown }[] };
    expect(d.enabled_label).toBe("我是Amway會員");
    const f = Object.fromEntries(d.fields.map((x) => [x.key, x]));
    expect(f.rank?.options?.map((o) => o.value)).toEqual(["12a", "12", "15"]);
    expect(f.education_system).toMatchObject({ type: "text", label: "直銷商培訓系統", suggest: "education_system" });
    expect(f.education_system?.options).toBeUndefined();
    expect(f.upline_diamond).toMatchObject({ type: "text", suggest: "upline_diamond" });
    expect(f.upline_crown_ambassador?.label).toBe("皇冠大使");
    expect(f.education_center).toMatchObject({ type: "text", label: "地區教育中心", suggest: "education_center", suggest_when_hglobal: true, visible_when: null });
    expect(Object.keys(f)).not.toContain("amway_id");
  });

  it("there is no consent step any more", async () => {
    const m = await member("g-a", "甲");
    expect((await call(m, "GET", "/v1/amway/consent")).status).toBe(404);
  });

  it("needs amway.read / amway.write", async () => {
    const m = await member("g-a", "甲", "openid profile.read");
    expect((await call(m, "GET", "/v1/me/amway")).status).toBe(403);
    expect((await enable(m)).status).toBe(403);
  });
});

describe("enable switch", () => {
  it("turns on and off at once without any confirmation; disabling keeps the data and pauses writes", async () => {
    const m = await member("g-a", "甲");
    const res = await put(m, "referrer", "王小明");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("amway_disabled");

    expect((await enable(m)).status).toBe(200);
    let s = await me(m);
    expect(s.enabled).toBe(true);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM consent_records").get()).toEqual({ n: 0 });

    expect((await put(m, "referrer", "王小明")).status).toBe(200);
    expect((await call(m, "PUT", "/v1/me/amway/enabled", { enabled: false })).status).toBe(200);
    s = await me(m);
    expect(s.enabled).toBe(false);
    expect(s.fields.referrer?.value).toBe("王小明");
    expect((await put(m, "referrer", "改")).status).toBe(403);
  });

  it("only the display name, the residence country and 生命靈數 are always public; every Amway field can be hidden at will (they start public, the crown ambassador starts hidden)", async () => {
    const m = await member("g-a", "甲", `${ALL} profile.visibility.write`);
    await enable(m);
    const s = await me(m);
    for (const k of ["education_system", "education_center", "rank", "referrer", "upline_platinum", "upline_diamond"]) expect(s.fields[k]?.visibility, k).toBe("public");
    expect(s.fields.upline_crown_ambassador?.visibility).toBe("private");
    for (const k of ["display_name", "country", "derived"]) {
      const res = await call(m, "PUT", "/v1/me/profile/visibility", { fields: { [k]: "private" } });
      expect(res.status, k).toBe(422);
      expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("always_public");
    }
    // The Amway fields have a switch.
    expect((await call(m, "PUT", "/v1/me/profile/visibility", { fields: { rank: "private", referrer: "private", upline_crown_ambassador: "public" } })).status).toBe(200);
    const after = await me(m);
    expect(after.fields.rank?.visibility).toBe("private");
    expect(after.fields.referrer?.visibility).toBe("private");
    expect(after.fields.upline_crown_ambassador?.visibility).toBe("public");
    const defs = (await (await call(m, "GET", "/v1/amway/field-definitions")).json()) as { fields: { key: string; visibility: { configurable: boolean; default: string } }[] };
    expect(defs.fields.find((f) => f.key === "rank")?.visibility).toEqual({ configurable: true, default: "public" });
    expect(defs.fields.find((f) => f.key === "upline_crown_ambassador")?.visibility).toEqual({ configurable: true, default: "private" });
    const pdefs = (await (await call(m, "GET", "/v1/profile/field-definitions")).json()) as { fields: { key: string; visibility: { configurable: boolean } }[] };
    expect(pdefs.fields.find((f) => f.key === "display_name")?.visibility.configurable).toBe(false);
    expect(pdefs.fields.find((f) => f.key === "country")?.visibility.configurable).toBe(false);
    expect(pdefs.fields.find((f) => f.key === "region")?.visibility.configurable).toBe(true);
    const p = (await (await call(m, "GET", "/v1/me/profile")).json()) as { derived: { visibility: string }; fields: { display_name: { visibility: string } } };
    expect(p.derived.visibility).toBe("public");
    expect(p.fields.display_name.visibility).toBe("public");
  });

  it("turning the switch off gives a fresh random number (country + 0 + digits); the 'recommended to change' note ends once the member changed it", async () => {
    const m = await member("g-a", "甲");
    const prof = async () => ((await (await call(m, "GET", "/v1/me/profile")).json()) as { fields: { member_number: { value: { country: string; number: string }[]; note?: string } } }).fields.member_number;
    expect((await prof()).note).toBe("隨機產生，不可修改");
    await enable(m);
    expect((await prof()).note).toBe("建議修改會員編號");
    // Changing it once ends the reminder for good, even after the switch goes off and on again.
    expect((await call(m, "PUT", "/v1/me/profile/fields/member_number", { value: [{ country: "TW", number: "9475831" }] })).status).toBe(200);
    expect((await prof()).note).toBeUndefined();
    const off = await call(m, "PUT", "/v1/me/amway/enabled", { enabled: false });
    const body = (await off.json()) as { enabled: boolean; member_number: { country: string; number: string }[] };
    expect(body.member_number).toHaveLength(1);
    expect(body.member_number[0]?.number).toMatch(/^TW0\d{6,9}$/);
    expect((await prof()).value).toEqual(body.member_number);
    expect((await prof()).note).toBe("隨機產生，不可修改");
    await enable(m);
    expect((await prof()).note).toBeUndefined();
    // Every time it is turned off the number is drawn again.
    const again = (await (await call(m, "PUT", "/v1/me/amway/enabled", { enabled: false })).json()) as { member_number: { number: string }[] };
    expect(again.member_number[0]?.number).not.toBe(body.member_number[0]?.number);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'member_number.reset'").get()?.n).toBe(2);
  });

  it("a couple bound by an Amway number is unbound when one turns the switch off", async () => {
    const a = await member("g-a", "甲");
    const b = await member("g-b", "乙");
    await enable(a);
    await enable(b);
    const bNumber = db.raw.prepare("SELECT country, number FROM member_numbers WHERE member_id = ?").get(b.id);
    const dup = (await (await call(a, "PUT", "/v1/me/profile/fields/member_number", { value: [bNumber] })).json()) as { duplicate_candidates: { candidate_id: string }[] };
    expect((await call(a, "POST", "/v1/me/spouse", { candidate_id: dup.duplicate_candidates[0]?.candidate_id })).status).toBe(200);
    expect((await call(a, "PUT", "/v1/me/amway/enabled", { enabled: false })).status).toBe(200);
    expect(((await (await call(a, "GET", "/v1/me/spouse")).json()) as { spouse: unknown }).spouse).toBeNull();
    const na = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(a.id)?.number as string;
    const nb = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(b.id)?.number as string;
    expect(na).not.toBe(nb);
    expect(na).toMatch(/^TW0\d{6,9}$/);
  });
});

describe("fields and review", () => {
  it("non-reviewed fields apply at once; validation uses the option lists", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    let res = await put(m, "upline_diamond", "某鑽石");
    expect(((await res.json()) as { status: string }).status).toBe("not_required");
    res = await put(m, "upline_platinum", "  陳大華 ");
    expect(((await res.json()) as { value: unknown }).value).toBe("陳大華");
    // What members type is remembered as a related word, and an existing spelling wins.
    expect(db.raw.prepare("SELECT term, uses FROM vocab_terms WHERE pool = 'upline_platinum'").all()).toEqual([{ term: "陳大華", uses: 1 }]);
    for (const [k, v, reason] of [
      ["rank", "99", "not_an_option"],
      ["upline_platinum", { option: "other", custom_text: "x" }, "type"],
      ["referrer", "x".repeat(51), "too_long"],
    ] as [string, unknown, string][]) {
      res = await put(m, k, v);
      expect(res.status, k).toBe(422);
      expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe(reason);
    }
    expect((await put(m, "amway_id", "1")).status).toBe(404);
  });

  it("choosing 寰宇 alone passes at once; naming a center sends the center (and the rank) to review, the rank keeps its old value while pending", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    let res = await put(m, "education_system", "寰宇");
    expect(await res.json()).toMatchObject({ value: "寰宇", pending_value: null, status: "not_required" });
    res = await put(m, "rank", "12"); // no center yet: nothing to review
    expect(await res.json()).toMatchObject({ value: "12", status: "not_required" });
    expect(await pendingReviews(db)).toEqual([]);

    res = await put(m, "education_center", "台北中心");
    expect(await res.json()).toMatchObject({ value: null, pending_value: "台北中心", status: "pending" });
    // the rank saved before the center existed now waits for the same review
    expect((await pendingReviews(db)).map((r) => r.field_key).sort()).toEqual(["education_center", "rank"]);
    expect(db.raw.prepare("SELECT DISTINCT center_norm FROM amway_review_requests").all()).toEqual([{ center_norm: "台北中心" }]);

    for (const r of await pendingReviews(db)) await decideReview(db, r.id, "approve", "staff-1", ctx());
    let s = await me(m);
    expect(s.fields.education_center).toMatchObject({ value: "台北中心", status: "approved", pending_value: null });
    expect(s.fields.rank).toMatchObject({ value: "12", status: "approved" });

    // Changing an approved rank: old value stays during review; rejection keeps the old value.
    res = await put(m, "rank", "15");
    expect(await res.json()).toMatchObject({ value: "12", pending_value: "15", status: "pending" });
    const [req] = await pendingReviews(db);
    await decideReview(db, req!.id, "reject", "staff-1", ctx());
    s = await me(m);
    expect(s.fields.rank).toMatchObject({ value: "12", pending_value: null, status: "rejected" });

    const kinds = db.raw.prepare("SELECT kind FROM notifications WHERE member_id = ? ORDER BY rowid").all(m.id).map((r) => r.kind);
    expect(kinds).toEqual(["amway.review.approved", "amway.review.approved", "amway.review.rejected"]);
  });

  it("leaving 寰宇 releases the center and the rank that were only waiting for review", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    await put(m, "education_system", "寰宇");
    await put(m, "education_center", "台北中心");
    expect((await pendingReviews(db)).map((r) => r.field_key)).toEqual(["education_center"]);
    await put(m, "education_system", "其他體系B");
    const s = await me(m);
    expect(s.fields.education_center).toMatchObject({ value: "台北中心", pending_value: null, status: "not_required" });
    expect(await pendingReviews(db)).toEqual([]);
  });

  it("other education systems need no review and the rank is approved automatically", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    expect(await (await put(m, "education_system", "其他體系B")).json()).toMatchObject({ status: "not_required", value: "其他體系B" });
    expect(await (await put(m, "rank", "15")).json()).toMatchObject({ status: "not_required", value: "15" });
    expect(await (await put(m, "education_center", "台北中心")).json()).toMatchObject({ status: "not_required", value: "台北中心" });
    expect(await pendingReviews(db)).toEqual([]);
  });

  it("a value that skipped review earlier (staff included) goes through the standard review when it is sent again", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    await put(m, "education_system", "寰宇");
    // legacy row: the center was saved without review and never approved
    db.raw.prepare("INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at) VALUES (?, 'education_center', '\"台北中心\"', NULL, 'not_required', 0, '2026-11-11T10:00:00+08:00')").run(m.id);
    const res = await put(m, "education_center", "台北中心");
    expect(await res.json()).toMatchObject({ value: null, pending_value: "台北中心", status: "pending" });
    expect((await pendingReviews(db)).map((r) => r.field_key)).toEqual(["education_center"]);
  });

  it("re-sending the same value is idempotent; going back to the effective value cancels the pending change", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    await put(m, "education_system", "寰宇");
    await put(m, "education_center", "台北中心");
    await put(m, "education_center", " 台北中心 "); // same term, different spelling
    expect(await pendingReviews(db)).toHaveLength(1);
    await decideReview(db, (await pendingReviews(db))[0]!.id, "approve", "s", ctx());
    await put(m, "rank", "12");
    await decideReview(db, (await pendingReviews(db))[0]!.id, "approve", "s", ctx());
    await put(m, "rank", "15");
    const res = await put(m, "rank", "12");
    expect(await res.json()).toMatchObject({ value: "12", pending_value: null, status: "approved" });
    expect(await pendingReviews(db)).toEqual([]);
  });

  it("reviewers can adjust fields directly (approved, member notified, audited)", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    await put(m, "rank", "12a");
    await staffAdjust(db, m.id, "rank", "15", "staff-9", ctx());
    expect((await me(m)).fields.rank).toMatchObject({ value: "15", status: "approved" });
    expect(db.raw.prepare("SELECT action, actor_id FROM audit_log WHERE action = 'amway.review.adjust'").get()).toEqual({ action: "amway.review.adjust", actor_id: "staff-9" });
    const n = (await (await call(m, "GET", "/v1/me/notifications")).json()) as { notifications: { kind: string; body: string; id: string }[]; unread: number };
    expect(n.unread).toBe(1);
    expect(n.notifications[0]?.body).toBe("管理人員已調整您的「獎銜」。");
    expect((await call(m, "POST", `/v1/me/notifications/${n.notifications[0]?.id}/read`)).status).toBe(200);
    expect(((await (await call(m, "GET", "/v1/me/notifications")).json()) as { unread: number }).unread).toBe(0);
  });

  it("audit records the field and app, never the value", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    await put(m, "referrer", "王小明");
    const text = JSON.stringify(db.raw.prepare("SELECT * FROM audit_log").all());
    expect(text).not.toContain("王小明");
    expect(text).toContain("referrer");
  });
});

describe("spouses share rank", () => {
  it("binding shares the higher rank; later approvals reach both; spouse notification text", async () => {
    const a = await member("g-a", "甲");
    const b = await member("g-b", "乙");
    for (const m of [a, b]) {
      await enable(m);
      await put(m, "education_system", "其他體系B");
    }
    await put(a, "rank", "12");
    await put(b, "rank", "15");
    const bNumber = db.raw.prepare("SELECT country, number FROM member_numbers WHERE member_id = ?").get(b.id);
    const dup = (await (await call(a, "PUT", "/v1/me/profile/fields/member_number", { value: [bNumber] })).json()) as { duplicate_candidates: { candidate_id: string; rank: string | null }[] };
    expect(dup.duplicate_candidates[0]?.rank).toBeNull(); // only reviewed ranks are shown
    expect((await call(a, "POST", "/v1/me/spouse", { candidate_id: dup.duplicate_candidates[0]?.candidate_id })).status).toBe(200);
    expect((await me(a)).fields.rank?.value).toBe("15");
    expect((await me(b)).fields.rank?.value).toBe("15");

    await staffAdjust(db, b.id, "rank", "12a", "s", ctx());
    expect((await me(a)).fields.rank).toMatchObject({ value: "12a", status: "approved" });
    const spouseView = (await (await call(b, "GET", "/v1/me/spouse")).json()) as { spouse: { rank: string } };
    expect(spouseView.spouse.rank).toBe("12%初階");

    const n = (await (await call(b, "GET", "/v1/me/notifications")).json()) as { notifications: { kind: string; body: string; actions: string[] }[] };
    const bound = n.notifications.find((x) => x.kind === "spouse.bound");
    expect(bound?.body).toContain("甲 已將您綁定為夫妻");
    expect(bound?.actions).toEqual(["unbind_spouse"]);
    // Unbinding keeps the rank.
    await call(b, "DELETE", "/v1/me/spouse");
    expect((await me(a)).fields.rank?.value).toBe("12a");
    expect((await me(b)).fields.rank?.value).toBe("12a");
  });
});

describe("rules (unit)", () => {
  const hg = new Set(["寰宇"]);
  it("review decisions: 寰宇 alone needs none; with a center the center and the rank do", () => {
    const sys = getAmwayField("education_system")!;
    const center = getAmwayField("education_center")!;
    const rank = getAmwayField("rank")!;
    const hgSys = { effective: "hglobal", pending: null };
    expect(needsReview(sys, "寰宇", { system: hgSys, hasCenter: true })).toBe(false); // the system itself is never reviewed
    expect(needsReview(center, "台北中心", { system: hgSys, hasCenter: true })).toBe(true);
    expect(needsReview(center, "台北中心", { system: { effective: "sys_b", pending: null }, hasCenter: true })).toBe(false);
    expect(needsReview(rank, "12", { system: hgSys, hasCenter: false })).toBe(false); // no center: nothing to review
    expect(needsReview(rank, "12", { system: hgSys, hasCenter: true })).toBe(true);
    expect(needsReview(rank, "12", { system: { effective: null, pending: "hglobal" }, hasCenter: true })).toBe(true);
    expect(needsReview(rank, "12", { system: { effective: "sys_b", pending: null }, hasCenter: true })).toBe(false);
    expect(needsReview(getAmwayField("upline_diamond")!, "某鑽石", { system: hgSys, hasCenter: true })).toBe(false);
    expect(systemKey("寰宇", hg)).toBe("hglobal");
    expect(systemKey("其他", hg)).toBe("其他");
    expect(systemKey(null, hg)).toBeNull();
  });
  it("validation", () => {
    const sys = getAmwayField("education_system")!;
    expect(validateAmwayValue(sys, "寰宇", [])).toEqual({ ok: true, value: "寰宇" });
    expect(validateAmwayValue(sys, { option: "x", custom_text: null }, [])).toMatchObject({ ok: false, reason: "type" });
    expect(validateAmwayValue(sys, null, [])).toEqual({ ok: true, value: null });
    expect(validateAmwayValue(getAmwayField("referrer")!, "a\u0007", [])).toMatchObject({ ok: false, reason: "invalid_characters" });
  });
});
