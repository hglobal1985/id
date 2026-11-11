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
  it("reviewers are notified, see the queue and decide; the member is notified", async () => {
    const rv = await person("rv", "審核員", ["reviewer"]);
    const m = await amwayMember("m", "小美");
    await member(m, "PUT", "/v1/me/amway/fields/education_system", { value: "H-Global1985" });
    expect(db.raw.prepare("SELECT kind FROM notifications WHERE member_id = ?").all(rv.id).map((r) => r.kind)).toEqual(["staff.review.requested"]);

    const q = (await (await admin(rv, "GET", "/v1/admin/reviews")).json()) as { reviews: { id: string; display_name: string; field_label: string; requested_value: unknown }[] };
    expect(q.reviews).toHaveLength(1);
    expect(q.reviews[0]).toMatchObject({ display_name: "小美", field_label: "直銷商培訓系統", requested_value: "H-Global1985" });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL").get(rv.id)?.n).toBe(1);
    expect((await admin(rv, "POST", `/v1/admin/reviews/${q.reviews[0]?.id}/decision`, { decision: "approve" })).status).toBe(200);
    // Deciding finishes the reviewers' "waiting for review" notice.
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE member_id = ? AND read_at IS NULL").get(rv.id)?.n).toBe(0);
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
    expect((await admin(rv, "GET", "/v1/admin/vocab")).status).toBe(403);
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
    // 寰宇 means H-Global1985: it needs review and unlocks the vocabulary.
    expect(((await (await member(b, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇" })).json()) as { status: string }).status).toBe("pending");
    expect(((await (await member(b, "GET", "/v1/me/amway")).json()) as { hglobal: boolean }).hglobal).toBe(true);
    expect((await member(b, "PUT", "/v1/me/amway/fields/education_center", { value: "新北中心" })).status).toBe(200);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM vocab_terms WHERE pool = 'education_center' AND term = '新北中心'").get()?.n).toBe(1);
    // The super admin adds, edits and deletes the center terms; members' values follow edits.
    expect((await admin(sa, "POST", "/v1/admin/vocab/education_center/rename", { from: "新北中心", to: "新北" })).status).toBe(200);
    expect(((await (await member(b, "GET", "/v1/me/amway")).json()) as { fields: { education_center: { value: string } } }).fields.education_center.value).toBe("新北");
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
    expect(((await (await member(b, "PUT", "/v1/me/amway/fields/education_system", { value: "寰宇學院" })).json()) as { status: string }).status).toBe("pending");
  });
});

describe("profile field order", () => {
  it("the super admin orders the fields of each group; members, the public page and Apps follow", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const sec = await person("sec", "秘書", ["secretary"]);
    const m = await amwayMember("m", "小美");
    expect((await admin(sec, "GET", "/v1/admin/profile-layout")).status).toBe(403);
    const v = (await (await admin(sa, "GET", "/v1/admin/profile-layout")).json()) as { groups: { group: string; fields: { key: string }[] }[]; customized: boolean };
    expect(v.groups.map((g) => g.group)).toEqual(["blocks", "basic", "contact", "amway"]);
    expect(v.groups[0]!.fields.map((f) => f.key)).toEqual(["avatar", "amway", "basic", "education", "contact", "birthday", "life"]);
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
    expect(defs.blocks.slice().sort((a, b) => a.order - b.order).map((b) => b.key)).toEqual(["life", "birthday", "contact", "education", "basic", "amway", "avatar"]);
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
