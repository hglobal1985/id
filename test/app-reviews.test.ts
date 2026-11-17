// GET /v1/eligibility/reviews and POST /v1/eligibility/reviews/{id}/decision (ADR 0029):
// an App shows the central 獎銜 / 中心 review queue to the signed-in member's own staff position.
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
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "review-test" });
})();
const key = await importSigningKey(jwk);

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
const now = new Date();

async function person(sub: string, name: string, o: { roles?: string[]; center?: string } = {}) {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name, email: `${sub}@example.com` }, "TW", now, "r");
  for (const r of o.roles ?? []) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  if (o.center) {
    db.raw.prepare("UPDATE members SET amway_enabled = 1 WHERE id = ?").run(member.id);
    const ins = db.raw.prepare("INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'x')");
    ins.run(member.id, "education_system", JSON.stringify("寰宇"), null, "not_required", 1);
    ins.run(member.id, "education_center", JSON.stringify(o.center), null, "approved", 1);
  }
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
/** A pending request about `center` (center_norm is what the back office filters by). */
function request(id: string, memberId: string, fieldKey: string, requested: unknown, centerNorm: string | null) {
  db.raw.prepare("INSERT INTO amway_review_requests (id, member_id, field_key, requested_value, status, created_at, center_norm) VALUES (?,?,?,?, 'pending', ?, ?)").run(id, memberId, fieldKey, JSON.stringify(requested), now.toISOString(), centerNorm);
}
const get = (token: string) => app.request("/v1/eligibility/reviews", { headers: { authorization: `Bearer ${token}` } }, env);
const decide = (token: string, id: string, decision: string) => app.request(`/v1/eligibility/reviews/${id}/decision`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ decision }) }, env);
type Res = { scope: string; reviews: { id: string; display_name: string | null; field_key: string; center: string | null; requested_value: unknown }[] };

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk } as Env;
  app = createApp({ now: () => now });
  clearAppCache();
  allow(["display_name"]);
});

describe("review queue for an App", () => {
  it("reviewer sees only the own center; secretary and super admin see every request; others 403", async () => {
    const reviewer = await person("rv", "審核員", { roles: ["reviewer"], center: "新竹 122" });
    const secretary = await person("sec", "秘書", { roles: ["secretary"] });
    const boss = await person("boss", "超管", { roles: ["super_admin"] });
    const plain = await person("plain", "一般會員");
    const a = await person("a", "阿甲", { center: "新竹 122" });
    const b = await person("b", "阿乙", { center: "南京" });
    request("r1", a, "rank", "gold", "新竹 122");
    request("r2", b, "rank", "silver", "南京");
    request("r3", b, "education_center", "新竹 122", "新竹 122");
    const rv = (await (await get(await appToken(reviewer))).json()) as Res;
    expect(rv.scope).toBe("center");
    expect(rv.reviews.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
    expect(JSON.stringify(rv)).not.toMatch(/example\.com|member_id|phone/);
    expect(rv.reviews.find((r) => r.id === "r1")).toMatchObject({ display_name: "阿甲", field_key: "rank", center: "新竹 122" });
    for (const who of [secretary, boss]) {
      const r = (await (await get(await appToken(who))).json()) as Res;
      expect(r.scope).toBe("all");
      expect(r.reviews.map((x) => x.id).sort()).toEqual(["r1", "r2", "r3"]);
    }
    expect((await get(await appToken(plain))).status).toBe(403);
    expect((await app.request("/v1/eligibility/reviews", {}, env)).status).toBe(401);
  });

  it("a reviewer without an approved center sees nothing; the App needs display_name", async () => {
    const lone = await person("lone", "無中心審核員", { roles: ["reviewer"] });
    const a = await person("a", "阿甲", { center: "新竹 122" });
    request("r1", a, "rank", "gold", "新竹 122");
    expect(((await (await get(await appToken(lone))).json()) as Res).reviews).toEqual([]);
    allow([]);
    const rv = await person("rv", "審核員", { roles: ["reviewer"], center: "新竹 122" });
    const res = await get(await appToken(rv));
    expect(res.status).toBe(403);
  });

  it("deciding follows the same center rule", async () => {
    const reviewer = await person("rv", "審核員", { roles: ["reviewer"], center: "新竹 122" });
    const boss = await person("boss", "超管", { roles: ["super_admin"] });
    const a = await person("a", "阿甲", { center: "新竹 122" });
    const b = await person("b", "阿乙", { center: "南京" });
    request("r1", a, "rank", "gold", "新竹 122");
    request("r2", b, "rank", "silver", "南京");
    const t = await appToken(reviewer);
    expect((await decide(t, "r2", "approve")).status).toBe(403); // another center
    expect((await decide(t, "r1", "bogus")).status).toBe(422);
    expect((await decide(t, "r1", "approve")).status).toBe(200);
    expect((await decide(t, "r1", "approve")).status).toBe(404); // already decided
    expect((await decide(await appToken(boss), "r2", "reject")).status).toBe(200);
    expect((db.raw.prepare("SELECT status FROM amway_review_requests WHERE id = 'r1'").get() as { status: string }).status).toBe("approved");
    expect((db.raw.prepare("SELECT status FROM amway_review_requests WHERE id = 'r2'").get() as { status: string }).status).toBe("rejected");
  });
});
