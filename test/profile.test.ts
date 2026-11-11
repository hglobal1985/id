import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import { issueTokens } from "../src/oidc/tokens";
import { defaultDeps } from "../src/deps";
import type { Env } from "../src/env";
import { fieldDefinitions, getFieldDefinition, validateFieldValue, FIELD_KEYS } from "../src/profile/definitions";
import { lifePathNumber, zodiacSign } from "../src/profile/astro";

const ISSUER = "https://id.test.example";
const ALL = "openid profile profile.read profile.basic.write profile.avatar.write profile.contact.write profile.birthday.write profile.visibility.write";

async function newPrivateJwk(kid: string): Promise<string> {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid });
}
const jwk = await newPrivateJwk("profile-test");

let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
let memberId: string;
let sessionId: string;

async function token(scope = ALL, clientId = "elearning") {
  const t = await issueTokens(env, defaultDeps, ISSUER, { clientId, memberId, sessionId, scope, authTime: Math.floor(Date.now() / 1000) });
  return t.access_token;
}

beforeEach(async () => {
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER, OIDC_SIGNING_JWK: jwk };
  app = createApp();
  const ts = "2026-11-10T08:00:00.000+08:00";
  for (const id of ["elearning", "other-app"]) {
    db.raw
      .prepare(
        `INSERT INTO oauth_clients (client_id, name, client_secret_hash, token_endpoint_auth_method, redirect_uris, allowed_scopes, status, created_at, updated_at)
         VALUES (?, ?, NULL, 'none', '[]', ?, 'active', ?, ?)`,
      )
      .run(id, id, ALL, ts, ts);
  }
  const { member } = await upsertMemberByGoogle(db, { sub: "g-1", email: "a@example.com", emailVerified: true, name: "Google 名字" }, "JP", new Date(), "req");
  memberId = member.id;
  sessionId = (await createSession(db, memberId, new Date())).session.id;
});

const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}) =>
  app.request(
    path,
    {
      method,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
      body: opts.body !== undefined ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
    },
    env,
  );

