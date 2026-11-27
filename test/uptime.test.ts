import { describe, it, expect } from "vitest";
import { FAILURES_BEFORE_ALERT, isProbeDue, nextState } from "../src/platform/uptime";
import { bodyOf } from "../src/webhooks/events";
import { runUptime } from "../src/jobs/uptime";
import { createTestD1 } from "./helpers/d1.mjs";
import { saveEcoSettings } from "../src/db/eco-features";
import { ECO_CATALOG } from "../src/platform/eco-features";

describe("網站巡檢規則", () => {
  it("到了設定的頻率才巡檢（容許 30 秒誤差），沒巡檢過就立刻巡檢", () => {
    expect(isProbeDue(15, null, 1000)).toBe(true);
    expect(isProbeDue(15, 1000, 1000 + 15 * 60 - 31)).toBe(false);
    expect(isProbeDue(15, 1000, 1000 + 15 * 60 - 30)).toBe(true);
  });

  it("連續失敗達門檻才通知，掛了只通知一次，恢復通知一次", () => {
    let st = nextState(null, { ok: true, note: "HTTP 200" });
    expect(st).toEqual({ state: { status: "up", consecutive_failures: 0 }, alert: null });
    st = nextState(st.state, { ok: false, note: "逾時" });
    expect(st.alert).toBeNull();
    expect(FAILURES_BEFORE_ALERT).toBe(2);
    st = nextState(st.state, { ok: false, note: "逾時" });
    expect(st).toEqual({ state: { status: "down", consecutive_failures: 2 }, alert: "down" });
    st = nextState(st.state, { ok: false, note: "逾時" });
    expect(st.alert).toBeNull();
    st = nextState(st.state, { ok: true, note: "HTTP 200" });
    expect(st).toEqual({ state: { status: "up", consecutive_failures: 0 }, alert: "recovered" });
  });
});

describe("網站巡檢工作", () => {
  const sa = "m-admin";
  function setup() {
    const db = createTestD1();
    db.raw.prepare("INSERT INTO members (id, google_sub, status, created_at, updated_at) VALUES (?, 'g-admin', 'active', 'x', 'x')").run(sa);
    db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, 'super_admin', 'x')").run(sa);
    db.raw.prepare("INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES (?, 'contact_email', ?, 'x')").run(sa, JSON.stringify("boss@example.com"));
    return db;
  }
  const settings = { ...ECO_CATALOG.uptime_watch.defaults, interval_minutes: 5 as const, sites: [{ name: "行動大學", url: "https://learn.hglobal1985.com/api/v2/version" }] };

  it("掛了（連續 2 次）寄信並留站內通知，恢復再通知；頻率沒到不巡檢", async () => {
    const db = setup();
    await saveEcoSettings(db, "uptime_watch", settings, { memberId: sa, requestId: "r" }, new Date());
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer = { from: "n@x", name: "會員中心", binding: { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) } };
    let up = false;
    const fetcher = async () => new Response("x", { status: up ? 200 : 503 });
    const t0 = new Date("2026-11-28T00:00:00Z");
    expect(await runUptime(db, mailer, fetcher, t0)).toBe(1);
    expect(await runUptime(db, mailer, fetcher, new Date(t0.getTime() + 60_000))).toBe(0); // 頻率沒到
    expect(sent).toHaveLength(0);
    expect(await runUptime(db, mailer, fetcher, new Date(t0.getTime() + 5 * 60_000))).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "boss@example.com", subject: "網站巡檢：有網站打不開" });
    expect(sent[0]?.text).toContain("行動大學");
    expect(await runUptime(db, mailer, fetcher, new Date(t0.getTime() + 10 * 60_000))).toBe(1);
    expect(sent).toHaveLength(1); // 掛了只通知一次
    up = true;
    await runUptime(db, mailer, fetcher, new Date(t0.getTime() + 15 * 60_000));
    expect(sent).toHaveLength(2);
    expect(sent[1]?.subject).toBe("網站巡檢：網站已恢復");
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'eco.uptime'").get()).toEqual({ n: 2 });
    expect(db.raw.prepare("SELECT status FROM eco_uptime_state").get()).toEqual({ status: "up" });
  });

  it("功能關閉時完全不巡檢；沒綁寄信服務時只留站內通知", async () => {
    const db = setup();
    await saveEcoSettings(db, "uptime_watch", { ...settings, enabled: false }, { memberId: sa, requestId: "r" }, new Date());
    let calls = 0;
    const fetcher = async () => { calls++; return new Response("x", { status: 503 }); };
    expect(await runUptime(db, undefined, fetcher, new Date())).toBe(0);
    expect(calls).toBe(0);
    await saveEcoSettings(db, "uptime_watch", settings, { memberId: sa, requestId: "r" }, new Date());
    const t0 = new Date("2026-11-28T00:00:00Z");
    await runUptime(db, undefined, fetcher, t0);
    await runUptime(db, undefined, fetcher, new Date(t0.getTime() + 5 * 60_000));
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'eco.uptime'").get()).toEqual({ n: 1 });
  });

  it("掛了與恢復時對有 webhook、管理員用過、沒選擇不參與的 App 送 eco.alert（不含個資）", async () => {
    const db = setup();
    db.raw.prepare("INSERT INTO app_webhooks (app_id, url, secret_version, enabled, created_at, updated_at) VALUES ('learn', 'https://learn.example.com/w', 1, 1, 'x', 'x'), ('check', 'https://check.example.com/w', 1, 1, 'x', 'x'), ('noapp', 'https://n.example.com/w', 1, 1, 'x', 'x')").run();
    db.raw.prepare("INSERT INTO eco_feature_apps (feature_key, app_id, participating, updated_at) VALUES ('uptime_watch', 'check', 0, 'x')").run();
    for (const a of ["learn", "check"]) db.raw.prepare("INSERT INTO member_apps (member_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, 'x', 'x')").run(sa, a);
    await saveEcoSettings(db, "uptime_watch", settings, { memberId: sa, requestId: "r" }, new Date());
    let up = false;
    const fetcher = async () => new Response("x", { status: up ? 200 : 503 });
    const t0 = new Date("2026-11-28T00:00:00Z");
    await runUptime(db, undefined, fetcher, t0);
    await runUptime(db, undefined, fetcher, new Date(t0.getTime() + 5 * 60_000));
    up = true;
    await runUptime(db, undefined, fetcher, new Date(t0.getTime() + 10 * 60_000));
    const rows = db.raw.prepare("SELECT app_id, member_id, type, detail FROM webhook_events ORDER BY created_at").all() as { app_id: string; member_id: string; type: string; detail: string }[];
    expect(rows.map((r) => [r.app_id, r.member_id, r.type])).toEqual([["learn", sa, "eco.alert"], ["learn", sa, "eco.alert"]]);
    expect(JSON.parse(rows[0]!.detail)).toMatchObject({ name: "行動大學", alert: "down" });
    expect(JSON.parse(rows[1]!.detail)).toMatchObject({ alert: "recovered" });
    expect(bodyOf({ id: "e", type: "eco.alert", created_at: "t", app_id: "learn", member_id: sa, fields: null, detail: rows[0]!.detail })).toContain('"detail":{"name":"行動大學"');
  });
});
