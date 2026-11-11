import { describe, it, expect } from "vitest";
import { checkRequestedScope, formatScope, hasScopes } from "../src/oidc/scopes";
import { isRegistrableRedirectUri, isSafeReturnPath, matchRegisteredUri } from "../src/oidc/uris";
import { base64url, isValidCodeVerifier, s256Challenge, timingSafeEqual, utf8, uuidv7, verifyPkceS256 } from "../src/lib/crypto";
import { importSigningKey, signJwt, verifyJwt } from "../src/lib/jwt";
import { escapeHtml } from "../src/web/pages";

describe("scopes", () => {
  const allowed = "openid profile amway.read";
  it("requires openid and rejects unknown or unregistered scopes", () => {
    expect(checkRequestedScope("profile", allowed)).toMatchObject({ ok: false, reason: "missing_openid" });
    expect(checkRequestedScope("openid admin", allowed)).toMatchObject({ ok: false, reason: "unknown_scope", scope: "admin" });
    expect(checkRequestedScope("openid amway.write", allowed)).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(checkRequestedScope("amway.read openid openid", allowed)).toEqual({ ok: true, scopes: ["openid", "amway.read"] });
  });
  it("formats in a stable order and checks grants", () => {
    expect(formatScope(["amway.read", "openid", "profile"])).toBe("openid profile amway.read");
    expect(hasScopes("openid profile", ["profile"])).toBe(true);
    expect(hasScopes("openid", ["profile"])).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows only exact https URLs", () => {
    expect(isRegistrableRedirectUri("https://elearning.hglobal1985.com/auth/callback")).toBe(true);
    expect(isRegistrableRedirectUri("http://elearning.hglobal1985.com/cb")).toBe(false);
    expect(isRegistrableRedirectUri("https://*.hglobal1985.com/cb")).toBe(false);
    expect(isRegistrableRedirectUri("https://a.example/cb#x")).toBe(false);
    expect(matchRegisteredUri("https://a.example/cb", ["https://a.example/cb"])).toBe(true);
    expect(matchRegisteredUri("https://a.example/cb/", ["https://a.example/cb"])).toBe(false);
    expect(matchRegisteredUri("https://a.example/cb?x=1", ["https://a.example/cb"])).toBe(false);
  });
  it("return paths stay on this origin", () => {
    expect(isSafeReturnPath("/oauth/authorize?a=1")).toBe(true);
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", "/a b"]) expect(isSafeReturnPath(bad)).toBe(false);
  });
});

describe("PKCE and crypto", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await s256Challenge(v)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(await verifyPkceS256(v, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(await verifyPkceS256("short", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
  });
  it("compares in constant time and makes UUIDv7 ids", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });
});

describe("JWT", () => {
  it("verifies RS256 and rejects alg none, wrong issuer, audience and expiry", async () => {
    const { privateKey } = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const key = await importSigningKey(JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", privateKey)), kid: "k1" }));
    const now = 1_800_000_000;
    const tok = await signJwt({ iss: "https://i", aud: "c", sub: "s", exp: now + 60 }, key);
    const keys = [key.publicJwk];
    expect((await verifyJwt(tok, keys, { issuer: "https://i", audience: "c", now })).sub).toBe("s");
    await expect(verifyJwt(tok, keys, { issuer: "https://other", now })).rejects.toThrow("iss");
    await expect(verifyJwt(tok, keys, { issuer: "https://i", audience: "x", now })).rejects.toThrow("aud");
    await expect(verifyJwt(tok, keys, { issuer: "https://i", now: now + 600 })).rejects.toThrow("exp");
    const [, p] = tok.split(".");
    const none = `${base64url(utf8(JSON.stringify({ alg: "none", kid: "k1" })))}.${p}.`;
    await expect(verifyJwt(none, keys, { issuer: "https://i", now })).rejects.toThrow("alg");
  });
});

import { initialsOf, tileClass } from "../src/web/initials";
import { trafficLights } from "../src/admin/lights";
import { charUnits, clipName, rankBadge, textUnits } from "../src/web/nav-text";
import { publicId } from "../src/profile/member-number";

describe("member center helpers", () => {
  it("initials: family + given name for Chinese, first + last for Latin, H when empty", () => {
    expect(initialsOf("王小明")).toBe("王小");
    expect(initialsOf("John Smith")).toBe("JS");
    expect(initialsOf("甲")).toBe("甲");
    expect(initialsOf("  ")).toBe("H");
    expect(initialsOf(null)).toBe("H");
  });
  it("App tile colour class is stable and one of c0–c7", () => {
    expect(tileClass("learn")).toBe(tileClass("learn"));
    expect(tileClass("learn")).toMatch(/^c[0-7]$/);
  });
  it("traffic lights: green when quiet, yellow when something waits, red when overdue or stopped", () => {
    const quiet = { appStatuses: ["active"], invalidApps: 0, pendingReviews: 0, oldestReviewDays: null };
    expect(trafficLights(quiet).every((l) => l.color === "green")).toBe(true);
    const c = (over: object) => Object.fromEntries(trafficLights({ ...quiet, ...over }).map((l) => [l.key, l.color]));
    expect(c({ appStatuses: ["active", "paused"] }).apps).toBe("yellow");
    expect(c({ appStatuses: ["killed"] }).apps).toBe("red");
    expect(c({ pendingReviews: 2, oldestReviewDays: 1 }).reviews).toBe("green");
    expect(c({ pendingReviews: 2, oldestReviewDays: 4 }).reviews).toBe("yellow");
    expect(c({ pendingReviews: 2, oldestReviewDays: 8 }).reviews).toBe("red");
    expect(c({ invalidApps: 1 }).invalid_apps).toBe("red");
  });
});

describe("main menu text", () => {
  it("cuts names to 4 Chinese-character widths", () => {
    expect(clipName("王小明")).toBe("王小明");
    expect(clipName("王小明明明")).toBe("王小明明…");
    expect(clipName("Al")).toBe("Al");
    expect(clipName("Alexander Smith")).toBe("Alexand…"); // about 4 character widths of Latin letters
    expect(charUnits("王")).toBe(1);
    expect(textUnits("12%")).toBeCloseTo(1.65);
  });
  it("rank box: 創辦人 becomes F and the font shrinks to fit five characters", () => {
    expect(rankBadge("創辦人鑽石")).toEqual({ text: "F鑽石", size: 0 });
    expect(rankBadge("12%初階")).toEqual({ text: "12%初階", size: 0 });
    expect(rankBadge("創辦人執行專才鑽石")).toEqual({ text: "F執行專才鑽石", size: 2 });
    expect(rankBadge("創辦人雙鑽石")?.size).toBe(0);
    expect(rankBadge("很長很長很長很長的獎銜")?.size).toBe(3);
    expect(rankBadge("無")).toBeNull();
    expect(rankBadge(null)).toBeNull();
  });
  it("public identifier: country code and number, joined, never doubled", () => {
    expect(publicId({ country: "TW", number: "9475831" })).toBe("TW9475831");
    expect(publicId({ country: "TW", number: "TW0112342" })).toBe("TW0112342");
    expect(publicId({ country: "JP", number: "0123" })).toBe("JP0123");
  });
});
