// GET /v1/eligibility/center-members (ADR 0028): a center's staff picks a person of the same center.
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { clearAppCache } from "../src/db/apps";
import { importSigningKey, signJwt } from "../src/lib/jwt";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const SCOPE = "openid profile.read amway.read";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "center-test" });
})();
const key = await importSigningKey(jwk);

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
const now = new Date();

/** A member; `center` makes them a 寰宇 Amway member whose center was approved (approved=false: still pending review). */
async function person(sub: string, name: string, o: { roles?: string[]; center?: string; approved?: boolean; amway?: boolean; status?: string } = {}) {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name, email: `${sub}@example.com` }, "TW", now, "r");
  for (const r of o.roles ?? []) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  if (o.center) {
    db.raw.prepare("UPDATE members SET amway_enabled = ? WHERE id = ?").run(o.amway === false ? 0 : 1, member.id);
    const ins = db.raw.prepare("INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x')");
    ins.run(member.id, "education_system", JSON.stringify("寰宇"), null, "not_required", 1);
    if (o.approved === false) ins.run(member.id, "education_center", null, JSON.stringify(o.center), "pending", 0);
    else ins.run(member.id, "education_center", JSON.stringify(o.center), null, "approved", 1);
  }
  if (o.status) db.raw.prepare("UPDATE members SET status = ? WHERE id = ?").run(o.status, member.id);
  return member.id;
}
async function appToken(memberId: string, appId = "learn"): Promise<string> {
  const sid = crypto.randomUUID();
  const iat = Math.floor(now.getTime() / 1000);
  db.raw.prepare("INSERT INTO app_sessions (id, member_id, app_id, refresh_hash, scope, auth_time_epoch, last_used_epoch, expires_epoch, created_at) VALUES (?,?,?,?,?,?,?,?,'x')").run(sid, memberId, appId, "h" + sid, SCOPE, iat, iat, iat + 86400);
  return signJwt({ iss: ISSUER, sub: memberId, aud: ISSUER, client_id: appId, app_id: appId, scope: SCOPE, sid, auth_time: iat, iat, exp: iat + 900, jti: sid }, key, "at+jwt");
}
const allow = (fields: string[], appId = "learn") => {
  const def = JSON.parse((db.raw.prepare("SELECT definition FROM registered_apps WHERE app_id = ?").get(appId) as { definition: string }).definition);
  def.member_data_fields = fields;
  db.raw.prepare("UPDATE registered_apps SET definition = ? WHERE app_id = ?").run(JSON.stringify(def), appId);
  clearAppCache();
};
const used = (id: string, appId = "learn") => db.raw.prepare("INSERT OR IGNORE INTO member_apps (member_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, 'x', 'x')").run(id, appId);
type Res = { center: { key: string; label: string }; members: { member_id: string; display_name: string; avatar_url: string | null; signed_in_app: boolean }[]; next_cursor: string | null };
const get = async (token: string, qs = "") => app.request(`/v1/eligibility/center-members${qs}`, { headers: { authorization: `Bearer ${token}` } }, env);
const list = async (token: string, qs = ""): Promise<Res> => {
  const r = await get(token, qs);
  expect(r.status).toBe(200);
  return (await r.json()) as Res;
};

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk } as Env;
  app = createApp({ now: () => now });
  clearAppCache();
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning','e','none','[]',?, 'active','x','x')").run(SCOPE);
  allow(["display_name", "avatar"]);
});

describe("who may ask and what they see", () => {
  it("音控 sees only their own center: same center, approved, active, Amway on, not themselves; the minimum fields", async () => {
    const sound = await person("s", "音控小明", { roles: ["sound"], center: "新竹 122" });
    const a = await person("a", "阿甲", { center: "新竹 122" });
    const b = await person("b", "阿乙", { center: "新竹　122" }); // the same center typed with a full-width space: same key
    await person("far", "遠方人", { center: "南京" });
    await person("pending", "待審", { center: "新竹 122", approved: false });
    await person("gone", "已停用", { center: "新竹 122", status: "disabled" });
    await person("off", "沒開Amway", { center: "新竹 122", amway: false });
    await person("nocenter", "沒中心");
    used(a);
    const r = await list(await appToken(sound));
    expect(r.center).toEqual({ key: "新竹 122", label: "新竹 122" });
    expect(r.members.map((m) => m.display_name).sort()).toEqual(["阿乙", "阿甲"]);
    expect(r.members.find((m) => m.member_id === a)).toMatchObject({ signed_in_app: true });
    expect(r.members.find((m) => m.member_id === b)).toMatchObject({ signed_in_app: false }); // people who never used the App are listed too
    expect(r.members.some((m) => m.member_id === sound)).toBe(false);
    for (const m of r.members) expect(Object.keys(m).sort()).toEqual(["avatar_url", "display_name", "member_id", "signed_in_app"]);
    expect(JSON.stringify(r)).not.toMatch(/example\.com|phone|rank|email/);
    expect(r.next_cursor).toBeNull();
  });

  it("會長 may too; another center is refused even when named; naming their own center is fine", async () => {
    const pres = await person("p", "會長", { roles: ["president"], center: "新竹 122" });
    await person("a", "阿甲", { center: "新竹 122" });
    await person("far", "遠方人", { center: "南京" });
    const t = await appToken(pres);
    expect((await get(t, "?center=南京")).status).toBe(403);
    expect((await list(t, "?center=%E6%96%B0%E7%AB%B9%20122")).members).toHaveLength(1);
    expect((await list(t)).members.map((m) => m.display_name)).toEqual(["阿甲"]);
  });

  it("everyone else gets 403: no position, a position without an approved center, a center pending review, a plain member token", async () => {
    const plain = await person("plain", "一般會員", { center: "新竹 122" });
    expect((await get(await appToken(plain))).status).toBe(403);
    const noCenter = await person("nc", "音控無中心", { roles: ["sound"] });
    expect((await get(await appToken(noCenter))).status).toBe(403);
    const pendingSound = await person("ps", "音控待審", { roles: ["sound"], center: "新竹 122", approved: false });
    expect((await get(await appToken(pendingSound))).status).toBe(403);
    const reviewer = await person("rv", "審核員", { roles: ["reviewer"], center: "新竹 122" });
    expect((await get(await appToken(reviewer))).status).toBe(403);
    // A token that is not from an App (the central site itself / another OIDC client) is refused as well.
    const sound = await person("s", "音控", { roles: ["sound"], center: "新竹 122" });
    const { session } = await createSession(db, sound, now);
    const t = (await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId: sound, sessionId: session.id, scope: SCOPE, authTime: 0 })).access_token;
    expect((await get(t)).status).toBe(403);
    expect((await app.request("/v1/eligibility/center-members", {}, env)).status).toBe(401);
  });

  it("秘書 and 超級管理員 may name any center from the vocabulary; an unknown center is 404; no center and none of their own is 422", async () => {
    const sec = await person("sec", "秘書", { roles: ["secretary"] });
    const sa = await person("sa", "超管", { roles: ["super_admin"], center: "南京" });
    await person("a", "阿甲", { center: "新竹 122" });
    await person("b", "阿乙", { center: "南京" });
    const t = await appToken(sec);
    const r = await list(t, "?center=" + encodeURIComponent("新竹 122"));
    expect(r.members.map((m) => m.display_name)).toEqual(["阿甲"]);
    expect((await get(t, "?center=" + encodeURIComponent("不存在的中心"))).status).toBe(404);
    expect((await get(t)).status).toBe(422);
    // Without `center` a super admin who has an approved center of their own lists that one (not themselves).
    expect((await list(await appToken(sa))).members.map((m) => m.display_name)).toEqual(["阿乙"]);
    expect((await list(await appToken(sa), "?center=" + encodeURIComponent("新竹 122"))).members.map((m) => m.display_name)).toEqual(["阿甲"]);
  });
});

