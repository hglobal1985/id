import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { createTestD1, type TestD1 } from "./helpers/d1.mjs";
import { createSession, upsertMemberByGoogle } from "../src/db/identity";
import type { Env } from "../src/env";
import { iconsPerRow, platformKeyOf, validateSocialUrl } from "../src/social/rules";
import { builtinIcon } from "../src/social/icons";

const ISSUER = "https://id.test.example";
let db: TestD1;
let env: Env;
let app: ReturnType<typeof createApp>;
const now = new Date();
interface P {
  id: string;
  cookie: string;
}

async function person(sub: string, name: string, roles: string[] = []): Promise<P> {
  const { member } = await upsertMemberByGoogle(db, { sub, emailVerified: true, name, email: `${sub}@example.com` }, "TW", now, "req");
  const { token } = await createSession(db, member.id, now);
  for (const r of roles) db.raw.prepare("INSERT INTO staff_roles (member_id, role, granted_at) VALUES (?, ?, 'x')").run(member.id, r);
  return { id: member.id, cookie: token };
}

beforeEach(() => {
  db = createTestD1();
  env = { DB: db, ENVIRONMENT: "test", ISSUER } as Env;
  app = createApp({ now: () => now });
});

const req = (p: P | null, method: string, path: string, body?: unknown, raw?: { type: string; data: Uint8Array }) =>
  app.request(
    path,
    {
      method,
      headers: {
        ...(p ? { cookie: `__Host-hgid_session=${p.cookie}` } : {}),
        ...(method !== "GET" ? { origin: ISSUER } : {}),
        ...(raw ? { "content-type": raw.type } : body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    },
    env,
  );

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
type Link = { id: string; platform_key: string; platform_name: string | null; url: string; label: string | null; icon_url: string; custom: boolean };

describe("social rules (unit)", () => {
  it("urls: a missing http:// or https:// is added (https), a typed one is kept; real host, no credentials, no spaces", () => {
    expect(validateSocialUrl(" https://www.instagram.com/abc ")).toEqual({ ok: true, url: "https://www.instagram.com/abc" });
    expect(validateSocialUrl("www.instagram.com/abc")).toEqual({ ok: true, url: "https://www.instagram.com/abc" });
    expect(validateSocialUrl("line.me/ti/p/abc")).toEqual({ ok: true, url: "https://line.me/ti/p/abc" });
    expect(validateSocialUrl("//x.com/me")).toEqual({ ok: true, url: "https://x.com/me" });
    expect(validateSocialUrl("http://old.example.com/page")).toEqual({ ok: true, url: "http://old.example.com/page" }); // typed http stays
    expect(validateSocialUrl("HTTPS://Example.com/Path")).toEqual({ ok: true, url: "https://example.com/Path" });
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:a@b.co", "ftp://a.example.com", "https://localhost", "localhost", "https://u:p@a.example.com", "https://a.example.com/a b", "", 5, "x".repeat(301)]) {
      expect(validateSocialUrl(bad).ok, String(bad)).toBe(false);
    }
  });
  it("5 icons per row, 7 (smaller) once more than two rows would be needed", () => {
    expect([0, 1, 5, 10].map(iconsPerRow)).toEqual([5, 5, 5, 5]);
    expect([11, 20].map(iconsPerRow)).toEqual([7, 7]);
  });
  it("platform keys come from latin letters and never collide", () => {
    expect(platformKeyOf("Mastodon", () => false)).toBe("mastodon");
    expect(platformKeyOf("Mastodon", (k) => k === "mastodon")).toBe("mastodon2");
    expect(platformKeyOf("微博", () => false)).toBe("platform");
  });
  it("every seeded platform has a drawing; the two Amway icons are the owner's images", () => {
    for (const k of ["line", "instagram", "facebook", "youtube", "x", "custom"]) expect(builtinIcon(k).mime).toBe("image/svg+xml");
    expect(builtinIcon("amway_share").mime).toBe("image/png");
    expect(builtinIcon("amway_ishare").mime).toBe("image/png");
    expect(builtinIcon("nope")).toBe(builtinIcon("custom"));
  });
});

describe("social links", () => {
  it("platforms come in the owner's order: 安麗分享購 first, 自定義 last", async () => {
    const a = await person("a", "甲");
    const res = await req(a, "GET", "/v1/social/platforms");
    expect(res.status).toBe(200);
    const { platforms } = (await res.json()) as { platforms: { key: string; name: string; icon_url: string; custom: boolean }[] };
    expect(platforms.map((p) => p.name)).toEqual(["安麗分享購", "安麗iShare", "LINE", "脆 Threads", "Dcard", "IG", "臉書 Facebook", "YouTube", "Spotify", "微信 WeChat", "電報 Telegram", "WhatsApp", "抖音", "小紅書", "X", "Discord", "Google Maps", "自定義"]);
    expect(platforms.at(-1)?.custom).toBe(true);
    expect(platforms[0]?.icon_url).toMatch(/\/icons\/social\/platform\/amway_share\?v=1$/);
    expect((await req(null, "GET", "/v1/social/platforms")).status).toBe(401);
  });

  it("adds, lists and removes links; the same platform may be added many times; urls are checked", async () => {
    const a = await person("a", "甲");
    const add = (platform_key: string, url: string, label?: string) => req(a, "POST", "/v1/me/social-links", { platform_key, url, ...(label ? { label } : {}) });
    expect((await add("line", "javascript:alert(1)")).status).toBe(422);
    const fixed = (await (await add("line", "line.me/ti/p/fix")).json()) as Link; // no scheme typed: https:// is added
    expect(fixed.url).toBe("https://line.me/ti/p/fix");
    expect(((await (await add("line", "http://line.me/typed")).json()) as Link).url).toBe("http://line.me/typed"); // typed http stays
    await req(a, "DELETE", `/v1/me/social-links/${fixed.id}`);
    expect((await add("nope", "https://line.me/x")).status).toBe(422);
    const first = (await (await add("instagram", "https://www.instagram.com/one")).json()) as Link;
    await add("instagram", "https://www.instagram.com/two");
    await add("line", "https://line.me/ti/p/abc");
    const list = (await (await req(a, "GET", "/v1/me/social-links")).json()) as { links: Link[]; max: number };
    expect(list.links.map((l) => l.url)).toEqual(["http://line.me/typed", "https://www.instagram.com/one", "https://www.instagram.com/two", "https://line.me/ti/p/abc"]);
    expect(list.links.find((l) => l.platform_key === "instagram")?.icon_url).toBe(`${ISSUER}/icons/social/platform/instagram?v=1`);
    expect(list.max).toBe(30);
    // Someone else's link cannot be removed.
    const b = await person("b", "乙");
    expect((await req(b, "DELETE", `/v1/me/social-links/${first.id}`)).status).toBe(404);
    expect((await req(a, "DELETE", `/v1/me/social-links/${first.id}`)).status).toBe(200);
    expect(((await (await req(a, "GET", "/v1/me/social-links")).json()) as { links: Link[] }).links).toHaveLength(3);
    // At most 30.
    for (let i = 0; i < 27; i++) await add("x", `https://x.com/u${i}`);
    expect((await add("x", "https://x.com/more")).status).toBe(409);
  });

  it("自定義 links take a small icon of their own (checked by its bytes); other platforms refuse one", async () => {
    const a = await person("a", "甲");
    const custom = (await (await req(a, "POST", "/v1/me/social-links", { platform_key: "custom", url: "https://my.example.com/me", label: "我的網站" })).json()) as Link;
    expect(custom).toMatchObject({ label: "我的網站", custom: true });
    expect((await req(a, "PUT", `/v1/me/social-links/${custom.id}/icon`, undefined, { type: "image/png", data: new TextEncoder().encode("<svg onload=alert(1)>") })).status).toBe(422);
    expect((await req(a, "PUT", `/v1/me/social-links/${custom.id}/icon`, undefined, { type: "image/png", data: new Uint8Array(17 * 1024).fill(1) })).status).toBe(413);
    const ok = await req(a, "PUT", `/v1/me/social-links/${custom.id}/icon`, undefined, { type: "image/png", data: PNG });
    expect(ok.status).toBe(200);
    const icon = await app.request(`/icons/social/link/${custom.id}`, {}, env);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
    expect(icon.headers.get("x-content-type-options")).toBe("nosniff");
    const line = (await (await req(a, "POST", "/v1/me/social-links", { platform_key: "line", url: "https://line.me/x" })).json()) as Link;
    expect((await req(a, "PUT", `/v1/me/social-links/${line.id}/icon`, undefined, { type: "image/png", data: PNG })).status).toBe(404);
  });

  it("serves the built-in icons (SVG drawings, the owner's PNGs) as sandboxed images", async () => {
    const svg = await app.request("/icons/social/platform/line", {}, env);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg.headers.get("content-security-policy")).toContain("sandbox");
    expect((await svg.text()).startsWith("<svg")).toBe(true);
    const png = await app.request("/icons/social/platform/amway_share", {}, env);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await png.arrayBuffer())[1]).toBe(0x50);
    expect((await app.request("/icons/social/platform/deleted-one", {}, env)).headers.get("content-type")).toBe("image/svg+xml"); // generic link icon
    expect((await app.request("/icons/social/link/00000000-0000-0000-0000-000000000000", {}, env)).status).toBe(404);
  });
});

