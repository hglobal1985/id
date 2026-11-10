import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";
import { decideReview, pendingReviews, staffAdjust } from "../src/db/amway";
import { getAmwayField, needsReview, validateAmwayValue } from "../src/amway/fields";
import { CONSENT_SHORT } from "../src/amway/consent";

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

const enable = (m: M) => call(m, "PUT", "/v1/me/amway/enabled", { enabled: true, consent_version: "2" });
const put = (m: M, key: string, value: unknown) => call(m, "PUT", `/v1/me/amway/fields/${key}`, { value });
type State = { enabled: boolean; consent: { version: string; current: boolean } | null; fields: Record<string, { value: unknown; pending_value: unknown; status: string }> };
const me = async (m: M) => (await (await call(m, "GET", "/v1/me/amway")).json()) as State;

describe("definitions and consent", () => {
  it("serves options from the database (rank in ladder order, 其他 for custom fields) and visible_when", async () => {
    const m = await member("g-a", "甲");
    const res = await call(m, "GET", "/v1/amway/field-definitions");
    expect(res.status).toBe(200);
    const d = (await res.json()) as { enabled_label: string; fields: { key: string; options?: { value: string; label: string }[]; visible_when: unknown }[] };
    expect(d.enabled_label).toBe("我是Amway會員");
    const f = Object.fromEntries(d.fields.map((x) => [x.key, x]));
    expect(f.rank?.options?.map((o) => o.value)).toEqual(["12a", "12", "15"]);
    expect(f.education_system?.options).toEqual([{ value: "hglobal", label: "H-Global1985" }, { value: "sys_b", label: "其他體系B" }, { value: "other", label: "其他" }]);
    expect(f.education_center?.visible_when).toEqual({ field: "education_system", equals: "hglobal" });
    expect(Object.keys(f)).not.toContain("amway_id");
  });

  it("serves the approved short consent text and version", async () => {
    const m = await member("g-a", "甲");
    const c = (await (await call(m, "GET", "/v1/amway/consent")).json()) as { version: string; title: string; items: string[]; full_privacy_url: string; checkbox_label: string };
    expect(c.version).toBe("2");
    expect(c.title).toBe(CONSENT_SHORT.title);
    expect(c.items).toHaveLength(7);
    expect(c.checkbox_label).toBe("我已閱讀並同意以上內容");
    expect(c.full_privacy_url).toBe(`${ISSUER}/privacy/amway`);
  });

  it("needs amway.read / amway.write", async () => {
    const m = await member("g-a", "甲", "openid profile.read");
    expect((await call(m, "GET", "/v1/me/amway")).status).toBe(403);
    expect((await enable(m)).status).toBe(403);
  });
});

describe("enable switch and consent", () => {
  it("cannot enable without the current consent version; records version and time; disabling keeps data", async () => {
    const m = await member("g-a", "甲");
    const res = await call(m, "PUT", "/v1/me/amway/enabled", { enabled: true });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("consent_required");
    expect((await call(m, "PUT", "/v1/me/amway/enabled", { enabled: true, consent_version: "1" })).status).toBe(403);
    expect((await put(m, "referrer", "王小明")).status).toBe(403);

    expect((await enable(m)).status).toBe(200);
    let s = await me(m);
    expect(s.enabled).toBe(true);
    expect(s.consent).toMatchObject({ version: "2", current: true });
    expect(db.raw.prepare("SELECT version, action FROM consent_records").all()).toEqual([{ version: "2", action: "accept" }]);

    expect((await put(m, "referrer", "王小明")).status).toBe(200);
    expect((await call(m, "PUT", "/v1/me/amway/enabled", { enabled: false })).status).toBe(200);
    s = await me(m);
    expect(s.enabled).toBe(false);
    expect(s.fields.referrer?.value).toBe("王小明");
    expect((await put(m, "referrer", "改")).status).toBe(403);
  });

  it("old consent versions must be accepted again", async () => {
    const m = await member("g-a", "甲");
    db.raw.prepare("UPDATE members SET amway_enabled = 1").run();
    db.raw.prepare("INSERT INTO consent_records (id, member_id, document, version, action, occurred_at) VALUES ('c1', ?, 'amway_data_sharing', '1', 'accept', '2026-01-01T00:00:00.000+08:00')").run(m.id);
    expect((await me(m)).consent).toMatchObject({ version: "1", current: false });
    expect(((await (await put(m, "referrer", "x")).json()) as { error: { code: string } }).error.code).toBe("consent_required");
  });
});

