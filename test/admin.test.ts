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
    expect(me.permissions).toEqual(["review", "adjust", "members.read"]);
  });

  it("refuses cross-site state changes", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const body = { field_key: "rank", value: "18", label: "18%", sort_order: 40, active: true };
    expect((await admin(sa, "PUT", "/v1/admin/amway/options", body, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await app.request("/v1/admin/amway/options", { method: "PUT", headers: { cookie: `__Host-hgid_session=${sa.cookie}`, "content-type": "application/json" }, body: JSON.stringify(body) }, env);
    expect(noOrigin.status).toBe(403);
    expect((await admin(sa, "PUT", "/v1/admin/amway/options", body)).status).toBe(200);
  });

  it("role matrix", () => {
    expect(can(["reviewer"], "options.manage")).toBe(false);
    expect(can(["secretary"], "vocab.manage")).toBe(false);
    expect(can(["super_admin"], "vocab.manage")).toBe(true);
    expect(can(["secretary"], "staff.manage")).toBe(false);
    expect(can(["reviewer", "secretary"], "audit.read")).toBe(true);
    expect(permissionsOf(["nope"])).toEqual([]);
  });
});

describe("reviews", () => {
  it("reviewers are notified, see the queue and decide; the member is notified", async () => {
    const rv = await person("rv", "審核員", ["reviewer"]);
    const m = await amwayMember("m", "小美");
    await member(m, "PUT", "/v1/me/amway/fields/education_system", { value: "H-Global1985" });
    expect(db.raw.prepare("SELECT kind FROM notifications WHERE member_id = ?").all(rv.id).map((r) => r.kind)).toEqual(["staff.review.requested"]);

    const q = (await (await admin(rv, "GET", "/v1/admin/reviews")).json()) as { reviews: { id: string; display_name: string; field_label: string; requested_value: unknown }[] };
    expect(q.reviews).toHaveLength(1);
    expect(q.reviews[0]).toMatchObject({ display_name: "小美", field_label: "直銷商培訓系統", requested_value: "H-Global1985" });
    expect((await admin(rv, "POST", `/v1/admin/reviews/${q.reviews[0]?.id}/decision`, { decision: "approve" })).status).toBe(200);
    expect((await admin(rv, "POST", `/v1/admin/reviews/${q.reviews[0]?.id}/decision`, { decision: "approve" })).status).toBe(404);
    const state = (await (await member(m, "GET", "/v1/me/amway")).json()) as { fields: { education_system: { status: string } } };
    expect(state.fields.education_system.status).toBe("approved");
    expect(db.raw.prepare("SELECT actor_type, actor_id FROM audit_log WHERE action = 'amway.review.approve'").get()).toEqual({ actor_type: "staff", actor_id: rv.id });
  });

  it("reviewers adjust only the six fields", async () => {
    const rv = await person("rv", "審核員", ["reviewer"]);
    const m = await amwayMember("m", "小美");
    let res = await admin(rv, "PUT", `/v1/admin/members/${m.id}/amway/rank`, { value: "15" });
    expect(res.status).toBe(200);
    expect(((await (await member(m, "GET", "/v1/me/amway")).json()) as { fields: { rank: unknown } }).fields.rank).toMatchObject({ value: "15", status: "approved" });
    res = await admin(rv, "PUT", `/v1/admin/members/${m.id}/amway/referrer`, { value: "x" });
    expect(res.status).toBe(404);
    res = await admin(rv, "PUT", `/v1/admin/members/${m.id}/amway/rank`, { value: "99" });
    expect(res.status).toBe(422);
    expect((await admin(rv, "PUT", "/v1/admin/amway/options", { field_key: "rank", value: "18", label: "18%", sort_order: 40, active: true })).status).toBe(403);
  });

  it("finds members by number, name or id", async () => {
    const rv = await person("rv", "審核員", ["reviewer"]);
    const m = await person("m", "王小美");
    const num = db.raw.prepare("SELECT number FROM member_numbers WHERE member_id = ?").get(m.id)?.number as string;
    for (const q of [num, "小美", m.id, num.toLowerCase()]) {
      const r = (await (await admin(rv, "GET", `/v1/admin/members?q=${encodeURIComponent(q)}`)).json()) as { members: { member_id: string }[] };
      expect(r.members.map((x) => x.member_id), q).toContain(m.id);
    }
    const r = (await (await admin(rv, "GET", "/v1/admin/members?q=%25")).json()) as { members: unknown[] };
    expect(r.members).toEqual([]); // LIKE wildcards are escaped
    const detail = (await (await admin(rv, "GET", `/v1/admin/members/${m.id}`)).json()) as { display_name: string; member_numbers: unknown[] };
    expect(detail.display_name).toBe("王小美");
    expect(detail.member_numbers).toHaveLength(1);
  });
});

describe("options and vocabularies", () => {
  it("secretaries maintain the rank and center options", async () => {
    const sec = await person("sec", "秘書", ["secretary"]);
    expect((await admin(sec, "PUT", "/v1/admin/amway/options", { field_key: "rank", value: "12a", label: "12%初階", sort_order: 10, active: true })).status).toBe(200);
    // Free-text fields have no option list.
    expect((await admin(sec, "PUT", "/v1/admin/amway/options", { field_key: "education_system", value: "x", label: "x", sort_order: 1, active: true })).status).toBe(422);
    expect((await admin(sec, "PUT", "/v1/admin/amway/options", { field_key: "upline_platinum", value: "x", label: "x", sort_order: 1, active: true })).status).toBe(422);
    expect((await admin(sec, "PUT", "/v1/admin/amway/options", { field_key: "referrer", value: "a", label: "a", sort_order: 1, active: true })).status).toBe(422);
    const m = await amwayMember("m", "小美");
    const defs = (await (await member(m, "GET", "/v1/amway/field-definitions")).json()) as { fields: { key: string; options?: { value: string }[] }[] };
    expect(defs.fields.find((f) => f.key === "rank")?.options?.map((o) => o.value)).toEqual(["12a", "12", "15"]);
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
    expect(((await (await member(b, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇學院" })).json()) as { status: string }).status).toBe("pending");
  });
});

describe("staff management and audit", () => {
  it("super admins set roles after a recent sign-in; the last super admin cannot be removed", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const m = await person("m", "新秘書");
    let res = await admin(sa, "PUT", `/v1/admin/staff/${m.id}`, { roles: ["secretary"] });
    expect(res.status).toBe(200);
    expect(((await (await admin(m, "GET", "/v1/admin/me")).json()) as { permissions: string[] }).permissions).toContain("options.manage");
    res = await admin(sa, "PUT", `/v1/admin/staff/${sa.id}`, { roles: [] });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("last_super_admin");
    expect((await admin(m, "PUT", `/v1/admin/staff/${m.id}`, { roles: ["super_admin"] })).status).toBe(403);

    now = new Date(now.getTime() + 11 * 60 * 1000);
    res = await admin(sa, "PUT", `/v1/admin/staff/${m.id}`, { roles: [] });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("reauth_required");
    const list = (await (await admin(sa, "GET", "/v1/admin/staff")).json()) as { staff: { member_id: string; roles: string[]; display_name: string }[] };
    expect(list.staff.find((s) => s.member_id === m.id)).toMatchObject({ roles: ["secretary"], display_name: "新秘書" });
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