describe("social platforms (super admin)", () => {
  it("only the super admin adds, renames, reorders, re-icons and deletes platforms", async () => {
    const sa = await person("sa", "超管", ["super_admin"]);
    const sec = await person("sec", "秘書", ["secretary"]);
    expect((await req(sec, "GET", "/v1/admin/social-platforms")).status).toBe(403);
    const list = (await (await req(sa, "GET", "/v1/admin/social-platforms")).json()) as { platforms: { key: string; links: number; custom: boolean }[] };
    expect(list.platforms).toHaveLength(18);

    const added = (await (await req(sa, "POST", "/v1/admin/social-platforms", { name: "Mastodon" })).json()) as { key: string };
    expect(added.key).toBe("mastodon");
    // New platforms come before 自定義; the generic icon is used until one is uploaded.
    const names = ((await (await req(sa, "GET", "/v1/admin/social-platforms")).json()) as { platforms: { key: string }[] }).platforms.map((p) => p.key);
    expect(names.indexOf("mastodon")).toBeLessThan(names.indexOf("custom"));
    expect((await req(sa, "PUT", "/v1/admin/social-platforms/mastodon", { name: "長毛象" })).status).toBe(200);
    expect((await req(sa, "PUT", "/v1/admin/social-platforms/nope", { name: "x" })).status).toBe(404);

    // Reorder must list every platform exactly once.
    expect((await req(sa, "POST", "/v1/admin/social-platforms/reorder", { keys: names.slice(1) })).status).toBe(422);
    expect((await req(sa, "POST", "/v1/admin/social-platforms/reorder", { keys: [...names].reverse() })).status).toBe(200);
    const a = await person("a", "甲");
    const after = (await (await req(a, "GET", "/v1/social/platforms")).json()) as { platforms: { key: string }[] };
    expect(after.platforms[0]?.key).toBe("custom");

    // Icon: raster only, small; the version changes so caches refresh; reset goes back to the built-in drawing.
    expect((await req(sa, "PUT", "/v1/admin/social-platforms/line/icon", undefined, { type: "image/png", data: new TextEncoder().encode("<svg/>") })).status).toBe(422);
    expect((await req(sa, "PUT", "/v1/admin/social-platforms/line/icon", undefined, { type: "image/png", data: new Uint8Array(33 * 1024).fill(1) })).status).toBe(413);
    expect((await req(sa, "PUT", "/v1/admin/social-platforms/line/icon", undefined, { type: "image/png", data: PNG })).status).toBe(200);
    expect((await app.request("/icons/social/platform/line", {}, env)).headers.get("content-type")).toBe("image/png");
    const line = ((await (await req(a, "GET", "/v1/social/platforms")).json()) as { platforms: { key: string; icon_url: string }[] }).platforms.find((p) => p.key === "line");
    expect(line?.icon_url).toMatch(/\?v=2$/);
    expect((await req(sa, "DELETE", "/v1/admin/social-platforms/line/icon")).status).toBe(200);
    expect((await app.request("/icons/social/platform/line", {}, env)).headers.get("content-type")).toBe("image/svg+xml");

    // Delete: not 自定義; existing links stay and fall back to the generic icon.
    await req(a, "POST", "/v1/me/social-links", { platform_key: "mastodon", url: "https://mastodon.example.com/@a" });
    expect((await req(sa, "DELETE", "/v1/admin/social-platforms/custom")).status).toBe(404);
    expect((await req(sa, "DELETE", "/v1/admin/social-platforms/mastodon")).status).toBe(200);
    const links = ((await (await req(a, "GET", "/v1/me/social-links")).json()) as { links: Link[] }).links;
    expect(links).toHaveLength(1);
    expect(links[0]?.platform_name).toBeNull();
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'social.platform.%'").get()?.n).toBeGreaterThanOrEqual(6);
  });
});

