import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";
import { can, permissionsOf } from "../src/admin/roles";

const ISSUER = "https://id.test.example";
const APP_SCOPE = "openid profile.read profile.basic.write amway.read amway.write";

const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "admin-test" });
})();

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
let now = new Date();

interface P {
  id: string;
  cookie: string;
  token: string;
}

async function person(sub: string, name: string, roles: string[] = []): Promise<P> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name }, "TW", now, "req");
  const { token: cookie, session } = await createSession(db, member.id, now);
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  const t = await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId: member.id, sessionId: session.id, scope: APP_SCOPE, authTime: 0 });
  return { id: member.id, cookie, token: t.access_token };
}

beforeEach(() => {
  now = new Date();
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk };
  app = createApp({ now: () => now });
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning','e','none','[]',?, 'active','x','x')").run(APP_SCOPE);
  // Replace the migration-seeded rank ladder with a small fixture ladder.
  db.raw.prepare("DELETE FROM amway_options WHERE field_key = 'rank'").run();
  const opt = db.raw.prepare("INSERT INTO amway_options (field_key, value, label, sort_order) VALUES (?, ?, ?, ?)");
  opt.run("rank", "12", "12%", 20);
  opt.run("rank", "15", "15%", 30);
});

const admin = (p: P | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(
    path,
    {
      method,
      headers: {
        ...(p ? { cookie: `__Host-hgid_session=${p.cookie}` } : {}),
        ...(method !== "GET" ? { origin: ISSUER } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    env,
  );

const member = (p: P, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { authorization: `Bearer ${p.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }, env);

async function amwayMember(sub: string, name: string): Promise<P> {
  const p = await person(sub, name);
  await member(p, "PUT", "/v1/me/amway/enabled", { enabled: true });
  return p;
}

describe("access control", () => {
  it("needs a central session and a staff role; app tokens are not accepted", async () => {
    expect((await admin(null, "GET", "/v1/admin/me")).status).toBe(401);
    const m = await person("m", "會員");
    expect((await admin(m, "GET", "/v1/admin/me")).status).toBe(403);
    const r = await app.request("/v1/admin/me", { headers: { authorization: `Bearer ${m.token}` } }, env);
    expect(r.status).toBe(401);
    const rv = await person("rv", "審核員", ["reviewer"]);
    const me = (await (await admin(rv, "GET", "/v1/admin/me")).json()) as { roles: { label: string }[]; permissions: string[] };
    expect(me.roles[0]?.label).toBe("審核員");
    expect(me.permissions).toEqual(["review", "members.read"]); // reviewers review; only the head office changes members
  });

  it("refuses cross-site state changes", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const body = { order: null };
    expect((await admin(sa, "PUT", "/v1/admin/profile-layout", body, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await app.request("/v1/admin/profile-layout", { method: "PUT", headers: { cookie: `__Host-hgid_session=${sa.cookie}`, "content-type": "application/json" }, body: JSON.stringify(body) }, env);
    expect(noOrigin.status).toBe(403);
    expect((await admin(sa, "PUT", "/v1/admin/profile-layout", body)).status).toBe(200);
  });

  it("role matrix", () => {
    expect(can(["reviewer"], "vocab.manage")).toBe(false);
    expect(can(["secretary"], "layout.manage")).toBe(false);
    expect(can(["secretary"], "vocab.manage")).toBe(false);
    expect(can(["super_admin"], "vocab.manage")).toBe(true);
    expect(can(["secretary"], "staff.manage")).toBe(false);
    expect(can(["reviewer", "secretary"], "audit.read")).toBe(true);
    expect(permissionsOf(["nope"])).toEqual([]);
  });
});

describe("reviews", () => {
  /** Gives a staff member a saved (approved) regional center, as a reviewer's own profile does. */
  const setCenter = (id: string, center: string) =>
    db.raw.prepare("INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at) VALUES (?, 'education_center', ?, NULL, 'approved', 1, '2026-11-11T10:00:00+08:00')").run(id, JSON.stringify(center));

  it("only the reviewers of the SAME center are told, see the queue and decide; the record names who decided", async () => {
    const rv = await person("rv", "審核員甲", ["reviewer"]);
    const rv2 = await person("rv2", "審核員乙", ["reviewer"]);
    const other = await person("rv3", "審核員丙", ["reviewer"]);
    const hq = await person("hq", "總部秘書", ["secretary"]);
    setCenter(rv.id, "台北中心");
    setCenter(rv2.id, " 台北中心 ");
    setCenter(other.id, "高雄 195");
    const m = await amwayMember("m", "小美");
    // 寰宇 alone: no review, nobody is told
    expect(((await (await member(m, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇" })).json()) as { status: string }).status).toBe("not_required");
    const told = (id: string) => db.raw.prepare("SELECT kind FROM notifications WHERE member_id = ?").all(id).map((r) => r.kind);
    expect(told(rv.id)).toEqual([]);
    // naming a center: every reviewer of that center is told (more than one), the others and the head office are not
    await member(m, "PUT", "/v1/me/amway/fields/education_center", { value: "台北中心" });
    expect(told(rv.id)).toEqual(["staff.review.requested"]);
    expect(told(rv2.id)).toEqual(["staff.review.requested"]);
    expect(told(other.id)).toEqual([]);
    expect(told(hq.id)).toEqual([]);

    const q = (await (await admin(rv, "GET", "/v1/admin/reviews")).json()) as { reviews: { id: string; display_name: string; field_label: string; center: string; requested_value: unknown }[] };
    expect(q.reviews).toHaveLength(1);
    expect(q.reviews[0]).toMatchObject({ display_name: "小美", field_label: "地區教育中心", center: "台北中心", requested_value: "台北中心" });
    // a reviewer of another center sees nothing and may not decide; the head office sees everything
    expect(((await (await admin(other, "GET", "/v1/admin/reviews")).json()) as { reviews: unknown[] }).reviews).toEqual([]);
    expect((await admin(other, "POST", `/v1/admin/reviews/${q.reviews[0]?.id}/decision`, { decision: "approve" })).status).toBe(403);
    expect(((await (await admin(hq, "GET", "/v1/admin/reviews")).json()) as { reviews: unknown[] }).reviews).toHaveLength(1);

    expect((await admin(rv, "POST", `/v1/admin/reviews/${q.reviews[0]?.id}/decision`, { decision: "approve" })).status).toBe(200);
    // Deciding finishes the reviewers' "waiting for review" notices (also the other reviewer's).
    for (const id of [rv.id, rv2.id]) expect(db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND kind = 'staff.review.requested' AND read_at IS NULL").get(id)?.n).toBe(0);
    expect((await admin(rv, "POST", `/v1/admin/reviews/${q.reviews[0]?.id}/decision`, { decision: "approve" })).status).toBe(404);
    const state = (await (await member(m, "GET", "/v1/me/amway")).json()) as { fields: { education_center: { status: string } } };
    expect(state.fields.education_center.status).toBe("approved");
    expect(db.raw.prepare("SELECT actor_type, actor_id FROM audit_log WHERE action = 'amway.review.approve'").get()).toEqual({ actor_type: "staff", actor_id: rv.id });
    // the review record names the person who decided
    const hist = (await (await admin(rv2, "GET", "/v1/admin/reviews/history")).json()) as { history: { field_label: string; status: string; decided_by: string }[] };
    expect(hist.history).toHaveLength(1);
    expect(hist.history[0]).toMatchObject({ field_label: "地區教育中心", status: "approved", decided_by: "審核員甲" });
    expect(((await (await admin(other, "GET", "/v1/admin/reviews/history")).json()) as { history: unknown[] }).history).toEqual([]);
  });

  it("with no reviewer for that center the request goes to the head-office secretaries and super admins", async () => {
    const hq = await person("hq", "總部秘書", ["secretary"]);
    const sa = await person("sa", "超管", ["super_admin"]);
    const rv = await person("rv", "審核員", ["reviewer"]);
    setCenter(rv.id, "高雄 195");
    const m = await amwayMember("m", "小美");
    await member(m, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇" });
    await member(m, "PUT", "/v1/me/amway/fields/education_center", { value: "屏東 221" });
    const told = (id: string) => db.raw.prepare("SELECT kind FROM notifications WHERE member_id = ?").all(id).map((r) => r.kind);
    expect(told(hq.id)).toEqual(["staff.review.requested"]);
    expect(told(sa.id)).toEqual(["staff.review.requested"]);
    expect(told(rv.id)).toEqual([]);
  });

  it("the new positions exist: 會長, 課務, 音控, 票務, 活動 (and 審核員, 總部秘書)", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const target = await person("t", "某人");
    const list = (await (await admin(sa, "GET", "/v1/admin/staff")).json()) as { roles: { role: string; label: string }[] };
    expect(list.roles.map((r) => r.label)).toEqual(["超級管理員", "總部秘書", "審核員", "會長", "課務", "音控", "票務", "活動"]);
    const res = await admin(sa, "PUT", `/v1/admin/staff/${target.id}`, { roles: ["president", "course", "sound", "ticket", "activity"] });
    expect(res.status).toBe(200);
    expect(db.raw.prepare("SELECT role FROM staff_roles WHERE member_id = ? ORDER BY role").all(target.id).map((r) => r.role)).toEqual(["activity", "course", "president", "sound", "ticket"]);
  });
  it("only the head office changes a member's 系統, 中心 or 獎銜 (nothing else); reviewers only look up", async () => {
    const rv = await person("rv", "審核員", ["reviewer"]);
    const hq = await person("hq", "總部秘書", ["secretary"]);
    const m = await amwayMember("m", "小美");
    expect((await admin(rv, "PUT", `/v1/admin/members/${m.id}/amway/rank`, { value: "15" })).status).toBe(403);
    let res = await admin(hq, "PUT", `/v1/admin/members/${m.id}/amway/rank`, { value: "15" });
    expect(res.status).toBe(200);
    expect(((await (await member(m, "GET", "/v1/me/amway")).json()) as { fields: { rank: unknown } }).fields.rank).toMatchObject({ value: "15", status: "approved" });
    expect((await admin(hq, "PUT", `/v1/admin/members/${m.id}/amway/education_center`, { value: "台北中心" })).status).toBe(200);
    expect((await admin(hq, "PUT", `/v1/admin/members/${m.id}/amway/education_system`, { value: "其他體系" })).status).toBe(200);
    for (const other of ["referrer", "upline_diamond", "upline_platinum", "upline_crown_ambassador"]) {
      res = await admin(hq, "PUT", `/v1/admin/members/${m.id}/amway/${other}`, { value: "x" });
      expect(res.status, other).toBe(404);
    }
    expect((await admin(hq, "PUT", `/v1/admin/members/${m.id}/amway/rank`, { value: "99" })).status).toBe(422);
    expect((await admin(rv, "GET", "/v1/admin/vocab")).status).toBe(403);
  });

  const setField = (id: string, key: string, value: unknown, approved = 1) =>
    db.raw.prepare("INSERT OR REPLACE INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at) VALUES (?, ?, ?, NULL, ?, ?, '2026-11-11T10:00:00+08:00')").run(id, key, JSON.stringify(value), approved ? "approved" : "not_required", approved);
  const list = async (p: P, qs = "") => (await (await admin(p, "GET", `/v1/admin/members${qs}`)).json()) as { members: { member_id: string; system: string | null; center: string | null; rank: string | null }[]; total: number; scope: string[]; can_manage: boolean };
  const ids = (r: { members: { member_id: string }[] }) => r.members.map((x) => x.member_id).sort();

  it("the head office finds members by number, name or id and lists everyone without a search word", async () => {
    const hq = await person("hq", "總部秘書", ["secretary"]);
    const m = await person("m", "王小美");
    const num = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(m.id)?.number as string;
    for (const q of [num, "小美", m.id, num.toLowerCase()]) expect(ids(await list(hq, `?q=${encodeURIComponent(q)}`)), q).toContain(m.id);
    expect(ids(await list(hq, "?q=%25"))).toEqual([]); // LIKE wildcards are escaped
    const all = await list(hq); // no search word: the list is not empty
    expect(ids(all)).toEqual([hq.id, m.id].sort());
    expect(all.total).toBe(2);
    expect(all.scope).toEqual(["全部會員"]);
    expect(all.can_manage).toBe(true);
    const detail = (await (await admin(hq, "GET", `/v1/admin/members/${m.id}`)).json()) as { display_name: string; member_numbers: unknown[]; can_manage: boolean };
    expect(detail.display_name).toBe("王小美");
    expect(detail.member_numbers).toHaveLength(1);
    expect(detail.can_manage).toBe(true);
  });

  it("filters: system, center, rank, status, Amway; paging", async () => {
    const hq = await person("hq", "總部秘書", ["secretary"]);
    const a = await amwayMember("a", "甲");
    const b = await amwayMember("b", "乙");
    const c = await person("c", "丙");
    setField(a.id, "education_system", "寰宇"); setField(a.id, "education_center", "新竹 122"); setField(a.id, "rank", "15");
    setField(b.id, "education_system", "其他體系"); setField(b.id, "education_center", "台南 187"); setField(b.id, "rank", "12");
    expect(ids(await list(hq, "?system=" + encodeURIComponent("寰宇")))).toEqual([a.id]);
    expect(ids(await list(hq, "?center=" + encodeURIComponent("台南 187")))).toEqual([b.id]);
    expect(ids(await list(hq, "?rank=12"))).toEqual([b.id]);
    expect(ids(await list(hq, "?amway=no"))).toEqual([hq.id, c.id].sort());
    expect(ids(await list(hq, "?amway=yes&system=" + encodeURIComponent("其他體系")))).toEqual([b.id]);
    db.raw.prepare("UPDATE members SET status = 'disabled' WHERE id = ?").run(c.id);
    expect(ids(await list(hq, "?status=disabled"))).toEqual([c.id]);
    const page = await list(hq, "?limit=2");
    expect(page.members).toHaveLength(2);
    expect(page.total).toBe(4);
    expect(ids(await list(hq, "?limit=2&offset=2"))).toHaveLength(2);
    const filters = (await (await admin(hq, "GET", "/v1/admin/member-filters")).json()) as { systems: string[]; centers: string[]; ranks: { value: string }[] };
    expect(filters.centers).toContain("新竹 122");
    expect(filters.ranks.map((r) => r.value)).toEqual(["12", "15"]);
  });

  it("every position may look up its own center's members, read only; 會長 the 寰宇 list; 鑽石級以上獎銜 everyone; nobody else", async () => {
    // a ladder with a 鑽石 step
    db.raw.prepare("INSERT INTO amway_options (field_key, value, label, sort_order) VALUES ('rank', 'diamond', '鑽石', 50)").run();
    const rv = await person("rv", "審核員", ["reviewer"]);
    const ticket = await person("t", "票務", ["ticket"]);
    const pres = await person("p", "會長", ["president"]);
    const dia = await person("d", "鑽石級人員", ["activity"]);
    const nobody = await person("n", "沒填中心的課務", ["course"]);
    const a = await amwayMember("a", "甲"); // 新竹, 寰宇
    const b = await amwayMember("b", "乙"); // 台南, other system
    const c = await amwayMember("c", "丙"); // 新竹, other system
    setField(a.id, "education_system", "寰宇"); setField(a.id, "education_center", "新竹 122");
    setField(b.id, "education_system", "其他體系"); setField(b.id, "education_center", "台南 187");
    setField(c.id, "education_system", "其他體系"); setField(c.id, "education_center", "新竹 122");
    setField(rv.id, "education_center", "新竹 122");
    setField(ticket.id, "education_center", "台南 187");
    setField(dia.id, "rank", "diamond"); // approved
    // own center only (any position), and only looking up
    const own = await list(rv);
    expect(ids(own)).toEqual([a.id, c.id, rv.id].sort());
    expect(own.scope).toEqual(["自己中心的會員"]);
    expect(own.can_manage).toBe(false);
    expect(ids(await list(ticket))).toEqual([b.id, ticket.id].sort());
    // 會長: the 寰宇 members (and, like everyone, the own center's, if a center is filled in)
    const pr = await list(pres);
    expect(ids(pr)).toEqual([a.id]);
    expect(pr.scope).toEqual(["系統＝寰宇的會員"]);
    // 鑽石級以上獎銜: everyone, read only
    const dl = await list(dia);
    expect(dl.total).toBeGreaterThanOrEqual(8);
    expect(dl.scope).toContain("全部會員");
    expect(dl.can_manage).toBe(false);
    // a self-declared (unreviewed) 鑽石 does not count
    setField(nobody.id, "rank", "diamond", 0);
    expect((await list(nobody)).members).toEqual([]);
    expect((await list(nobody)).scope).toEqual([]);
    // the member page follows the scope; reading only
    expect((await admin(rv, "GET", `/v1/admin/members/${a.id}`)).status).toBe(200);
    expect((await admin(rv, "GET", `/v1/admin/members/${b.id}`)).status).toBe(403);
    expect(((await (await admin(rv, "GET", `/v1/admin/members/${a.id}`)).json()) as { can_manage: boolean }).can_manage).toBe(false);
    expect((await admin(rv, "POST", `/v1/admin/members/${a.id}/status`, { status: "disabled" })).status).toBe(403);
    expect((await admin(rv, "POST", `/v1/admin/members/${a.id}/delete`)).status).toBe(403);
    expect((await admin(pres, "PUT", `/v1/admin/members/${a.id}/amway/rank`, { value: "15" })).status).toBe(403);
    // someone with no position at all is not staff
    const plain = await person("plain", "一般會員");
    expect((await admin(plain, "GET", "/v1/admin/members")).status).toBe(403);
  });

  it("the head office suspends, reinstates and deletes members; a suspended member is signed out; the last super admin is protected", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const hq = await person("hq", "總部秘書", ["secretary"]);
    const m = await person("m", "小美");
    const res = await admin(hq, "POST", `/v1/admin/members/${m.id}/status`, { status: "disabled" });
    expect(res.status).toBe(200);
    expect(db.raw.prepare("SELECT status FROM members WHERE id = ?").get(m.id)?.status).toBe("disabled");
    expect((await admin(m, "GET", "/v1/admin/me")).status).toBe(401); // the member's session is revoked
    expect(db.raw.prepare("SELECT action FROM audit_log WHERE action = 'member.suspend'").get()).toEqual({ action: "member.suspend" });
    expect((await admin(hq, "POST", `/v1/admin/members/${m.id}/status`, { status: "active" })).status).toBe(200);
    expect(db.raw.prepare("SELECT status FROM members WHERE id = ?").get(m.id)?.status).toBe("active");
    // cannot suspend oneself or the last super admin
    expect((await admin(sa, "POST", `/v1/admin/members/${sa.id}/status`, { status: "disabled" })).status).toBe(409);
    expect((await admin(hq, "POST", `/v1/admin/members/${sa.id}/status`, { status: "disabled" })).status).toBe(409);
    // delete
    // no forced sign-in again before deleting, however long ago the head office signed in
    now = new Date(now.getTime() + 11 * 60 * 1000);
    const del = await admin(hq, "POST", `/v1/admin/members/${m.id}/delete`);
    expect(del.status).toBe(200);
    expect(db.raw.prepare("SELECT status FROM members WHERE id = ?").get(m.id)?.status).toBe("deleted");
    expect(db.raw.prepare("SELECT action FROM audit_log WHERE action = 'member.delete'").get()).toEqual({ action: "member.delete" });
    expect((await admin(hq, "POST", `/v1/admin/members/${m.id}/delete`)).status).toBe(404);
    expect((await admin(hq, "POST", `/v1/admin/members/${sa.id}/delete`)).status).toBe(409); // the last super admin
    expect((await admin(hq, "POST", `/v1/admin/members/${hq.id}/delete`)).status).toBe(409); // not oneself
    // deleted members are not listed
    expect(ids(await list(hq))).not.toContain(m.id);
  });

  it("the 權限 page data: a dot chart built from the same rules the server enforces", async () => {
    const rv = await person("rv", "審核員", ["reviewer"]);
    const r = (await (await admin(rv, "GET", "/v1/admin/permissions")).json()) as { roles: { role: string; label: string }[]; features: { label: string; roles: string[]; diamond: boolean }[]; mine: string[] };
    expect(r.roles.map((x) => x.label)).toEqual(["超級管理員", "總部秘書", "審核員", "會長", "課務", "音控", "票務", "活動"]);
    expect(r.mine).toEqual(["reviewer"]);
    const row = (t: string) => r.features.find((f) => f.label.includes(t))!;
    expect(row("自己中心的會員").roles).toHaveLength(8);
    expect(row("系統＝寰宇").roles).toEqual(["president"]);
    expect(row("全部會員，不分系統").roles).toEqual(["super_admin", "secretary"]);
    expect(row("全部會員，不分系統").diamond).toBe(true);
    expect(row("修改會員").roles).toEqual(["super_admin", "secretary"]);
    expect(row("刪除會員").roles).toEqual(["super_admin", "secretary"]);
    expect(row("管理關聯詞").roles).toEqual(["super_admin"]);
    expect(row("指派職務").roles).toEqual(["super_admin"]);
    expect(row("審核中心／獎銜申請：自己中心").roles).toEqual(["reviewer"]);
  });

});

describe("options and vocabularies", () => {
  it("the rank ladder and the old options page are gone from the back office", async () => {
    const sec = await person("sec", "秘書", ["secretary"]);
    expect((await admin(sec, "GET", "/v1/admin/amway/options")).status).toBe(404);
    const m = await amwayMember("m", "小美");
    const defs = (await (await member(m, "GET", "/v1/amway/field-definitions")).json()) as { fields: { key: string; options?: { value: string }[] }[] };
    expect(defs.fields.find((f) => f.key === "rank")?.options?.map((o) => o.value)).toEqual(["12", "15"]);
    expect(defs.fields.find((f) => f.key === "education_center")?.options).toBeUndefined();
  });

  it("the regional education center: plain text for everyone, the 寰宇 vocabulary (managed in 詞庫) only for H-Global1985 members", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const a = await amwayMember("a", "甲");
    const b = await amwayMember("b", "乙");
    // The owner's list is seeded in his order; 無 first.
    const terms = (await (await admin(sa, "GET", "/v1/admin/vocab/education_center")).json()) as { terms: { term: string }[] };
    expect(terms.terms.map((t) => t.term)).toEqual(["飛登 013", "飛登蓁分享", "南京 062", "自強 061", "民權 018", "明星 339", "中山 288", "桃園 321", "新竹 122", "台中 136", "彰化 151", "員林 153", "嘉義 166", "台南 187", "高雄 195", "屏東 221"]);
    const sug = async (m: P, q: string) => ((await (await member(m, "GET", `/v1/vocab/suggestions?pool=education_center&q=${encodeURIComponent(q)}`)).json()) as { suggestions: string[] }).suggestions;
    expect(await sug(a, "中")).toEqual(["中山 288", "台中 136"]);
    expect((await sug(a, "")).length).toBe(16); // opening the field shows the whole list
    // The "whole list on open" rule is only for the regional center: other vocabularies need a typed character.
    expect(((await (await member(a, "GET", "/v1/vocab/suggestions?pool=occupation&q=")).json()) as { suggestions: string[] }).suggestions).toEqual([]);
    // Anyone may type any text; only H-Global1985 members add to the vocabulary.
    expect((await member(a, "PUT", "/v1/me/amway/fields/education_center", { value: "我的自訂中心" })).status).toBe(200);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM vocab_terms WHERE pool = 'education_center' AND term = '我的自訂中心'").get()?.n).toBe(0);
    expect(((await (await member(a, "GET", "/v1/me/amway")).json()) as { hglobal: boolean }).hglobal).toBe(false);
    // 寰宇 means H-Global1985: choosing it alone needs no review, and it unlocks the vocabulary.
    expect(((await (await member(b, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇" })).json()) as { status: string }).status).toBe("not_required");
    expect(((await (await member(b, "GET", "/v1/me/amway")).json()) as { hglobal: boolean }).hglobal).toBe(true);
    expect((await member(b, "PUT", "/v1/me/amway/fields/education_center", { value: "新北中心" })).status).toBe(200);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM vocab_terms WHERE pool = 'education_center' AND term = '新北中心'").get()?.n).toBe(1);
    // The super admin adds, edits and deletes the center terms; members' values follow edits.
    expect((await admin(sa, "POST", "/v1/admin/vocab/education_center/rename", { from: "新北中心", to: "新北" })).status).toBe(200);
    // b is 寰宇 with a center, so the center is waiting for review: the rename follows the pending value
    expect(((await (await member(b, "GET", "/v1/me/amway")).json()) as { fields: { education_center: { pending_value: string } } }).fields.education_center.pending_value).toBe("新北");
    await admin(sa, "POST", "/v1/admin/vocab/education_center/add", { term: "新加坡" });
    const after = (await (await admin(sa, "GET", "/v1/admin/vocab/education_center")).json()) as { terms: { term: string }[] };
    expect(after.terms[16]?.term).toBe("新加坡"); // admin-ordered terms first, then what members typed
    expect(after.terms.at(-1)?.term).toBe("新北");
  });

  it("only the super admin curates vocabularies: edit, merge and delete follow into members' saved values", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const sec = await person("sec", "秘書", ["secretary"]);
    const a = await amwayMember("a", "甲");
    const b = await amwayMember("b", "乙");
    const c = await amwayMember("c", "丙");
    await member(a, "PUT", "/v1/me/amway/fields/upline_platinum", { value: "陳大華" });
    await member(b, "PUT", "/v1/me/amway/fields/upline_platinum", { value: "陳大華" });
    await member(c, "PUT", "/v1/me/amway/fields/upline_platinum", { value: "陳大花" });
    await member(a, "PUT", "/v1/me/profile/fields/occupation", { value: ["工程師", "老師"] });
    await member(b, "PUT", "/v1/me/profile/fields/occupation", { value: ["工程師"] });

    expect((await admin(sec, "GET", "/v1/admin/vocab")).status).toBe(403);
    const pools = (await (await admin(sa, "GET", "/v1/admin/vocab")).json()) as { pools: { pool: string; terms: number }[] };
    expect(pools.pools.find((p) => p.pool === "upline_platinum")?.terms).toBe(2);
    const terms = (await (await admin(sa, "GET", "/v1/admin/vocab/upline_platinum")).json()) as { terms: { term: string; uses: number }[] };
    expect(terms.terms).toEqual([{ term: "陳大華", uses: 2, hglobal: false }, { term: "陳大花", uses: 1, hglobal: false }]);

    // Merge the typo into the right name: every member's saved value follows.
    let res = await admin(sa, "POST", "/v1/admin/vocab/upline_platinum/merge", { froms: ["陳大花"], into: "陳大華" });
    expect(((await res.json()) as { members_updated: number }).members_updated).toBe(1);
    const s = (await (await member(c, "GET", "/v1/me/amway")).json()) as { fields: { upline_platinum: { value: unknown } } };
    expect(s.fields.upline_platinum.value).toBe("陳大華");
    expect(((await (await admin(sa, "GET", "/v1/admin/vocab/upline_platinum")).json()) as { terms: { term: string; uses: number }[] }).terms).toEqual([{ term: "陳大華", uses: 3, hglobal: false }]);

    // Editing a tag term rewrites the item inside members' lists.
    res = await admin(sa, "POST", "/v1/admin/vocab/occupation/rename", { from: "工程師", to: "軟體工程師" });
    expect(res.status).toBe(200);
    const pa = (await (await member(a, "GET", "/v1/me/profile")).json()) as { fields: { occupation: { value: string[] } } };
    expect(pa.fields.occupation.value).toEqual(["軟體工程師", "老師"]);

    // Deleting only removes the suggestion.
    expect((await admin(sa, "POST", "/v1/admin/vocab/occupation/delete", { term: "老師" })).status).toBe(200);
    expect((await admin(sa, "POST", "/v1/admin/vocab/occupation/delete", { term: "老師" })).status).toBe(404);
    expect(((await (await member(a, "GET", "/v1/me/profile")).json()) as { fields: { occupation: { value: string[] } } }).fields.occupation.value).toContain("老師");
    expect((await admin(sa, "GET", "/v1/admin/vocab/nope")).status).toBe(404);
    expect((await admin(sa, "POST", "/v1/admin/vocab/occupation/add", { term: "  " })).status).toBe(422);
  });

  it("which education-system terms mean H-Global1985 is set by the super admin", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const a = await amwayMember("a", "甲");
    expect(((await (await member(a, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇學院" })).json()) as { status: string }).status).toBe("not_required");
    expect((await admin(sa, "POST", "/v1/admin/vocab/education_system/hglobal", { term: "寰宇學院", hglobal: true })).status).toBe(200);
    const b = await amwayMember("b", "乙");
    expect(((await (await member(b, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇學院" })).json()) as { status: string }).status).toBe("not_required"); // the system alone is never reviewed
    expect(((await (await member(b, "PUT", "/v1/me/amway/fields/education_center", { value: "新竹 122" })).json()) as { status: string }).status).toBe("pending"); // with a center it is
  });
});

describe("profile field order", () => {
  it("the super admin orders the fields of each group; members, the public page and Apps follow", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const sec = await person("sec", "秘書", ["secretary"]);
    const m = await amwayMember("m", "小美");
    expect((await admin(sec, "GET", "/v1/admin/profile-layout")).status).toBe(403);
    const v = (await (await admin(sa, "GET", "/v1/admin/profile-layout")).json()) as { groups: { group: string; fields: { key: string; label: string }[] }[]; customized: boolean };
    expect(v.groups.map((g) => g.group)).toEqual(["blocks", "basic", "contact", "amway"]);
    expect(v.groups[0]!.fields.map((f) => f.key)).toEqual(["avatar", "amway", "basic", "education", "contact", "birthday"]);
    expect(v.groups[0]!.fields.at(-1)?.label).toBe("生日與生命靈數"); // one block for the birthday and the chart
    expect(v.groups[3]!.fields[0]).toMatchObject({ key: "member_number", label: "會員編號" });
    expect(v.customized).toBe(false);
    const basic = v.groups[1]!.fields.map((f) => f.key);
    expect(basic.slice(0, 3)).toEqual(["display_name", "motto", "bio"]);

    // Must list every field of every group exactly once.
    const order = Object.fromEntries(v.groups.map((g) => [g.group, g.fields.map((f) => f.key)])) as Record<string, string[]>;
    expect((await admin(sa, "PUT", "/v1/admin/profile-layout", { order: { ...order, basic: order.basic!.slice(1) } })).status).toBe(422);
    expect((await admin(sa, "PUT", "/v1/admin/profile-layout", { order: { ...order, contact: [...order.contact!.slice(1), "bogus"] } })).status).toBe(422);
    expect((await admin(sa, "PUT", "/v1/admin/profile-layout", { order: { ...order, basic: [...order.basic!.slice(0, 2), ...order.basic!.slice(2).reverse()] } })).status).toBe(200);
    await admin(sa, "PUT", "/v1/admin/profile-layout", { order: { ...order, blocks: [...order.blocks!].reverse(), basic: ["interests", ...order.basic!.filter((k) => k !== "interests")], amway: [...order.amway!].reverse() } });

    const defs = (await (await member(m, "GET", "/v1/profile/field-definitions")).json()) as { fields: { key: string; group: string; order: number }[]; blocks: { key: string; order: number }[] };
    // Big blocks (the whole sections) move too, and the member number is part of the Amway order.
    expect(defs.blocks.slice().sort((a, b) => a.order - b.order).map((b) => b.key)).toEqual(["birthday", "contact", "education", "basic", "amway", "avatar"]);
    expect(defs.fields.find((f) => f.key === "member_number")!.order).toBeGreaterThan(defs.fields.find((f) => f.key === "interests")!.order - 1000);
    const byOrder = defs.fields.filter((f) => f.group === "basic").sort((a, b) => a.order - b.order).map((f) => f.key);
    expect(byOrder[0]).toBe("interests");
    const adef = (await (await member(m, "GET", "/v1/amway/field-definitions")).json()) as { fields: { key: string; order: number }[] };
    expect(adef.fields.slice().sort((a, b) => a.order - b.order)[0]?.key).toBe("upline_platinum");

    // Public page follows the order too.
    await member(m, "PUT", "/v1/me/profile/fields/interests", { value: ["閱讀"] });
    await member(m, "PUT", "/v1/me/profile/fields/bio", { value: "簡介文字" });
    await member(m, "PUT", "/v1/me/profile/visibility", { fields: { interests: "public", bio: "public" } });
    const n = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(m.id)?.number as string;
    const html = await (await app.request(`/${n}`, {}, env)).text();
    expect(html.indexOf("興趣與專長")).toBeGreaterThan(-1);
    expect(html.indexOf("興趣與專長")).toBeLessThan(html.indexOf("自我介紹"));

    const reset = await admin(sa, "PUT", "/v1/admin/profile-layout", { order: null });
    expect(((await reset.json()) as { customized: boolean }).customized).toBe(false);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM profile_layout").get()).toEqual({ n: 0 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('layout.save','layout.reset')").get()?.n).toBeGreaterThanOrEqual(3);
  });
});

describe("staff management and audit", () => {
  it("super admins set roles after a recent sign-in; the last super admin cannot be removed", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const m = await person("m", "新秘書");
    let res = await admin(sa, "PUT", `/v1/admin/staff/${m.id}`, { roles: ["secretary"] });
    expect(res.status).toBe(200);
    expect(((await (await admin(m, "GET", "/v1/admin/me")).json()) as { permissions: string[] }).permissions).toContain("audit.read");
    res = await admin(sa, "PUT", `/v1/admin/staff/${sa.id}`, { roles: [] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("last_super_admin");
    expect((await admin(m, "PUT", `/v1/admin/staff/${m.id}`, { roles: ["super_admin"] })).status).toBe(403);

    // No forced sign-in again for position changes, however long ago the super admin signed in.
    now = new Date(now.getTime() + 11 * 60 * 1000);
    res = await admin(sa, "PUT", `/v1/admin/staff/${m.id}`, { roles: ["secretary", "reviewer"] });
    expect(res.status).toBe(200);
    const list = (await (await admin(sa, "GET", "/v1/admin/staff")).json()) as { staff: { member_id: string; roles: string[]; display_name: string }[] };
    expect(list.staff.find((s) => s.member_id === m.id)).toMatchObject({ roles: ["reviewer", "secretary"], display_name: "新秘書" });
  });

  it("audit can be filtered and holds no member values", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const m = await amwayMember("m", "小美");
    await member(m, "PUT", "/v1/me/amway/fields/referrer", { value: "王大明" });
    const r = (await (await admin(sa, "GET", `/v1/admin/audit?target_id=${m.id}&action=amway.field.update`)).json()) as { entries: { action: string; detail: string }[] };
    expect(r.entries).toHaveLength(1);
    expect(JSON.parse(r.entries[0]!.detail)).toEqual({ field_key: "referrer", review: false });
    const all = JSON.stringify((await (await admin(sa, "GET", "/v1/admin/audit?limit=200")).json()) as unknown);
    expect(all).not.toContain("王大明");
    expect(all).not.toContain("小美");
    const rv = await person("rv", "審核員", ["reviewer"]);
    expect((await admin(rv, "GET", "/v1/admin/audit")).status).toBe(403);
  });
});
