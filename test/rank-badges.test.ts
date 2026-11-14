// Rank badge gallery (ADR 0027): the API gives every rank option a badge_url, the picture is public, the back office manages it.
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { fakeR2, type FakeR2 } from "./helpers/r2";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const SCOPE = "openid profile.read amway.read";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "badge-test" });
})();

/** The header of a PNG of the given size (the server only reads the header). */
function png(w: number, h: number, extra = 0): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

let db: TestD1;
let r2: FakeR2;
let env: Env;
let app: ReturnType<typeof createApp>;

async function person(sub: string, roles: string[] = []) {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name: sub }, "TW", new Date(), "r");
  const { token: cookie, session } = await createSession(db, member.id, new Date());
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  const token = (await issueTokens(env, defaultDeps, ISSUER, { clientId: "app", memberId: member.id, sessionId: session.id, scope: SCOPE, authTime: 0 })).access_token;
  return { cookie, token };
}
beforeEach(() => {
  db = createTestD1();
  r2 = fakeR2();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk, FILES: r2 as unknown as R2Bucket } as Env;
  app = createApp();
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('app','a','none','[]',?, 'active','x','x')").run(SCOPE);
});
const admin = (p: { cookie: string }, method: string, path: string, body?: Uint8Array) =>
  app.request(path, { method, headers: { cookie: `__Host-hgid_session=${p.cookie}`, ...(method !== "GET" ? { origin: ISSUER } : {}), ...(body ? { "content-type": "image/png" } : {}) }, body }, env);
type Opt = { value: string; label: string; badge_url?: string | null; badge?: { width: number; height: number; art_top: number; art_bottom: number } | null };
const rankOptions = async (p: { token: string }) => {
  const r = await app.request("/v1/amway/field-definitions", { headers: { authorization: `Bearer ${p.token}` } }, env);
  expect(r.status).toBe(200);
  return ((await r.json()) as { fields: { key: string; options?: Opt[] }[] }).fields;
};

describe("badge_url in the rank options", () => {
  it("24 of the 33 rank options have a badge, the other 9 are null; other option lists are untouched", async () => {
    const m = await person("m");
    const fields = await rankOptions(m);
    const rank = fields.find((f) => f.key === "rank")!.options!;
    expect(rank).toHaveLength(33);
    const nulls = rank.filter((o) => o.badge_url === null).map((o) => o.value).sort();
    expect(nulls).toEqual(["none", "r03", "r06", "r09", "r12", "r12a", "r15", "r18", "r21"].sort());
    expect(rank.filter((o) => o.badge_url).length).toBe(24);
    for (const o of rank.filter((x) => x.badge_url === null)) expect(o.badge).toBeNull();
    const dd = rank.find((o) => o.value === "f_double_diamond")!;
    expect(dd).toMatchObject({ label: "創辦人雙鑽石", badge_url: `${ISSUER}/badges/f_double_diamond.png?v=1`, badge: { width: 380, height: 720, art_top: 138, art_bottom: 594 } });
    expect(rank.find((o) => o.value === "crown_ambassador")?.badge).toEqual({ width: 380, height: 720, art_top: 32, art_bottom: 694 });
    expect(rank.find((o) => o.value === "r15b")?.badge).toEqual({ width: 380, height: 720, art_top: 257, art_bottom: 463 });
    // Existing fields stay as they were: still value + label, in the same order.
    expect(rank.slice(0, 2).map((o) => o.value)).toEqual(["none", "r03"]);
    const system = fields.find((f) => f.key === "education_system")?.options ?? [];
    for (const o of system) expect("badge_url" in o).toBe(false);
  });
});

