// Round-trip guard. The database can be an ocean away from the Worker (a visitor in Taiwan was served from Los Angeles while
// D1 is in Singapore, about 0.18 s per query), so the number of database calls per request must not grow with the number of rows.
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import type { Env } from "../src/env";
import { memberBriefs } from "../src/db/member-bulk";
import { staffContextByToken } from "../src/db/staff";

const ISSUER = "https://id.test.example";
let db: TestD1;
let calls = 0;
let env: Env;
let app: ReturnType<typeof createApp>;
const now = new Date();

/** Counts every awaited database call (a batch is one round trip). */
function counting(real: TestD1): D1Database {
  interface Stmt {
    bind: (...a: unknown[]) => Stmt;
    first: (...a: unknown[]) => unknown;
    all: (...a: unknown[]) => unknown;
    run: (...a: unknown[]) => unknown;
  }
  type Wrapped = Stmt & { inner: Stmt };
  const wrap = (st: Stmt): Wrapped => ({
    inner: st,
    bind: (...a: unknown[]) => wrap(st.bind(...a)),
    first: (...a: unknown[]) => (calls++, st.first(...a)),
    all: (...a: unknown[]) => (calls++, st.all(...a)),
    run: (...a: unknown[]) => (calls++, st.run(...a)),
  });
  return {
    prepare: (sql: string) => wrap(real.prepare(sql) as unknown as Stmt),
    batch: (list: Wrapped[]) => (calls++, real.batch(list.map((s) => s.inner ?? s) as never)),
  } as unknown as D1Database;
}

async function member(sub: string, name: string) {
  const { member: m } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name }, "TW", now, "req");
  return m;
}

beforeEach(() => {
  db = createTestD1();
  env = { DB: counting(db), ENVIRONMENT: "test", ISSUER } as unknown as Env;
  app = createApp({ now: () => now });
  calls = 0;
});

async function seed(n: number) {
  const boss = await member("boss", "管理員");
  const { token } = await createSession(db, boss.id, now);
  db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, 'super_admin', 'x')").run(boss.id);
  for (let i = 0; i < n; i++) {
    const m = await member("m" + i, "會員" + i);
    db.raw.prepare("UPDATE member_numbers SET number = ? WHERE member_id = ? AND position = 0").run("10000" + i, m.id);
    db.raw.prepare("INSERT INTO amway_review_requests (id, member_id, field_key, requested_value, status, created_at, decided_at, decided_by) VALUES (?, ?, 'rank', '\"12\"', ?, 'x', ?, ?)")
      .run("r" + i, m.id, i % 3 === 0 ? "pending" : "approved", "2026-01-01T00:00:0" + (i % 10) + "+08:00", boss.id);
  }
  return token;
}
const get = (cookie: string, path: string) => app.request(path, { headers: { cookie: `__Host-hgid_session=${cookie}` } }, env);

describe("database round trips do not grow with the number of rows", () => {
  for (const path of ["/v1/admin/reviews", "/v1/admin/reviews/history", "/v1/admin/members"]) {
    it(path, async () => {
      const few = await seed(2);
      calls = 0;
      expect((await get(few, path)).status).toBe(200);
      const small = calls;
      beforeEachReset();
      const many = await seed(40);
      calls = 0;
      expect((await get(many, path)).status).toBe(200);
      expect(calls).toBe(small);
      expect(small).toBeLessThanOrEqual(6);
    });
  }
  function beforeEachReset() {
    db = createTestD1();
    env = { DB: counting(db), ENVIRONMENT: "test", ISSUER } as unknown as Env;
  }

  it("a staff request authenticates with one round trip", async () => {
    const token = await seed(1);
    calls = 0;
    const found = await staffContextByToken(counting(db), token, now);
    expect(found?.roles).toEqual(["super_admin"]);
    expect(calls).toBe(1);
    expect(await staffContextByToken(counting(db), "wrong", now)).toBeNull();
  });

  it("memberBriefs returns name, numbers and Amway fields for many members at once", async () => {
    const a = await member("a", "甲");
    const b = await member("b", "乙");
    db.raw.prepare("DELETE FROM member_numbers WHERE member_id = ?").run(a.id);
    db.raw.prepare("INSERT INTO member_numbers (member_id, position, country, number, updated_at) VALUES (?, 1, 'TW', '222', 'x'), (?, 0, 'TW', '111', 'x')").run(a.id, a.id);
    db.raw.prepare("INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES (?, 'display_name', '\"暱稱乙\"', 'x')").run(b.id);
    calls = 0;
    const out = await memberBriefs(counting(db), [a.id, b.id, a.id, "nobody"]);
    expect(calls).toBe(1);
    expect(out.get(a.id)?.numbers.map((x) => x.number)).toEqual(["111", "222"]);
    expect(out.get(a.id)?.display_name).toBe("甲");
    expect(out.get(b.id)?.display_name).toBe("暱稱乙");
    expect(out.get("nobody")?.member).toBeNull();
  });
});
