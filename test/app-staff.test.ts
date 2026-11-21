// GET /v1/eligibility/staff and PUT /v1/eligibility/staff/{member_id} (ADR 0033): an App lets the person who may manage
// positions look up members and give or remove the general positions.
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { upsertMemberByGoogle } from "../src/db/identity";
import { clearAppCache } from "../src/db/apps";
import { importSigningKey, signJwt } from "../src/lib/jwt";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const SCOPE = "openid profile.read amway.read";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "staff-test" });
})();
const key = await importSigningKey(jwk);

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
const now = new Date();

async function person(sub: string, name: string, roles: string[] = []) {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name, email: `${sub}@example.com` }, "TW", now, "r");
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
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
const get = (token: string, q?: string) => app.request(`/v1/eligibility/staff${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`, { headers: { authorization: `Bearer ${token}` } }, env);
const put = (token: string, id: string, roles: unknown) => app.request(`/v1/eligibility/staff/${id}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ roles }) }, env);
type Row = { member_id: string; display_name: string | null; roles: { role: string; assignable: boolean }[] };
const rolesOf = (id: string) => (db.raw.prepare("SELECT role FROM staff_roles WHERE member_id = ? ORDER BY role").all(id) as { role: string }[]).map((r) => r.role);

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk } as Env;
  app = createApp({ now: () => now });
  clearAppCache();
  allow(["display_name"]);
});

describe("positions from an App", () => {
  it("lists the staff, or searches by name; only the permission holder; the App needs display_name", async () => {
    const boss = await person("boss", "超管", ["super_admin"]);
    const sec = await person("sec", "秘書", ["secretary"]);
    const snd = await person("snd", "音控王", ["sound"]);
    const plain = await person("plain", "王小明");
    const t = await appToken(boss);
    const raw = await get(t); if (raw.status !== 200) throw new Error(raw.status + " " + (await raw.text()));
    const r = (await raw.json()) as { assignable_roles: { role: string }[]; members: Row[] };
    expect(r.assignable_roles.map((x) => x.role)).toEqual(["reviewer", "president", "course", "sound", "ticket", "activity"]);
    expect(r.members.map((x) => x.member_id).sort()).toEqual([boss, sec, snd].sort());
    expect(JSON.stringify(r)).not.toMatch(/example\.com|phone/);
    expect(r.members.find((x) => x.member_id === snd)?.roles).toEqual([{ role: "sound", label: "音控", assignable: true }]);
    expect(r.members.find((x) => x.member_id === sec)?.roles[0]).toMatchObject({ role: "secretary", assignable: false });
    // search: any active member, with or without a position; wildcards are text, not patterns
    const s = (await (await get(t, "小明")).json()) as { members: Row[] };
    expect(s.members.map((x) => x.member_id)).toEqual([plain]); // no position needed
    expect(((await (await get(t, "音控")).json()) as { members: Row[] }).members.map((x) => x.member_id)).toEqual([snd]);
    expect(((await (await get(t, "%%")).json()) as { members: Row[] }).members).toEqual([]);
    expect((await get(t, "a")).status).toBe(422); // too short
    // others
    for (const who of [sec, snd, plain]) expect((await get(await appToken(who))).status).toBe(403);
    expect((await app.request("/v1/eligibility/staff", {}, env)).status).toBe(401);
    allow([]);
    expect((await get(t)).status).toBe(403);
  });

  it("assigns and removes general positions; super_admin and secretary and extra permissions stay; audited with the App, no names", async () => {
    const boss = await person("boss", "超管", ["super_admin"]);
    const sec = await person("sec", "秘書", ["secretary", "sound"]);
    const plain = await person("plain", "王小明");
    db.raw.prepare("INSERT INTO staff_grants (member_id, permission, scope, granted_at) VALUES (?, 'audit.read', 'all', 'x')").run(plain);
    const t = await appToken(boss);
    let res = await put(t, plain, ["course", "ticket"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ member_id: plain, changed: true, roles: [{ role: "course" }, { role: "ticket" }] });
    expect(rolesOf(plain)).toEqual(["course", "ticket"]);
    expect(db.raw.prepare("SELECT permission FROM staff_grants WHERE member_id = ?").all(plain)).toEqual([{ permission: "audit.read" }]);
    // the same list again: no change
    expect(await (await put(t, plain, ["ticket", "course"])).json()).toMatchObject({ changed: false });
    // removing all of them
    res = await put(t, plain, []);
    expect(res.status).toBe(200);
    expect(rolesOf(plain)).toEqual([]);
    // the secretary keeps the secretary position when the App changes the sound position
    res = await put(t, sec, ["president"]);
    expect(res.status).toBe(200);
    expect(rolesOf(sec)).toEqual(["president", "secretary"]);
    const audit = db.raw.prepare("SELECT actor_id, app_id, target_id, detail FROM audit_log WHERE action = 'staff.roles.set' ORDER BY occurred_at").all() as { actor_id: string; app_id: string; target_id: string; detail: string }[];
    expect(audit.length).toBe(3);
    expect(audit.every((a) => a.actor_id === boss && a.app_id === "learn")).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/王小明|秘書|example\.com/);
  });

  it("refuses what an App may not do: other positions, unknown roles, strangers, non-managers", async () => {
    const boss = await person("boss", "超管", ["super_admin"]);
    const sec = await person("sec", "秘書", ["secretary"]);
    const plain = await person("plain", "王小明");
    const gone = await person("gone", "停用");
    db.raw.prepare("UPDATE members SET status = 'disabled' WHERE id = ?").run(gone);
    const t = await appToken(boss);
    for (const roles of [["super_admin"], ["secretary"], ["nope"], ["course", "super_admin"]]) {
      expect((await put(t, plain, roles)).status).toBe(422);
    }
    expect(rolesOf(plain)).toEqual([]);
    expect((await put(t, "00000000-0000-4000-8000-000000000999", ["course"])).status).toBe(404);
    expect((await put(t, gone, ["course"])).status).toBe(404);
    expect((await put(await appToken(sec), plain, ["course"])).status).toBe(403);
    expect((await put(await appToken(plain), plain, ["course"])).status).toBe(403);
    expect((await put(t, plain, "course")).status).toBe(422);
  });

  it("a holder of staff.manage who lacks the permissions of a position cannot hand it out", async () => {
    const mgr = await person("mgr", "管理人", ["sound"]);
    db.raw.prepare("INSERT INTO staff_grants (member_id, permission, scope, granted_at) VALUES (?, 'staff.manage', 'all', 'x')").run(mgr);
    const plain = await person("plain", "王小明");
    const t = await appToken(mgr);
    expect((await put(t, plain, ["reviewer"])).status).toBe(403); // review permissions are not his
    expect((await put(t, plain, ["course"])).status).toBe(200); // course only has what he already holds
  });
});
