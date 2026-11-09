import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppBindings } from "./env";
import { ErrorBodySchema, errorBody } from "./errors";

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

/** ISO 8601 string in Asia/Taipei (+08:00). All API timestamps use this form. */
export function taipeiIso(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+08:00");
}

export function createApp() {
  const app = new OpenAPIHono<AppBindings>();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    await next();
    c.header("x-request-id", requestId);
  });

  app.openapi(healthRoute, (c) =>
    c.json(
      {
        status: "ok" as const,
        service: "hglobal-id" as const,
        environment: c.env?.ENVIRONMENT ?? "unknown",
        time: taipeiIso(new Date()),
      },
      200,
    ),
  );

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
    return c.json(errorBody("server_error", "Internal error", c.get("requestId")), 500);
  });

  return app;
}

export { ErrorBodySchema };