describe("the public picture", () => {
  it("is served from R2 to anyone, cacheable for a year, as an image only", async () => {
    r2.store.set("badges/f_double_diamond.png", { bytes: png(380, 720), uploaded: new Date() });
    const res = await app.request("/badges/f_double_diamond.png?v=1", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(33);
    expect((await app.request("/badges/nope.png", {}, env)).status).toBe(404);
    expect((await app.request("/badges/..%2Favatars%2Fx.png", {}, env)).status).toBe(404);
    expect((await app.request("/badges/f_double_diamond.png", {}, { ...env, FILES: undefined } as Env)).status).toBe(404);
  });
});

describe("back office: upload, replace, remove", () => {
  it("only the super admin; a picture must be a 380x720 PNG; a replacement changes the address; a new rank gets its badge here", async () => {
    const sa = await person("sa", ["super_admin"]);
    const sec = await person("sec", ["secretary"]);
    expect((await admin(sec, "GET", "/v1/admin/rank-badges")).status).toBe(403);
    expect((await admin(sec, "PUT", "/v1/admin/rank-badges/r15?art_top=100&art_bottom=500", png(380, 720))).status).toBe(403);
    const list = (await (await admin(sa, "GET", "/v1/admin/rank-badges")).json()) as { ranks: Opt[]; storage: boolean };
    expect(list.storage).toBe(true);
    expect(list.ranks.filter((r) => r.badge_url).length).toBe(24);

    // The bad ones.
    expect((await admin(sa, "PUT", "/v1/admin/rank-badges/r15?art_top=100&art_bottom=500", png(380, 700))).status).toBe(422);
    expect((await admin(sa, "PUT", "/v1/admin/rank-badges/r15?art_top=100&art_bottom=500", new TextEncoder().encode("<html>not a png at all, but long enough......"))).status).toBe(422);
    expect((await admin(sa, "PUT", "/v1/admin/rank-badges/r15?art_top=500&art_bottom=100", png(380, 720))).status).toBe(422);
    expect((await admin(sa, "PUT", "/v1/admin/rank-badges/r15?art_top=0&art_bottom=721", png(380, 720))).status).toBe(422);
    expect((await admin(sa, "PUT", "/v1/admin/rank-badges/r15?art_top=100&art_bottom=500", png(380, 720, 257 * 1024))).status).toBe(413);
    expect((await admin(sa, "PUT", "/v1/admin/rank-badges/nope?art_top=100&art_bottom=500", png(380, 720))).status).toBe(404);
    expect(r2.store.size).toBe(0);

    // A first picture for a rank without one.
    let res = await admin(sa, "PUT", "/v1/admin/rank-badges/r15?art_top=120&art_bottom=600", png(380, 720));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ saved: true, badge_url: `${ISSUER}/badges/r15.png?v=1`, badge: { art_top: 120, art_bottom: 600 } });
    expect(r2.store.has("badges/r15.png")).toBe(true);
    // A replacement: same file name, new version, so the address changes and caches cannot serve the old one.
    res = await admin(sa, "PUT", "/v1/admin/rank-badges/r15?art_top=130&art_bottom=610", png(380, 720));
    expect(((await res.json()) as { badge_url: string }).badge_url).toBe(`${ISSUER}/badges/r15.png?v=2`);
    const m = await person("m");
    expect((await rankOptions(m)).find((f) => f.key === "rank")!.options!.find((o) => o.value === "r15")).toMatchObject({ badge_url: `${ISSUER}/badges/r15.png?v=2`, badge: { art_top: 130, art_bottom: 610 } });

    // A rank added later (by a migration) is managed the same way.
    db.raw.prepare("INSERT INTO amway_options (field_key, value, label, sort_order, active) VALUES ('rank', 'r27', '27%', 999, 1)").run();
    expect(((await (await admin(sa, "GET", "/v1/admin/rank-badges")).json()) as { ranks: Opt[] }).ranks.find((r) => r.value === "r27")?.badge_url).toBeNull();
    expect((await admin(sa, "PUT", "/v1/admin/rank-badges/r27?art_top=10&art_bottom=700", png(380, 720))).status).toBe(200);

    // Remove: back to "no badge", the picture is gone.
    expect((await admin(sa, "DELETE", "/v1/admin/rank-badges/r15")).status).toBe(200);
    expect((await admin(sa, "DELETE", "/v1/admin/rank-badges/r15")).status).toBe(404);
    expect(r2.store.has("badges/r15.png")).toBe(false);
    expect((await rankOptions(m)).find((f) => f.key === "rank")!.options!.find((o) => o.value === "r15")?.badge_url).toBeNull();
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('rank_badge.save','rank_badge.remove')").get()?.n).toBe(4); // three saves and one removal
  });

  it("without the R2 gallery (local) an upload says so instead of pointing at a missing picture", async () => {
    const sa = await person("sa", ["super_admin"]);
    const noR2 = { ...env, FILES: undefined } as Env;
    const res = await app.request("/v1/admin/rank-badges/r15?art_top=100&art_bottom=500", { method: "PUT", headers: { cookie: `__Host-hgid_session=${sa.cookie}`, origin: ISSUER, "content-type": "image/png" }, body: png(380, 720) }, noR2);
    expect(res.status).toBe(503);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM rank_badges WHERE value = 'r15'").get()?.n).toBe(0);
  });
});
