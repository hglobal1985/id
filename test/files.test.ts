import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { fakeR2, type FakeR2 } from "./helpers/r2";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";
import { moveAvatarsToR2, sweepAvatars } from "../src/jobs/files";

const ISSUER = "https://id.test.example";
const SCOPE = "openid profile profile.read profile.avatar.write";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "files-test" });
})();
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

let db: TestD1;
let r2: FakeR2;
let env: Env;
let app: ReturnType<typeof createApp>;
let memberId: string;
let token: string;

async function setup(bucket: FakeR2 | undefined) {
  db = createTestD1();
  r2 = bucket as FakeR2;
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk, ...(bucket ? { FILES: bucket as unknown as R2Bucket } : {}) } as Env;
  app = createApp();
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, client_secret_hash, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning','e',NULL,'none','[]',?, 'active','x','x')").run(SCOPE);
  const { member } = await upsertMemberByGoogle(db, { sub: "g-1", emailVerified: true, name: "甲" }, "TW", new Date(), "req");
  memberId = member.id;
  const { session } = await createSession(db, memberId, new Date());
  token = (await issueTokens(env, defaultDeps, ISSUER, { clientId: "elearning", memberId, sessionId: session.id, scope: SCOPE, authTime: Math.floor(Date.now() / 1000) })).access_token;
}
const upload = () => app.request("/v1/me/profile/avatar", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "image/png" }, body: PNG }, env);
const stored = () => db.raw.prepare("SELECT length(data) AS n FROM member_avatars WHERE member_id = ?").get(memberId) as { n: number } | undefined;

describe("avatars in R2", () => {
  beforeEach(() => setup(fakeR2()));

  it("an upload puts the bytes in R2 (D1 keeps only the marker) and /avatar serves them", async () => {
    expect((await upload()).status).toBe(200);
    expect(r2.store.get(`avatars/${memberId}`)?.bytes).toEqual(PNG);
    expect(stored()?.n).toBe(0);
    const img = await app.request(`/avatar/${memberId}`, {}, env);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  it("removing the avatar or switching to the Google picture removes the R2 file", async () => {
    await upload();
    await app.request("/v1/me/profile/avatar", { method: "DELETE", headers: { authorization: `Bearer ${token}` } }, env);
    expect(r2.store.size).toBe(0);
    await upload();
    db.raw.prepare("UPDATE members SET google_picture_url = 'https://lh3.googleusercontent.com/a/x'").run();
    await app.request("/v1/me/profile/avatar/google", { method: "POST", headers: { authorization: `Bearer ${token}` } }, env);
    expect(r2.store.size).toBe(0);
  });

  it("a failing R2 falls back to D1, so the upload still works", async () => {
    await setup(fakeR2({ failPut: true }));
    expect((await upload()).status).toBe(200);
    expect(stored()?.n).toBe(PNG.length);
    expect((await app.request(`/avatar/${memberId}`, {}, env)).status).toBe(200);
  });

  it("moves avatars that are still in D1 into R2, once, and they keep being served", async () => {
    await setup(undefined); // uploaded before R2 existed
    await upload();
    expect(stored()?.n).toBe(PNG.length);
    const bucket = fakeR2();
    expect(await moveAvatarsToR2(db as unknown as D1Database, bucket as unknown as R2Bucket)).toBe(1);
    expect(bucket.store.get(`avatars/${memberId}`)?.bytes).toEqual(PNG);
    expect(stored()?.n).toBe(0);
    expect(await moveAvatarsToR2(db as unknown as D1Database, bucket as unknown as R2Bucket)).toBe(0);
    const withR2 = { ...env, FILES: bucket as unknown as R2Bucket } as Env;
    const img = await app.request(`/avatar/${memberId}`, {}, withR2);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  it("the sweep removes files nobody owns, but keeps owned and brand-new ones", async () => {
    await upload();
    r2.store.set("avatars/orphan-old", { bytes: PNG, uploaded: new Date(Date.now() - 2 * 3600 * 1000) });
    r2.store.set("avatars/orphan-new", { bytes: PNG, uploaded: new Date() });
    r2.store.get(`avatars/${memberId}`)!.uploaded = new Date(Date.now() - 2 * 3600 * 1000);
    expect(await sweepAvatars(db as unknown as D1Database, r2 as unknown as R2Bucket, new Date())).toBe(1);
    expect([...r2.store.keys()].sort()).toEqual([`avatars/${memberId}`, "avatars/orphan-new"].sort());
  });
});
