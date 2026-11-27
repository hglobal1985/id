import { describe, it, expect } from "vitest";
import { ECO_CATALOG, ECO_FEATURES, EcoError, appVisibleConfig, checkSiteUrl, normalizeSettings, settingsFromStored } from "../src/platform/eco-features";

describe("生態系統功能：設定規則", () => {
  it("每項功能都有預設值，而且預設值本身通過驗證", () => {
    for (const k of ECO_FEATURES) expect(normalizeSettings(k, ECO_CATALOG[k].defaults)).toEqual(ECO_CATALOG[k].defaults);
  });

  it("巡檢網址只允許 hglobal1985.com 的 https", () => {
    expect(checkSiteUrl("https://learn.hglobal1985.com/api/v2/version")).toBe("https://learn.hglobal1985.com/api/v2/version");
    for (const bad of ["http://learn.hglobal1985.com/", "https://evil.example/", "https://hglobal1985.com.evil.example/", "https://a:b@id.hglobal1985.com/", "https://id.hglobal1985.com:8443/", "not a url", "https://127.0.0.1/"]) {
      expect(() => checkSiteUrl(bad)).toThrow(EcoError);
    }
  });

  it("頻率、星期、保留份數、網站清單都有範圍", () => {
    expect(() => normalizeSettings("uptime_watch", { interval_minutes: 1 })).toThrow(EcoError);
    expect(() => normalizeSettings("uptime_watch", { sites: new Array(11).fill({ name: "a", url: "https://id.hglobal1985.com/" }) })).toThrow(EcoError);
    expect(() => normalizeSettings("uptime_watch", { sites: [{ name: "a", url: "https://id.hglobal1985.com/" }, { name: "b", url: "https://id.hglobal1985.com/" }] })).toThrow(EcoError);
    expect(() => normalizeSettings("error_digest", { weekday: 7 })).toThrow(EcoError);
    expect(() => normalizeSettings("weekly_backup", { keep: 0 })).toThrow(EcoError);
    expect(() => normalizeSettings("weekly_backup", { keep: 13 })).toThrow(EcoError);
    expect(() => normalizeSettings("error_digest", { enabled: "yes" })).toThrow(EcoError);
    expect(normalizeSettings("weekly_backup", { keep: 3, weekday: 6 })).toMatchObject({ keep: 3, weekday: 6, enabled: true });
  });

  it("資料庫存的設定壞掉時退回預設值", () => {
    expect(settingsFromStored("uptime_watch", "{壞掉")).toEqual(ECO_CATALOG.uptime_watch.defaults);
    expect(settingsFromStored("uptime_watch", null)).toEqual(ECO_CATALOG.uptime_watch.defaults);
  });

  it("App 看到的設定：關閉或不參與就是 enabled false，且看不到通知對象與網址", () => {
    const all = Object.fromEntries(ECO_FEATURES.map((k) => [k, structuredClone(ECO_CATALOG[k].defaults)])) as Parameters<typeof appVisibleConfig>[0];
    all.error_digest.enabled = false;
    const cfg = appVisibleConfig(all, new Map([["screenshot_test", false]]));
    expect(cfg.error_digest).toEqual({ enabled: false });
    expect(cfg.screenshot_test).toEqual({ enabled: false });
    expect(cfg.uptime_watch).toEqual({ enabled: true });
    expect(cfg.weekly_backup).toEqual({ enabled: true, weekday: 0, keep: 8 });
    expect(JSON.stringify(cfg)).not.toContain("notify");
  });
});
