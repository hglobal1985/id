import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppBindings } from "./env";
import { ErrorBodySchema, errorBody } from "./errors";
import { defaultDeps, type Deps } from "./deps";
import { taipeiIso } from "./lib/time";
import { registerAuthRoutes, html } from "./auth/routes";
import { registerOidcRoutes } from "./oidc/routes";
import { registerOidcDocs } from "./oidc/openapi";
import { ConfigError } from "./oidc/config";
import { messagePage } from "./web/pages";
import { registerProfileRoutes } from "./api/profile";
import { registerSpouseRoutes } from "./api/spouse";
import { registerAmwayRoutes } from "./api/amway";
import { registerEligibilityRoutes } from "./api/eligibility";
import { HTTPException } from "hono/http-exception";

const HealthSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("hglobal-id"),
    environment: z.string(),
    time: z.string().openapi({ description: "ISO 8601 with the Taipei offset (+08:00)." }),
  })
  .openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/v1/health",
  tags: ["system"],
  summary: "Health check",
  responses: {
    200: { description: "Service is up", content: { "application/json": { schema: HealthSchema } } },
  },
});

export { taipeiIso };

export function createApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = { ...defaultDeps, ...overrides };
  const app = new OpenAPIHono<AppBindings>({
    // Request validation failures use the shared error format.
    defaultHook: (result, c) => {
      if (result.success) return;
      const issue = result.error.issues[0];
      const field = issue?.path.join(".") || "body";
      return c.json(errorBody("invalid_field", "Invalid request", c.get("requestId"), { field_key: field, reason: issue?.code ?? "invalid" }), 422);
    },
  });

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", requestId);
    await next();
    c.header("x-request-id", requestId);
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (!c.res.headers.has("content-security-policy")) c.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  });

  app.openapi(healthRoute, (c) =>
    c.json(
      {
        status: "ok" as const,
        service: "hglobal-id" as const,
        environment: c.env?.ENVIRONMENT ?? "unknown",
        time: taipeiIso(deps.now()),
      },
      200,
    ),
  );

  registerAuthRoutes(app, deps);
  registerOidcRoutes(app, deps);
  registerOidcDocs(app);
  registerProfileRoutes(app, deps);
  registerSpouseRoutes(app, deps);
  registerAmwayRoutes(app, deps);
  registerEligibilityRoutes(app, deps);

  app.get("/", (c) => html(c, messagePage("會員中心", "H-Global1985 會員登入服務。", { href: "/login", label: "登入" })));

  app.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "H-Global1985 Central Member System API",
      version: "1.0.0",
      description: "Central member API for id.hglobal1985.com.",
    },
  });

  app.notFound((c) => c.json(errorBody("not_found", "Not found", c.get("requestId")), 404));

  app.onError((err, c) => {
    // Never echo internal details to clients; log only the request id and error name.
    console.error(JSON.stringify({ request_id: c.get("requestId"), error: err.name }));
    if (err instanceof HTTPException && err.status < 500) {
      return c.json(errorBody("invalid_request", "Malformed request", c.get("requestId")), err.status);
    }
    if (err instanceof ConfigError) return c.json(errorBody("server_error", "Service is not configured", c.get("requestId")), 503);
    return c.json(errorBody("server_error", "Internal error", c.get("requestId")), 500);
  });

  return app;
}

export { ErrorBodySchema };