describe("search, pages, privacy", () => {
  it("q searches the display name only (never the legal name); pages follow the cursor without gaps or repeats", async () => {
    const sound = await person("s", "音控", { roles: ["sound"], center: "新竹 122" });
    const ids: string[] = [];
    for (const n of ["王一", "王二", "王三", "李四", "李五"]) ids.push(await person("m-" + n, n, { center: "新竹 122" }));
    db.raw.prepare("INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES (?, 'legal_name', ?, 'x')").run(ids[3]!, JSON.stringify("秘密本名"));
    db.raw.prepare("INSERT INTO profile_field_values (member_id, field_key, value, updated_at) VALUES (?, 'display_name', ?, 'x')").run(ids[4]!, JSON.stringify("小李"));
    const t = await appToken(sound);
    expect((await list(t, "?q=" + encodeURIComponent("王"))).members).toHaveLength(3);
    expect((await list(t, "?q=" + encodeURIComponent("秘密本名"))).members).toHaveLength(0);
    expect((await list(t, "?q=" + encodeURIComponent("小李"))).members.map((m) => m.display_name)).toEqual(["小李"]); // the name the member chose, not the Google name
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: Res = await list(t, `?limit=2${cursor ? "&cursor=" + cursor : ""}`);
      seen.push(...r.members.map((m) => m.member_id));
      cursor = r.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
    expect((await get(t, "?cursor=%25%25bad")).status).toBe(422);
    expect((await get(t, "?limit=51")).status).toBe(422);
    expect((await get(t, "?limit=0")).status).toBe(422);
    expect((await list(t, "?limit=50")).members).toHaveLength(5);
  });

  it("the App must have the display name ticked for it (the avatar too, or it is null); a default of 20", async () => {
    const sound = await person("s", "音控", { roles: ["sound"], center: "新竹 122" });
    for (let i = 0; i < 25; i++) await person("m" + i, "會員" + String(i).padStart(2, "0"), { center: "新竹 122" });
    db.raw.prepare("UPDATE members SET avatar_url = 'https://example.test/a.png' WHERE google_sub != 's'").run();
    const t = await appToken(sound);
    const first = await list(t);
    expect(first.members).toHaveLength(20);
    expect(first.next_cursor).not.toBeNull();
    expect(first.members[0]!.avatar_url).toBe("https://example.test/a.png");
    allow(["display_name"]);
    expect((await list(t)).members[0]!.avatar_url).toBeNull();
    allow(["avatar"]);
    const r = await get(t);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("field_not_allowed");
  });

  it("every query is audited (caller, App, center, count; never the search text or names), refusals too", async () => {
    const sound = await person("s", "音控", { roles: ["sound"], center: "新竹 122" });
    await person("a", "阿甲", { center: "新竹 122" });
    const plain = await person("p", "一般", { center: "新竹 122" });
    await list(await appToken(sound), "?q=" + encodeURIComponent("阿"));
    await get(await appToken(plain));
    const rows = db.raw.prepare("SELECT actor_id, app_id, target_id, result, detail FROM audit_log WHERE action = 'center_members.list' ORDER BY occurred_at").all() as { actor_id: string; app_id: string; target_id: string | null; result: string; detail: string }[];
    expect(rows.map((r) => r.result)).toEqual(["success", "denied"]);
    expect(rows[0]).toMatchObject({ actor_id: sound, app_id: "learn", target_id: "新竹 122" });
    expect(JSON.parse(rows[0]!.detail)).toEqual({ count: 1, searched: true, paged: false });
    expect(rows.map((r) => r.detail).join()).not.toMatch(/阿甲|阿/);
  });
});