describe("fields and review", () => {
  it("non-reviewed fields apply at once; validation uses the option lists", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    let res = await put(m, "upline_diamond", { option: "d1", custom_text: null });
    expect(((await res.json()) as { status: string }).status).toBe("not_required");
    res = await put(m, "upline_platinum", { option: "other", custom_text: "  陳大華 " });
    expect(((await res.json()) as { value: unknown }).value).toEqual({ option: "other", custom_text: "陳大華" });
    for (const [k, v, reason] of [
      ["rank", "99", "not_an_option"],
      ["upline_platinum", { option: "other", custom_text: "" }, "custom_text_required"],
      ["education_center", "c_taipei", "not_applicable"],
      ["referrer", "x".repeat(51), "too_long"],
    ] as [string, unknown, string][]) {
      res = await put(m, k, v);
      expect(res.status, k).toBe(422);
      expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe(reason);
    }
    expect((await put(m, "amway_id", "1")).status).toBe(404);
  });

  it("choosing hglobal needs review; rank under hglobal keeps the old value while pending", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    let res = await put(m, "education_system", { option: "hglobal", custom_text: null });
    expect(await res.json()).toMatchObject({ value: null, pending_value: { option: "hglobal" }, status: "pending" });
    expect((await put(m, "education_center", "c_taipei")).status).toBe(200); // allowed while hglobal is pending
    res = await put(m, "rank", "12");
    expect(await res.json()).toMatchObject({ value: null, pending_value: "12", status: "pending" });
    expect((await pendingReviews(db)).map((r) => r.field_key).sort()).toEqual(["education_system", "rank"]);

    for (const r of await pendingReviews(db)) await decideReview(db, r.id, "approve", "staff-1", ctx());
    let s = await me(m);
    expect(s.fields.education_system).toMatchObject({ value: { option: "hglobal" }, status: "approved", pending_value: null });
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

  it("other education systems need no review and the rank is approved automatically", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    expect(await (await put(m, "education_system", { option: "sys_b", custom_text: null })).json()).toMatchObject({ status: "not_required", value: { option: "sys_b" } });
    expect(await (await put(m, "rank", "15")).json()).toMatchObject({ status: "not_required", value: "15" });
    expect(await pendingReviews(db)).toEqual([]);
  });

  it("re-sending the same value is idempotent; going back to the effective value cancels the pending change", async () => {
    const m = await member("g-a", "甲");
    await enable(m);
    await put(m, "education_system", { option: "hglobal", custom_text: null });
    await put(m, "education_system", { option: "hglobal", custom_text: null });
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
      await put(m, "education_system", { option: "sys_b", custom_text: null });
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
  it("review decisions", () => {
    const sys = getAmwayField("education_system")!;
    const rank = getAmwayField("rank")!;
    expect(needsReview(sys, { option: "hglobal", custom_text: null }, { effective: null, pending: null })).toBe(true);
    expect(needsReview(sys, { option: "other", custom_text: "x" }, { effective: null, pending: null })).toBe(false);
    expect(needsReview(rank, "12", { effective: "hglobal", pending: null })).toBe(true);
    expect(needsReview(rank, "12", { effective: null, pending: "hglobal" })).toBe(true);
    expect(needsReview(rank, "12", { effective: "sys_b", pending: null })).toBe(false);
    expect(needsReview(getAmwayField("upline_diamond")!, { option: "d1", custom_text: null }, { effective: "hglobal", pending: null })).toBe(false);
  });
  it("validation", () => {
    const sys = getAmwayField("education_system")!;
    expect(validateAmwayValue(sys, "hglobal", [{ value: "hglobal", label: "" }])).toMatchObject({ ok: false, reason: "type" });
    expect(validateAmwayValue(sys, null, [])).toEqual({ ok: true, value: null });
    expect(validateAmwayValue(getAmwayField("referrer")!, "a\u0007", [])).toMatchObject({ ok: false, reason: "invalid_characters" });
  });
});
