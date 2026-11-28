import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { base64url } from "../src/lib/crypto";
import type { Env } from "../src/env";

const ISSUER = "https://id.test.example";
const RP = "id.test.example";
const jwk = await (async () => {
  const { privateKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "passkey-test" });
})();

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
let now = new Date();
interface P { id: string; cookie: string }
async function person(sub: string, roles: string[] = []): Promise<P> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name: sub, email: `${sub}@example.com` }, "TW", now, "req");
  const { token } = await createSession(db, member.id, now);
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  return { id: member.id, cookie: token };
}
const req = (p: P, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie: `__Host-hgid_session=${p.cookie}`, ...(method !== "GET" ? { origin: ISSUER } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined }, env);

const sha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const cat = (...a: Uint8Array[]): Uint8Array<ArrayBuffer> => new Uint8Array(a.flatMap((x) => [...x]));
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** 假的 authenticator：ES256 金鑰，產生註冊與登入的回應。 */
async function authenticator() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", kp.publicKey)) as ArrayBuffer);
  const credId = crypto.getRandomValues(new Uint8Array(16));
  let counter = 0;
  const rpHash = await sha(new TextEncoder().encode(RP));
  const clientData = (type: string, challenge: string, origin = ISSUER) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
  return {
    credentialId: base64url(credId),
    async register(challenge: string, o: { flags?: number } = {}) {
      const cdj = clientData("webauthn.create", challenge);
      const authData = cat(rpHash, new Uint8Array([o.flags ?? 0x45]), u32(0), new Uint8Array(16), new Uint8Array([0, credId.length]), credId);
      return { credential_id: base64url(credId), client_data_json: base64url(cdj), authenticator_data: base64url(authData), public_key: base64url(spki), alg: -7 };
    },
    async assert(challenge: string, o: { flags?: number; counter?: number; origin?: string } = {}) {
      const cdj = clientData("webauthn.get", challenge, o.origin);
      counter = o.counter ?? counter + 1;
      const authData = cat(rpHash, new Uint8Array([o.flags ?? 0x05]), u32(counter));
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, cat(authData, await sha(cdj))));
      return { credential_id: base64url(credId), client_data_json: base64url(cdj), authenticator_data: base64url(authData), signature: base64url(sig) };
    },
  };
}

beforeEach(() => {
  now = new Date();
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk, WEBHOOK_SIGNING_KEY: "k" } as Env;
  app = createApp({ now: () => now });
  db.raw.prepare("INSERT INTO oauth_clients (client_id, name, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at) VALUES ('elearning', 'x', 'none', '[]', 'openid', 'active', 'x', 'x')").run();
});

const bridge = (p: P) => req(p, "POST", "/v1/admin/platform/bridge-secret", { rotate: false });
const addPasskey = async (p: P, a: Awaited<ReturnType<typeof authenticator>>) => {
  const o = (await (await req(p, "POST", "/v1/admin/passkeys/register/options")).json()) as { challenge: string };
  return req(p, "POST", "/v1/admin/passkeys/register/verify", { ...(await a.register(o.challenge)), name: "測試" });
};
const confirmWith = async (p: P, a: Awaited<ReturnType<typeof authenticator>>, o: Parameters<Awaited<ReturnType<typeof authenticator>>["assert"]>[1] = {}) => {
  const opt = (await (await req(p, "POST", "/v1/admin/passkeys/auth/options")).json()) as { challenge: string };
  return req(p, "POST", "/v1/admin/passkeys/auth/verify", await a.assert(opt.challenge, o));
};

describe("passkey replaces the re-sign-in for dangerous admin operations", () => {
  it("fresh sign-in passes; after 10 minutes: no passkey → setup required; add passkey; passkey confirmation passes again", async () => {
    const sa = await person("sa", ["super_admin"]);
    expect((await bridge(sa)).status).toBe(200); // just signed in
    now = new Date(now.getTime() + 11 * 60_000);
    const r = await bridge(sa);
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("passkey_setup_required");
    // 第一把 passkey 不必重新登入，任何有效的登入階段都能建立（杜杜龍 2026-11-28）
    const sa2 = sa;
    const a = await authenticator();
    expect((await addPasskey(sa2, a)).status).toBe(200);
    expect(((await (await req(sa2, "GET", "/v1/admin/passkeys")).json()) as { passkeys: unknown[] }).passkeys).toHaveLength(1);
    now = new Date(now.getTime() + 11 * 60_000);
    const stale = await bridge(sa2);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("passkey_required");
    expect((await confirmWith(sa2, a)).status).toBe(200);
    expect((await bridge(sa2)).status).toBe(200);
    // 已經有 passkey 後，再加新的 passkey 要先用 passkey 確認過；確認過的 10 分鐘內可以加
    const b = await authenticator();
    now = new Date(now.getTime() + 11 * 60_000);
    const o2 = await req(sa2, "POST", "/v1/admin/passkeys/register/options");
    expect(o2.status).toBe(401);
    expect(((await o2.json()) as { error: { code: string } }).error.code).toBe("passkey_required");
    expect((await confirmWith(sa2, a)).status).toBe(200);
    expect((await addPasskey(sa2, b)).status).toBe(200);
    expect(JSON.stringify(db.raw.prepare("SELECT action, detail FROM audit_log WHERE action LIKE 'passkey.%'").all())).toContain("passkey.confirm");
  });

  it("rejects: wrong origin, no user verification, replayed challenge, counter going backwards, another member's challenge", async () => {
    const sa = await person("sa", ["super_admin"]);
    const a = await authenticator();
    expect((await addPasskey(sa, a)).status).toBe(200);
    const o = async () => ((await (await req(sa, "POST", "/v1/admin/passkeys/auth/options")).json()) as { challenge: string }).challenge;
    let c = await o();
    expect((await req(sa, "POST", "/v1/admin/passkeys/auth/verify", await a.assert(c, { origin: "https://evil.example" }))).status).toBe(400);
    c = await o();
    expect((await req(sa, "POST", "/v1/admin/passkeys/auth/verify", await a.assert(c, { flags: 0x01 }))).status).toBe(400); // 沒有使用者驗證旗標
    c = await o();
    const good = await a.assert(c, { counter: 5 });
    expect((await req(sa, "POST", "/v1/admin/passkeys/auth/verify", good)).status).toBe(200);
    expect((await req(sa, "POST", "/v1/admin/passkeys/auth/verify", good)).status).toBe(400); // 挑戰碼單次使用
    c = await o();
    expect((await req(sa, "POST", "/v1/admin/passkeys/auth/verify", await a.assert(c, { counter: 3 }))).status).toBe(400); // 計數器倒退
    const other = await person("other", ["super_admin"]);
    c = await o();
    expect((await req(other, "POST", "/v1/admin/passkeys/auth/verify", await a.assert(c, { counter: 9 }))).status).toBe(400); // 別人的挑戰碼
  });

  it("only staff can use passkey routes; a non-staff member gets 403", async () => {
    const m = await person("m");
    expect((await req(m, "GET", "/v1/admin/passkeys")).status).toBe(403);
  });
});
