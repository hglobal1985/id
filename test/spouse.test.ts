import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";
import { generateMemberNumber, mergeForSpouses, randomDigit, validateMemberNumbers, whoGetsNewNumber } from "../src/profile/member-number";

const ISSUER = "https://id.test.example";
const ALL = "openid profile profile.read profile.basic.write profile.spouse.write";

const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "spouse-test" });
})();

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;

interface M {
  id: string;
  token: string;
}

async function member(sub: string, name: string, country = "TW", scope = ALL): Promise<M> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name }, country, new Date(), "req");
  const { session } = await createSession(db, member.id, new Date());
  const t = await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId: member.id, sessionId: session.id, scope, authTime: Math.floor(Date.now() / 1000) });
  return { id: member.id, token: t.access_token };
}

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk };
  app = createApp();
  db.raw
    .prepare(
      `INSERT INTO oauth_clients (client_id, name, client_secret_hash, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at)
       VALUES ('elearning', 'elearning', NULL, 'none', '[]', ?, 'active', 'x', 'x')`,
    )
    .run(ALL);
});

const call = async (m: M, method: string, path: string, body?: unknown) =>
  app.request(
    path,
    {
      method,
      headers: { authorization: `Bearer ${m.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    env,
  );

type Entry = { country: string; number: string };
const numbersOf = (id: string) =>
  db.raw.prepare("SELECT country, number FROM member_numbers WHERE member_id = ? ORDER BY position").all(id).map((r) => ({ country: r.country, number: r.number })) as Entry[];
const setNumbers = (m: M, value: Entry[]) => call(m, "PUT", "/v1/me/profile/fields/member_number", { value });

describe("member number", () => {
  it("every new member gets a random number from the sign-up country", async () => {
    const a = await member("g-a", "甲", "JP");
    expect(numbersOf(a.id)).toEqual([{ country: "JP", number: expect.stringMatching(/^JP0\d{6}$/) }]);
    const p = (await (await call(a, "GET", "/v1/me/profile")).json()) as { fields: { member_number: { value: Entry[]; label: string; max_items: number; public_url: string; visibility: string } } };
    expect(p.fields.member_number.label).toBe("會員編號");
    expect(p.fields.member_number.max_items).toBe(1);
    expect(p.fields.member_number.visibility).toBe("public");
    expect(p.fields.member_number.public_url).toBe(`${ISSUER}/${numbersOf(a.id)[0]?.number}`);
  });

  it("allows one entry normally and up to 50 for Amway members, normalized", async () => {
    const a = await member("g-a", "甲");
    let res = await setNumbers(a, [{ country: "TW", number: "111" }, { country: "JP", number: "222" }]);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("too_many");
    db.raw.prepare("UPDATE members SET amway_enabled = 1").run();
    res = await setNumbers(a, [{ country: "tw", number: " ab-12 " }, { country: "JP", number: "222" }]);
    expect(res.status).toBe(200);
    expect(numbersOf(a.id)).toEqual([{ country: "TW", number: "AB-12" }, { country: "JP", number: "222" }]);
    const p = (await (await call(a, "GET", "/v1/me/profile")).json()) as { fields: { member_number: { label: string; max_items: number } } };
    expect(p.fields.member_number).toMatchObject({ label: "Amway會員編號", max_items: 50 });
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ country: "TW", number: String(1000 + i) }));
    expect((await setNumbers(a, tooMany)).status).toBe(422);
    for (const bad of [[{ country: "ZZ", number: "1" }], [{ country: "TW", number: "a b/c" }], [], [{ country: "TW", number: "1" }, { country: "TW", number: "1" }]]) {
      expect((await setNumbers(a, bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it("limits self-service changes to 3 per 24 hours; re-saving the same list is free", async () => {
    const a = await member("g-a", "甲");
    for (const n of ["1", "2", "3"]) expect((await setNumbers(a, [{ country: "TW", number: n }])).status).toBe(200);
    expect((await setNumbers(a, [{ country: "TW", number: "3" }])).status).toBe(200);
    const res = await setNumbers(a, [{ country: "TW", number: "4" }]);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  });

  it("the limit names the field and says when it can be changed again; a super administrator is not held to it", async () => {
    const a = await member("g-a", "甲");
    for (const n of ["1", "2", "3"]) await setNumbers(a, [{ country: "TW", number: n }]);
    const res = await setNumbers(a, [{ country: "TW", number: "4" }]);
    const err = ((await res.json()) as { error: { message: string; details: { field_key: string; retry_after: number } } }).error;
    expect(err.details.field_key).toBe("member_number");
    expect(err.details.retry_after).toBeGreaterThan(0);
    expect(err.message).toContain("3 次");
    const boss = await member("g-boss", "超管");
    db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, 'super_admin', 'x')").run(boss.id);
    for (const n of ["11", "12", "13", "14", "15"]) expect((await setNumbers(boss, [{ country: "TW", number: n }])).status, n).toBe(200);
  });

  it("allows duplicates and reports the other member as a spouse candidate (name shown, no member id)", async () => {
    const a = await member("g-a", "甲");
    const b = await member("g-b", "乙");
    const bNumber = numbersOf(b.id)[0] as Entry;
    const res = await setNumbers(a, [bNumber]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { duplicate_candidates: { candidate_id: string; display_name: string; rank: null; matched: Entry }[] };
    expect(body.duplicate_candidates).toHaveLength(1);
    expect(body.duplicate_candidates[0]).toMatchObject({ display_name: "乙", rank: null, matched: bNumber });
    expect(JSON.stringify(body)).not.toContain(b.id);
    expect(numbersOf(a.id)).toEqual(numbersOf(b.id));
  });

  it("member_number visibility cannot be changed", async () => {
    const a = await member("g-a", "甲", "TW", `${ALL} profile.visibility.write`);
    expect((await call(a, "PUT", "/v1/me/profile/visibility", { fields: { member_number: "private" } })).status).toBe(422);
  });
});

async function bindAtoB() {
  const a = await member("g-a", "甲");
  const b = await member("g-b", "乙");
  const shared = numbersOf(b.id)[0] as Entry;
  const dup = (await (await setNumbers(a, [shared])).json()) as { duplicate_candidates: { candidate_id: string }[] };
  const res = await call(a, "POST", "/v1/me/spouse", { candidate_id: dup.duplicate_candidates[0]?.candidate_id });
  expect(res.status).toBe(200);
  return { a, b, shared, res };
}

describe("spouse binding", () => {
  it("binds at once with single-sided consent and notifies the bound member", async () => {
    const { a, b, shared, res } = await bindAtoB();
    expect(((await res.json()) as { spouse: { display_name: string; bound_by_me: boolean } }).spouse).toMatchObject({ display_name: "乙", bound_by_me: true });
    const bView = (await (await call(b, "GET", "/v1/me/spouse")).json()) as { spouse: { display_name: string; bound_by_me: boolean } };
    expect(bView.spouse).toMatchObject({ display_name: "甲", bound_by_me: false });
    expect(db.raw.prepare("SELECT kind FROM notifications WHERE member_id = ?").all(b.id).map((r) => r.kind)).toEqual(["spouse.bound"]);
    expect(numbersOf(a.id)).toEqual([shared]);
    expect(numbersOf(b.id)).toEqual([shared]);
  });

  it("couples share one number list; the spouse is not reported as a duplicate", async () => {
    const { a, b } = await bindAtoB();
    db.raw.prepare("UPDATE members SET amway_enabled = 1 WHERE id = ?").run(a.id);
    const res = await setNumbers(a, [{ country: "TW", number: "777" }, { country: "MY", number: "888" }]);
    expect(((await res.json()) as { duplicate_candidates: unknown[] }).duplicate_candidates).toEqual([]);
    expect(numbersOf(b.id)).toEqual([{ country: "TW", number: "777" }, { country: "MY", number: "888" }]);
  });

  it("at most one spouse: spouse_already_bound", async () => {
    const { a } = await bindAtoB();
    const c = await member("g-c", "丙");
    const dup = (await (await setNumbers(c, [numbersOf(a.id)[0] as Entry])).json()) as { duplicate_candidates: { candidate_id: string }[] };
    expect(dup.duplicate_candidates.length).toBeGreaterThan(0);
    const res = await call(c, "POST", "/v1/me/spouse", { candidate_id: dup.duplicate_candidates[0]?.candidate_id });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("spouse_already_bound");
  });

  it("candidate ids only work for the member they were issued to, and require a shared number", async () => {
    const a = await member("g-a", "甲");
    const b = await member("g-b", "乙");
    const c = await member("g-c", "丙");
    const dup = (await (await setNumbers(a, [numbersOf(b.id)[0] as Entry])).json()) as { duplicate_candidates: { candidate_id: string }[] };
    const id = dup.duplicate_candidates[0]?.candidate_id;
    expect((await call(c, "POST", "/v1/me/spouse", { candidate_id: id })).status).toBe(404);
    await setNumbers(a, [{ country: "TW", number: "999" }]);
    expect((await call(a, "POST", "/v1/me/spouse", { candidate_id: id })).status).toBe(404);
    expect((await call(a, "POST", "/v1/me/spouse", { candidate_id: "x".repeat(32) })).status).toBe(404);
  });

  it("either side can unbind; the member who started the binding gets a new random number", async () => {
    for (const unbinder of ["a", "b"] as const) {
      db = createTestD1();
      env = { ...env, DB: db };
      db.raw
        .prepare(
          `INSERT INTO oauth_clients (client_id, name, client_secret_hash, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at)
           VALUES ('elearning', 'elearning', NULL, 'none', '[]', ?, 'active', 'x', 'x')`,
        )
        .run(ALL);
      const { a, b, shared } = await bindAtoB();
      const res = await call(unbinder === "a" ? a : b, "DELETE", "/v1/me/spouse");
      expect(res.status).toBe(200);
      expect(numbersOf(b.id)).toEqual([shared]);
      const aNow = numbersOf(a.id);
      expect(aNow).toHaveLength(1);
      expect(aNow[0]?.number).toMatch(/^TW0\d{6}$/);
      expect(aNow[0]?.number).not.toBe(shared.number);
      expect(((await (await call(a, "GET", "/v1/me/spouse")).json()) as { spouse: null }).spouse).toBeNull();
      expect((await call(b, "DELETE", "/v1/me/spouse")).status).toBe(404);
    }
  });

  it("needs profile.spouse.write", async () => {
    const a = await member("g-a", "甲", "TW", "openid profile.read profile.basic.write");
    expect((await call(a, "POST", "/v1/me/spouse", { candidate_id: "x".repeat(32) })).status).toBe(403);
    expect((await call(a, "DELETE", "/v1/me/spouse")).status).toBe(403);
    expect((await call(a, "GET", "/v1/me/spouse")).status).toBe(200);
  });
});

describe("member number rules (unit)", () => {
  it("random digits use rejection sampling", () => {
    const bytes = [250, 251, 255, 7];
    let i = 0;
    expect(randomDigit((n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length] as number))).toBe(7);
  });
  it("grows from 7 to 8 digits when the space is crowded, and falls back to TW", async () => {
    let calls = 0;
    const e = await generateMemberNumber("TW", async () => ++calls <= 8);
    expect(e.number).toMatch(/^TW0\d{7}$/);
    expect((await generateMemberNumber("??", async () => false)).country).toBe("TW");
  });
  it("merges a couple's lists with the matched number first", () => {
    const m = { country: "TW", number: "1" };
    expect(mergeForSpouses(m, [{ country: "TW", number: "2" }, m], [m, { country: "JP", number: "3" }], 50)).toEqual([
      m,
      { country: "TW", number: "2" },
      { country: "JP", number: "3" },
    ]);
    expect(mergeForSpouses(m, [{ country: "TW", number: "2" }], [], 1)).toEqual([m]);
  });
  it("the binder is renumbered on unbind; lists are validated", () => {
    expect(whoGetsNewNumber({ initiator_id: "a", partner_id: "b" })).toBe("a");
    expect(validateMemberNumbers("x", 1)).toMatchObject({ ok: false, reason: "type" });
  });
});