describe("social icons on the public page and in the data export", () => {
  it("icons under the name, centered, 5 per row (7 when crowded), a 複製 tag each, links open in a new window", async () => {
    const a = await person("a", "甲");
    const n = db.raw.prepare("SELECT country, number FROM member_numbers WHERE member_id = ?").get(a.id) as { country: string; number: string };
    const id = n.number;
    expect(await (await req(null, "GET", `/${id}`)).text()).not.toContain('class="socials');
    await req(a, "POST", "/v1/me/social-links", { platform_key: "line", url: "https://line.me/ti/p/abc" });
    await req(a, "POST", "/v1/me/social-links", { platform_key: "custom", url: "https://my.example.com/?a=1&b=2", label: '"><b>x</b>' });
    let html = await (await req(null, "GET", `/${id}`)).text();
    expect(html).toContain('<div class="socials">');
    expect(html).toContain('href="https://line.me/ti/p/abc" target="_blank" rel="noopener noreferrer nofollow"');
    expect(html).toContain('data-url="https://line.me/ti/p/abc">複製</button>');
    expect(html).toContain("/icons/social/platform/line?v=1");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;"); // labels are escaped
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain('src="/assets/social.js"');
    expect(html).not.toMatch(/ style="/);
    for (let i = 0; i < 9; i++) await req(a, "POST", "/v1/me/social-links", { platform_key: "x", url: `https://x.com/u${i}` });
    html = await (await req(null, "GET", `/${id}`)).text();
    expect(html).toContain('<div class="socials dense">'); // 11 icons: more than two rows of five
    // The icons come before the profile rows; the owner's export lists the links; deleting the account removes them.
    expect(html.indexOf("socials")).toBeLessThan(html.indexOf("還沒有公開的資料") > 0 ? html.indexOf("還沒有公開的資料") : html.length);
    const data = (await (await req(a, "GET", "/v1/me/export")).json()) as { social_links: unknown[] };
    expect(data.social_links).toHaveLength(11);
    expect((await req(a, "POST", "/v1/me/delete-account")).status).toBe(200);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM social_links").get()?.n).toBe(0);
  });
});
