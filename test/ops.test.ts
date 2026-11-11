import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import type { Env } from "../src/env";
import { runCleanup } from "../src/jobs/cleanup";
import { isWrite } from "../src/lib/ratelimit";
import worker from "../src/index";

const ISSUER = "https://id.test.example";
let db: TestD1;
let now = new Date("2026-11-10T00:00:00Z");

beforeEach(() => {
  db = createTestD1();
  now = new Date("2026-11-10T00:00:00Z");
});

async function signedIn(_env: Env) {
  const { member } = await upsertMemberByGoogle(db, { sub: "a", emailVerified: true, name: "甲" }, "TW", now, "req");
  const { token } = await createSession(db, member.id, now);
  return { id: member.id, cookie: `__Host-hgid_session=${token}` };
}

describe("rate limits", () => {
  it("uses the write limiter for changes and the read limiter for queries, keyed by member", async () => {
    const keys: string[] = [];
    let allow = true;
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: allow }) };
    const env: Env = { DB: db, ENVIRONMENT: "test", ISSUER, RL_READ: limiter, RL_WRITE: limiter };
    const app = createApp({ now: () => now });
    const m = await signedIn(env);
    const h = { cookie: m.cookie, origin: ISSUER, "content-type": "application/json" };
    expect((await app.request("/v1/me/profile", { headers: h }, env)).status).toBe(200);
    expect((await app.request("/v1/me/profile/fields/motto", { method: "PUT", headers: h, body: JSON.stringify({ value: "x" }) }, env)).status).toBe(200);
    expect(keys).toEqual([`r:${m.id}`, `w:${m.id}`]);
    allow = false;
    const res = await app.request("/v1/me/profile", { headers: h }, env);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  });

  it("eligibility checks count as queries", () => {
    expect(isWrite("POST", "/v1/eligibility/check")).toBe(false);
    expect(isWrite("PUT", "/v1/me/amway/fields/rank")).toBe(true);
    expect(isWrite("GET", "/v1/me/amway")).toBe(false);
  });

  it("a broken limiter does not take the service down", async () => {
    const broken = { limit: async () => Promise.reject(new Error("down")) };
    const env: Env = { DB: db, ENVIRONMENT: "test", ISSUER, RL_READ: broken, RL_WRITE: broken };
    const m = await signedIn(env);
    expect((await createApp({ now: () => now }).request("/v1/me/profile", { headers: { cookie: m.cookie } }, env)).status).toBe(200);
  });
});

describe("daily cleanup", () => {
  const audit = (id: string, action: string, at: string) =>
    db.raw.prepare("INSERT INTO audit_log (id, occurred_at, actor_type, actor_id, action, target_type, target_id, result) VALUES (?, ?, 'member', ?, ?, 'member', ?, 'success')").run(`${action}-${at}`, at, id, action, id);
  const amwayRow = (id: string) =>
    db.raw.prepare("INSERT INTO amway_field_values (member_id, field_key, value, status, updated_at) VALUES (?, 'referrer', '\"王\"', 'not_required', 'x')").run(id);

  it("removes Amway data one year after the area was turned off, not before, and not if turned back on", async () => {
    const make = async (sub: string) => (await upsertMemberByGoogle(db, { sub, emailVerified: true }, "TW", now, "req")).member.id;
    const old = await make("old");
    const recent = await make("recent");
    const back = await make("back");
    for (const id of [old, recent, back]) amwayRow(id);
    audit(old, "amway.disable", "2025-11-01T00:00:00.000+08:00");
    audit(recent, "amway.disable", "2026-06-01T00:00:00.000+08:00");
    audit(back, "amway.disable", "2025-01-01T00:00:00.000+08:00");
    audit(back, "amway.enable", "2025-02-01T00:00:00.000+08:00");
    db.raw.prepare("UPDATE members SET amway_enabled = 1 WHERE id = ?").run(back);

    const r = await runCleanup(db, now);
    expect(r.purgedMembers).toBe(1);
    const left = db.raw.prepare("SELECT member_id FROM amway_field_values ORDER BY member_id").all().map((x) => x.member_id);
    expect(left.sort()).toEqual([recent, back].sort());
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'amway.retention.purge'").get()?.n).toBe(1);
  });

  it("removes expired sign-in flows and codes", async () => {
    db.raw.prepare("INSERT INTO login_flows (id, browser_hash, return_to, expires_epoch, created_at) VALUES ('f1', 'h', '/', 1, 'x')").run();
    db.raw.prepare("INSERT INTO login_flows (id, browser_hash, return_to, expires_epoch, created_at) VALUES ('f2', 'h', '/', 9999999999, 'x')").run();
    await runCleanup(db, now);
    expect(db.raw.prepare("SELECT id FROM login_flows").all().map((x) => x.id)).toEqual(["f2"]);
  });

  it("the Worker exports fetch and a scheduled handler", () => {
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.scheduled).toBe("function");
  });
});