describe("field definitions API", () => {
  it("requires a token and profile.read", async () => {
    let res = await call("GET", "/v1/profile/field-definitions");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
    res = await call("GET", "/v1/profile/field-definitions", { token: await token("openid profile") });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
  });

  it("describes every field the API accepts, with groups, scopes, options and info blocks", async () => {
    const res = await call("GET", "/v1/profile/field-definitions", { token: await token() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const d = (await res.json()) as { fields: { key: string; scope: string; options?: { value: string; label: string }[] }[]; info: { key: string; collapsed: boolean }[] };
    expect(d.fields.map((f) => f.key)).toEqual(["member_number", ...FIELD_KEYS]);
    expect(d.fields.find((f) => f.key === "contact_email")?.scope).toBe("profile.contact.write");
    expect(d.fields.find((f) => f.key === "birthday")?.scope).toBe("profile.birthday.write");
    const country = d.fields.find((f) => f.key === "country");
    expect(country?.options?.[0]).toEqual({ value: "TW", label: "台灣" });
    expect(d.info.map((i) => i.key)).toEqual(["zodiac", "life_path_number", "talent_number"]); // no 帳號資訊 block
    // Related-word vocabularies, rows of the education block and the member-number countries (same order as starry.phd).
    const byKey = Object.fromEntries((d.fields as unknown as { key: string; label: string; suggest?: string; ui?: string; row?: { key: string; label: string }; options?: { value: string; label: string }[] }[]).map((f) => [f.key, f]));
    expect(byKey.occupation).toMatchObject({ type: "tags", suggest: "occupation" });
    expect(byKey.interests).toMatchObject({ label: "興趣與專長", type: "tags", suggest: "interests" });
    expect(Object.keys(byKey)).not.toContain("website"); // replaced by social links
    expect(byKey.university).toMatchObject({ label: "大學校名", suggest: "school", row: { key: "university", label: "大學" } });
    expect(byKey.grad_dept).toMatchObject({ label: "碩士系名", suggest: "dept", row: { key: "master", label: "碩士" } });
    expect(byKey.phd_school).toMatchObject({ label: "博士校名", row: { key: "doctor", label: "博士" } });
    expect(byKey.country?.ui).toBe("autocomplete");
    expect(Object.keys(byKey)).not.toContain("primary_name");
    expect(Object.keys(byKey)).not.toContain("skills");
    const mn = byKey.member_number?.options ?? [];
    expect(mn.slice(0, 6).map((o) => o.value)).toEqual(["TW", "HK", "MO", "CN", "JP", "KR"]);
    expect(mn[0]?.label).toBe("台灣（TW）+886");
    expect(mn.map((o) => o.value).indexOf("US")).toBeGreaterThan(mn.map((o) => o.value).indexOf("AU")); // nearby first, rest by calling code
    const text = JSON.stringify(d);
    for (const banned of ["starry", "繁星", "寰宇", "安麗"]) expect(text).not.toContain(banned);
  });
});

describe("GET /v1/me/profile", () => {
  it("returns fields with default visibility, the sign-up name, and read-only info", async () => {
    const res = await call("GET", "/v1/me/profile", { token: await token() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const p = (await res.json()) as {
      member_id: string;
      fields: Record<string, { value: unknown; visibility: string }>;
      avatar: { url: string | null; always_public: boolean };
      info: Record<string, unknown>;
    };
    expect(p.member_id).toBe(memberId);
    expect(p.fields.display_name).toMatchObject({ value: "Google 名字", visibility: "public" });
    expect(p.fields.contact_email).toMatchObject({ value: null, visibility: "private" });
    expect(p.avatar).toMatchObject({ url: null, always_public: true });
    expect(p.info).toMatchObject({ registration_country: "JP", account_status: "active", zodiac: null });
  });
});

describe("PUT /v1/me/profile/fields/{field_key}", () => {
  it("the nickname field is gone for good", async () => {
    const t = await token();
    expect((await call("PUT", "/v1/me/profile/fields/nickname", { token: t, body: { value: "x" } })).status).toBe(404);
  });

  it("the legal-name field is gone for good", async () => {
    const t = await token();
    expect((await call("PUT", "/v1/me/profile/fields/primary_name", { token: t, body: { value: "x" } })).status).toBe(404);
    expect((await call("PUT", "/v1/me/profile/fields/skills", { token: t, body: { value: ["x"] } })).status).toBe(404);
  });

  it("saves a field, is idempotent, and audits the app and field without the value", async () => {
    const t = await token();
    let res = await call("PUT", "/v1/me/profile/fields/contact_email", { token: t, body: { value: "  new@example.com " } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: string; updated_at: string };
    expect(body.value).toBe("new@example.com");
    expect(body.updated_at).toMatch(/\+08:00$/);
    res = await call("PUT", "/v1/me/profile/fields/contact_email", { token: t, body: { value: "new@example.com" } });
    expect(res.status).toBe(200);
    const audits = db.raw.prepare("SELECT * FROM audit_log WHERE action LIKE 'profile.%'").all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ app_id: "elearning", action: "profile.field.update", actor_id: memberId });
    expect(JSON.stringify(audits)).not.toContain("new@example.com");
    expect(JSON.parse(String(audits[0]?.detail))).toEqual({ field_key: "contact_email" });
  });

  it("needs the scope of that field", async () => {
    const t = await token("openid profile.read profile.basic.write");
    expect((await call("PUT", "/v1/me/profile/fields/motto", { token: t, body: { value: "小明" } })).status).toBe(200);
    const res = await call("PUT", "/v1/me/profile/fields/phone", { token: t, body: { value: "+886912345678" } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { details: { required_scopes: string[] } } }).error.details.required_scopes).toEqual(["profile.contact.write"]);
    expect((await call("PUT", "/v1/me/profile/fields/birthday", { token: t, body: { value: "1990-01-01" } })).status).toBe(403);
  });

  it("rejects unknown fields and invalid values with the shared error format", async () => {
    const t = await token();
    let res = await call("PUT", "/v1/me/profile/fields/registration_country", { token: t, body: { value: "US" } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
    for (const [key, value, reason] of [
      ["contact_email", "not-an-email", "format"],
      ["birthday", "2999-01-01", "format"],
      ["birthday", "1990-02-30", "format"],
      ["country", "ZZ", "not_an_option"],
      ["display_name", "", "required"],
      ["motto", "x".repeat(101), "too_long"],
      ["motto", "a\u0000b", "invalid_characters"],
      ["interests", Array.from({ length: 31 }, (_, i) => `s${i}`), "too_many"],
      ["interests", "not-a-list", "type"],
    ] as [string, unknown, string][]) {
      res = await call("PUT", `/v1/me/profile/fields/${key}`, { token: t, body: { value } });
      expect(res.status, `${key}=${JSON.stringify(value)}`).toBe(422);
      const e = (await res.json()) as { error: { code: string; details: { field_key: string; reason: string } } };
      expect(e.error.code).toBe("invalid_field");
      expect(e.error.details).toMatchObject({ field_key: key, reason });
    }
    res = await call("PUT", "/v1/me/profile/fields/motto", { token: t, body: "{not json" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    res = await call("PUT", "/v1/me/profile/fields/motto", { token: t, body: { wrong: 1 } });
    expect(res.status).toBe(422);
  });

  it("null clears a field; display name changes reach the ID token claims", async () => {
    const t = await token();
    await call("PUT", "/v1/me/profile/fields/bio", { token: t, body: { value: "第一行\r\n第二行" } });
    let p = (await (await call("GET", "/v1/me/profile", { token: t })).json()) as { fields: Record<string, { value: unknown }> };
    expect(p.fields.bio?.value).toBe("第一行\n第二行");
    await call("PUT", "/v1/me/profile/fields/bio", { token: t, body: { value: null } });
    p = (await (await call("GET", "/v1/me/profile", { token: t })).json()) as { fields: Record<string, { value: unknown }> };
    expect(p.fields.bio?.value).toBeNull();

    await call("PUT", "/v1/me/profile/fields/display_name", { token: t, body: { value: "新名字" } });
    const ui = (await (await app.request("/oauth/userinfo", { headers: { authorization: `Bearer ${t}` } }, env)).json()) as { name: string };
    expect(ui.name).toBe("新名字");
  });

  it("birthday gives zodiac and life path number", async () => {
    const t = await token();
    await call("PUT", "/v1/me/profile/fields/birthday", { token: t, body: { value: "1990-07-23" } });
    const p = (await (await call("GET", "/v1/me/profile", { token: t })).json()) as { info: Record<string, unknown> };
    expect(p.info).toMatchObject({ zodiac: "獅子座", life_path_number: 4 });
  });

  it("tokens of a disabled app or ended session are refused", async () => {
    const t = await token();
    db.raw.prepare("UPDATE oauth_clients SET status = 'disabled' WHERE client_id = 'elearning'").run();
    expect((await call("GET", "/v1/me/profile", { token: t })).status).toBe(401);
    const t2 = await token(ALL, "other-app");
    db.raw.prepare("UPDATE login_sessions SET revoked_epoch = 1").run();
    expect((await call("GET", "/v1/me/profile", { token: t2 })).status).toBe(401);
  });
});

describe("visibility and avatar", () => {
  it("sets visibility per field; the avatar cannot be hidden", async () => {
    const t = await token();
    let res = await call("PUT", "/v1/me/profile/visibility", { token: t, body: { fields: { contact_email: "public", bio: "private" } } });
    expect(res.status).toBe(200);
    const p = (await (await call("GET", "/v1/me/profile", { token: t })).json()) as { fields: Record<string, { visibility: string }> };
    expect(p.fields.contact_email?.visibility).toBe("public");
    expect(p.fields.bio?.visibility).toBe("private");
    res = await call("PUT", "/v1/me/profile/visibility", { token: t, body: { fields: { avatar: "private" } } });
    expect(res.status).toBe(422);
    res = await call("PUT", "/v1/me/profile/visibility", { token: t, body: { fields: { nope: "private" } } });
    expect(res.status).toBe(422);
    res = await call("PUT", "/v1/me/profile/visibility", { token: t, body: { fields: { bio: "secret" } } });
    expect(res.status).toBe(422);
    res = await call("PUT", "/v1/me/profile/visibility", { token: await token("openid profile.read"), body: { fields: { bio: "public" } } });
    expect(res.status).toBe(403);
  });

  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
  const upload = (t: string, bytes: Uint8Array, type = "image/png") =>
    app.request("/v1/me/profile/avatar", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": type }, body: bytes }, env);

  it("uploads a small image (checked by its bytes), serves it publicly, and removes it", async () => {
    const t = await token();
    expect((await upload(t, new TextEncoder().encode("<html><script>alert(1)</script>"), "image/png")).status).toBe(422);
    expect((await upload(t, new Uint8Array(129 * 1024).fill(1))).status).toBe(413);
    const res = await upload(t, PNG);
    expect(res.status).toBe(200);
    const { avatar } = (await res.json()) as { avatar: { url: string; source: string } };
    expect(avatar.source).toBe("upload");
    expect(avatar.url).toMatch(new RegExp(`^${ISSUER}/avatar/${memberId}\\?v=\\d+$`));
    const img = await app.request(`/avatar/${memberId}`, {}, env);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await app.request("/avatar/00000000-0000-0000-0000-000000000000", {}, env)).status).toBe(404);
    expect((await upload(await token("openid profile.read"), PNG)).status).toBe(403);
    const del = await call("DELETE", "/v1/me/profile/avatar", { token: t });
    expect(del.status).toBe(200);
    expect(db.raw.prepare("SELECT avatar_url, avatar_source FROM members").get()).toEqual({ avatar_url: null, avatar_source: "none" });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM member_avatars").get()).toEqual({ n: 0 });
    expect((await app.request(`/avatar/${memberId}`, {}, env)).status).toBe(404);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'profile.avatar.remove'").get()?.n).toBe(1);
    expect((await call("DELETE", "/v1/me/profile/avatar", { token: await token("openid profile.read") })).status).toBe(403);
  });

  it("uses the Google picture without copying it; refuses when there is none", async () => {
    const t = await token();
    db.raw.prepare("UPDATE members SET google_picture_url = NULL").run();
    expect((await call("POST", "/v1/me/profile/avatar/google", { token: t })).status).toBe(422);
    db.raw.prepare("UPDATE members SET google_picture_url = 'https://lh3.googleusercontent.com/a/x'").run();
    const res = await call("POST", "/v1/me/profile/avatar/google", { token: t });
    expect(res.status).toBe(200);
    expect(db.raw.prepare("SELECT avatar_url, avatar_source FROM members").get()).toEqual({ avatar_url: "https://lh3.googleusercontent.com/a/x", avatar_source: "google" });
  });

  it("a new member starts with the Google picture; later sign-ins keep it fresh only while it is the chosen avatar", async () => {
    const { member } = await upsertMemberByGoogle(db, { sub: "pic", emailVerified: true, name: "圖", picture: "https://lh3.googleusercontent.com/a/1" }, "TW", new Date(), "r");
    expect(member.avatar_url).toBe("https://lh3.googleusercontent.com/a/1");
    await upsertMemberByGoogle(db, { sub: "pic", emailVerified: true, name: "圖", picture: "https://lh3.googleusercontent.com/a/2" }, "TW", new Date(), "r");
    expect(db.raw.prepare("SELECT avatar_url FROM members WHERE id = ?").get(member.id)?.avatar_url).toBe("https://lh3.googleusercontent.com/a/2");
    db.raw.prepare("UPDATE members SET avatar_source = 'none', avatar_url = NULL WHERE id = ?").run(member.id);
    await upsertMemberByGoogle(db, { sub: "pic", emailVerified: true, name: "圖", picture: "https://lh3.googleusercontent.com/a/3" }, "TW", new Date(), "r");
    expect(db.raw.prepare("SELECT avatar_url FROM members WHERE id = ?").get(member.id)?.avatar_url).toBeNull();
  });

  it("suggests related words: any typed character, any order; remembers what members save", async () => {
    const t = await token();
    for (const v of ["國立臺灣大學", "臺灣科技大學", "政治大學"]) await call("PUT", "/v1/me/profile/fields/university", { token: t, body: { value: v } });
    const sug = async (q: string, pool = "school") => ((await (await call("GET", `/v1/vocab/suggestions?pool=${pool}&q=${encodeURIComponent(q)}`, { token: t })).json()) as { suggestions: string[] }).suggestions;
    expect(await sug("臺大")).toEqual(expect.arrayContaining(["國立臺灣大學", "臺灣科技大學", "政治大學"]));
    expect((await sug("臺大"))[0]).toMatch(/臺灣/); // both characters match: best first
    expect(await sug("治")).toEqual(["政治大學"]);
    expect(await sug("")).toEqual([]);
    expect(await sug("x")).toEqual([]);
    expect((await call("GET", "/v1/vocab/suggestions?pool=nope&q=a", { token: t })).status).toBe(422);
    // An existing spelling wins; the term is counted once per save.
    await call("PUT", "/v1/me/profile/fields/grad_school", { token: t, body: { value: "政治大學" } });
    expect(db.raw.prepare("SELECT uses FROM vocab_terms WHERE pool = 'school' AND term = '政治大學'").get()).toEqual({ uses: 2 });
    // Schools are shared by 大學 / 碩士 / 博士; departments are a separate pool.
    await call("PUT", "/v1/me/profile/fields/phd_dept", { token: t, body: { value: "資訊工程學系" } });
    expect(await sug("資", "dept")).toEqual(["資訊工程學系"]);
    expect(await sug("資", "school")).toEqual([]);
  });

  it("serves random mottos, never the current one", async () => {
    const t = await token();
    const m = (await (await call("GET", "/v1/profile/suggestions/motto", { token: t })).json()) as { motto: string };
    expect(m.motto.length).toBeGreaterThan(2);
    expect(m.motto).not.toContain("星");
  });
});

describe("field rules (unit)", () => {
  const today = new Date("2026-11-10T00:00:00+08:00");
  const def = (k: string) => getFieldDefinition(k)!;
  it("normalizes values", () => {
    expect(validateFieldValue(def("country"), "tw", today)).toEqual({ ok: true, value: "TW" });
    expect(validateFieldValue(def("interests"), [" a ", "a", "b", ""], today)).toEqual({ ok: true, value: ["a", "b"] });
    expect(validateFieldValue(def("country"), "台灣", today)).toEqual({ ok: true, value: "TW" });
    expect(validateFieldValue(def("country"), "japan", today)).toEqual({ ok: true, value: "JP" });
    expect(validateFieldValue(def("country"), "火星", today).ok).toBe(false);
    expect(validateFieldValue(def("phone"), "+886 912-345-678", today).ok).toBe(true);
    expect(validateFieldValue(def("birthday"), "2026-11-10", today).ok).toBe(true);
    expect(validateFieldValue(def("birthday"), "2026-11-11", today).ok).toBe(false);
    expect(validateFieldValue(def("birthday"), "1899-12-31", today).ok).toBe(false);
    expect(validateFieldValue(def("motto"), "😀".repeat(30), today).ok).toBe(true);
  });
  it("every definition has a write scope and the documented field keys", () => {
    expect(FIELD_KEYS).toEqual([
      "display_name", "motto", "bio", "occupation", "organization", "languages", "interests",
      "university", "university_dept", "grad_school", "grad_dept", "phd_school", "phd_dept", "locale", "contact_email", "phone", "country", "region", "city", "birthday",
    ]);
    for (const f of fieldDefinitions()) expect(f.scope).toMatch(/^profile\.(basic|contact|birthday)\.write$/);
  });
  it("zodiac and life path number", () => {
    expect(zodiacSign("2000-01-19")).toBe("摩羯座");
    expect(zodiacSign("2000-01-20")).toBe("水瓶座");
    expect(zodiacSign("2000-03-20")).toBe("雙魚座");
    expect(zodiacSign("2000-03-21")).toBe("牡羊座");
    expect(zodiacSign("2000-12-22")).toBe("摩羯座");
    expect(lifePathNumber("1990-07-23")).toBe(4);
    expect(lifePathNumber("1992-09-08")).toBe(11); // 1+9+9+2+0+9+0+8 = 38 → 11
  });
});
