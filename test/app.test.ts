import { describe, it, expect } from "vitest";
import { createApp, taipeiIso } from "../src/app";

describe("app", () => {
  const app = createApp();

  it("GET /v1/health returns ok with a request id", async () => {
    const res = await app.request("/v1/health", {}, { ENVIRONMENT: "test" } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as Record<string, string>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("hglobal-id");
    expect(body.environment).toBe("test");
    expect(body.time).toMatch(/\+08:00$/);
  });

  it("unknown paths use the shared error format", async () => {
    const res = await app.request("/v1/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; request_id: string } };
    expect(body.error.code).toBe("not_found");
    expect(body.error.request_id).toBeTruthy();
  });

  it("taipeiIso uses the +08:00 offset", () => {
    expect(taipeiIso(new Date("2026-11-10T00:00:00Z"))).toBe("2026-11-10T08:00:00.000+08:00");
  });
});
