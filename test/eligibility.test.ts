import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";
import { decideReview, pendingReviews } from "../src/db/amway";
import { evaluate } from "../src/eligibility/rules";

const ISSUER = "https://id.test.example";
const ALL = "openid profile.read profile.basic.write amway.read amway.write";

const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "elig-test" });
})();

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
interface M {
  id: string;
  token: string;
}
const ctx = () => ({ appId: null, requestId: "req", now: new Date() });

async function member(sub: string, scope = ALL): Promise<M> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name: sub }, "TW", new Date(), "req");
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
  opt.run("education_system", "sys_b", "B", 20);
  opt.run("rank", "12a", "12%初階", 10);
  opt.run("rank", "12", "12%", 20);
  opt.run("rank", "15", "15%", 30);
});

const call = (m: M, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { authorization: `Bearer ${m.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }, env);
const put = (m: M, path: string, body: unknown) =>
  app.request(path, { method: "PUT", headers: { authorization: `Bearer ${m.token}`, "content-type": "application/json" }, body: JSON.stringify(body) }, env);
const check = async (m: M, rule: unknown) => (await (await call(m, "/v1/eligibility/check", { rule })).json()) as { allowed: boolean; reason: string };

/** Enabled, hglobal approved, rank approved. */
async function verifiedMember(sub: string, rank: string): Promise<M> {
  const m = await member(sub);
  await put(m, "/v1/me/amway/enabled", { enabled: true });
  await put(m, "/v1/me/amway/fields/education_system", { value: "寰宇" });
  await put(m, "/v1/me/amway/fields/rank", { value: rank });
  for (const r of await pendingReviews(db)) await decideReview(db, r.id, "approve", "staff", ctx());
  return m;
}

describe("POST /v1/eligibility/check", () => {
  it("everyone is always allowed", async () => {
    const m = await member("plain");
    expect(await check(m, { audience: "everyone" })).toEqual({ allowed: true, reason: "ok" });
  });

  it("hglobal_verified needs the Amway area on and an approved hglobal education system", async () => {
    const m = await member("a");
    expect(await check(m, { audience: "hglobal_verified" })).toEqual({ allowed: false, reason: "amway_disabled" });
    await put(m, "/v1/me/amway/enabled", { enabled: true });
    expect(await check(m, { audience: "hglobal_verified" })).toEqual({ allowed: false, reason: "not_verified" });
    await put(m, "/v1/me/amway/fields/education_system", { value: "寰宇" });
    expect(await check(m, { audience: "hglobal_verified" })).toEqual({ allowed: false, reason: "not_verified" }); // pending review
    for (const r of await pendingReviews(db)) await decideReview(db, r.id, "approve", "staff", ctx());
    expect(await check(m, { audience: "hglobal_verified" })).toEqual({ allowed: true, reason: "ok" });
    // Unticking pauses eligibility at once.
    await put(m, "/v1/me/amway/enabled", { enabled: false });
    expect(await check(m, { audience: "hglobal_verified" })).toEqual({ allowed: false, reason: "amway_disabled" });
  });

  it("other education systems are not verified even if their rank was auto-approved", async () => {
    const m = await member("b");
    await put(m, "/v1/me/amway/enabled", { enabled: true });
    await put(m, "/v1/me/amway/fields/education_system", { value: "其他體系B" });
    await put(m, "/v1/me/amway/fields/rank", { value: "15" });
    expect(await check(m, { audience: "hglobal_verified", min_rank: "12a" })).toEqual({ allowed: false, reason: "not_verified" });
  });

  it("min_rank is backward compatible (higher ranks see lower-rank content); 12% and 12%初階 are separate levels", async () => {
    const m = await verifiedMember("c", "12");
    expect(await check(m, { audience: "hglobal_verified", min_rank: "12a" })).toEqual({ allowed: true, reason: "ok" });
    expect(await check(m, { audience: "hglobal_verified", min_rank: "12" })).toEqual({ allowed: true, reason: "ok" });
    expect(await check(m, { audience: "hglobal_verified", min_rank: "15" })).toEqual({ allowed: false, reason: "rank_too_low" });
  });

  it("a rank still pending review does not count", async () => {
    const m = await verifiedMember("d", "12");
    await put(m, "/v1/me/amway/fields/rank", { value: "15" });
    expect(await check(m, { audience: "hglobal_verified", min_rank: "15" })).toEqual({ allowed: false, reason: "rank_too_low" });
    expect(await check(m, { audience: "hglobal_verified", min_rank: "12" })).toEqual({ allowed: true, reason: "ok" });
  });

  it("after a rejected rank change the old approved rank still counts", async () => {
    const m = await verifiedMember("d2", "12");
    await put(m, "/v1/me/amway/fields/rank", { value: "15" });
    for (const r of await pendingReviews(db)) await decideReview(db, r.id, "reject", "staff", ctx());
    expect(await check(m, { audience: "hglobal_verified", min_rank: "12" })).toEqual({ allowed: true, reason: "ok" });
    expect(await check(m, { audience: "hglobal_verified", min_rank: "15" })).toEqual({ allowed: false, reason: "rank_too_low" });
  });

  it("an approved hglobal stays verified while a change back to hglobal is re-sent", async () => {
    const m = await verifiedMember("d3", "12");
    await put(m, "/v1/me/amway/fields/education_system", { value: "寰宇" });
    expect(await check(m, { audience: "hglobal_verified" })).toEqual({ allowed: true, reason: "ok" });
  });

  it("unknown or retired rank codes fail closed", async () => {
    const m = await verifiedMember("e", "15");
    expect(await check(m, { audience: "hglobal_verified", min_rank: "nope" })).toEqual({ allowed: false, reason: "rank_too_low" });
    db.raw.prepare("UPDATE amway_options SET active = 0 WHERE field_key = 'rank' AND value = '15'").run();
    expect(await check(m, { audience: "hglobal_verified", min_rank: "12" })).toEqual({ allowed: false, reason: "rank_too_low" });
  });

  it("rejects bad rules, tokens and scopes", async () => {
    const m = await member("f");
    for (const rule of [{ audience: "everyone", min_rank: "12" }, { audience: "vip" }, { audience: "everyone", extra: 1 }, null]) {
      const res = await call(m, "/v1/eligibility/check", { rule });
      expect(res.status, JSON.stringify(rule)).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_field");
    }
    const res = await app.request("/v1/eligibility/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rule: { audience: "everyone" } }) }, env);
    expect(res.status).toBe(401);
    const noScope = await member("g", "openid profile.read");
    expect((await call(noScope, "/v1/eligibility/check", { rule: { audience: "everyone" } })).status).toBe(403);
  });

  it("disabled members and ended sessions are refused", async () => {
    const m = await verifiedMember("h", "15");
    db.raw.prepare("UPDATE members SET status = 'disabled' WHERE id = ?").run(m.id);
    expect((await call(m, "/v1/eligibility/check", { rule: { audience: "hglobal_verified" } })).status).toBe(401);
  });
});

describe("POST /v1/eligibility/check-batch", () => {
  it("answers up to 50 rules in order", async () => {
    const m = await verifiedMember("i", "12");
    const res = await call(m, "/v1/eligibility/check-batch", {
      rules: [{ audience: "everyone" }, { audience: "hglobal_verified", min_rank: "15" }, { audience: "hglobal_verified", min_rank: "12a" }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { results: unknown[] }).results).toEqual([
      { allowed: true, reason: "ok" },
      { allowed: false, reason: "rank_too_low" },
      { allowed: true, reason: "ok" },
    ]);
    expect((await call(m, "/v1/eligibility/check-batch", { rules: Array.from({ length: 51 }, () => ({ audience: "everyone" })) })).status).toBe(422);
    expect((await call(m, "/v1/eligibility/check-batch", { rules: [] })).status).toBe(422);
  });
});

describe("spouses share rank for eligibility", () => {
  it("a bound spouse's approved rank counts for both", async () => {
    const a = await verifiedMember("sa", "12a");
    const b = await verifiedMember("sb", "15");
    const bNumber = db.raw.prepare("SELECT country, number FROM member_numbers WHERE member_id = ?").get(b.id);
    const dup = (await (await put(a, "/v1/me/profile/fields/member_number", { value: [bNumber] })).json()) as { duplicate_candidates: { candidate_id: string }[] };
    const spouseToken = await issueTokens(env, defaultDeps, ISSUER, {
      clientId: "elearning",
      memberId: a.id,
      sessionId: (await createSession(db, a.id, new Date())).session.id,
      scope: `${ALL} profile.spouse.write`,
      authTime: 0,
    });
    const bindRes = await app.request("/v1/me/spouse", { method: "POST", headers: { authorization: `Bearer ${spouseToken.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ candidate_id: dup.duplicate_candidates[0]?.candidate_id }) }, env);
    expect(bindRes.status).toBe(200);
    expect(await check(a, { audience: "hglobal_verified", min_rank: "15" })).toEqual({ allowed: true, reason: "ok" });
  });
});

describe("rules (unit)", () => {
  const ladder = new Map([["a", 1], ["b", 2]]);
  it("fails closed without member data", () => {
    expect(evaluate({ audience: "hglobal_verified" }, null, ladder)).toEqual({ allowed: false, reason: "amway_disabled" });
    expect(evaluate({ audience: "everyone" }, null, ladder)).toEqual({ allowed: true, reason: "ok" });
    expect(evaluate({ audience: "hglobal_verified", min_rank: "a" }, { amwayActive: true, hglobalVerified: true, approvedRank: null }, ladder)).toEqual({ allowed: false, reason: "rank_too_low" });
    expect(evaluate({ audience: "hglobal_verified", min_rank: "a" }, { amwayActive: true, hglobalVerified: true, approvedRank: "b" }, ladder)).toEqual({ allowed: true, reason: "ok" });
  });
});
