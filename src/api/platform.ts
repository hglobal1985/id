// Platform standards for every App (ADR 0021): webhook endpoint management and delivery log, the App service
// credential, and the restricted contact lookup an App calls with that credential.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { APP_SCOPES, CONTACT_PURPOSES, PURPOSE_LABELS, SCOPE_LABELS } from "../apps/registry";
import { REAUTH_MAX_AGE, can, type Permission } from "../admin/roles";
import { epochSeconds } from "../lib/time";
import { resolveIssuer } from "../oidc/config";
import { getApp } from "../db/apps";
import { LOOKUP_MAX, checkServiceToken, hasServiceCredential, issueServiceToken, lookupContacts, revokeServiceSecret, rotateServiceSecret } from "../db/service";
import { currentWebhookSecret, deliverDue, getWebhook, isWebhookUrl, recentEvents, rotateWebhookSecret, setWebhook } from "../db/webhooks";
import { uuidv7 } from "../lib/crypto";
import { EVENT_RETENTION_SECONDS } from "../webhooks/events";
import { taipeiIso } from "../lib/time";

type C = Context<AppBindings>;
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const Any = z.record(z.unknown());
const AppIdParam = z.object({ app_id: z.string().max(32).openapi({ example: "learn" }) });

const tokenRoute = createRoute({
  method: "post",
  path: "/v1/service/token",
  tags: ["platform"],
  summary: "App service credential → short service token (client credentials, 10 minutes)",
  description: "Server-to-server only. The client secret is created by the owner in the back office (shown once) and lives only in the App's server environment; never in a mobile or web client. The token works only for the endpoints this credential is allowed to call.",
  request: { body: { required: true, content: json(z.object({ app_id: z.string().max(32), client_secret: z.string().max(200) })) } },
  responses: {
    200: { description: "Token", content: json(z.object({ access_token: z.string(), token_type: z.literal("Bearer"), expires_in: z.number().int(), scope: z.string() }).openapi("ServiceToken")) },
    401: err("invalid_client"),
  },
});

const lookupRoute = createRoute({
  method: "post",
  path: "/v1/apps/{app_id}/contacts/lookup",
  tags: ["platform"],
  summary: "Contact e-mail of up to 50 members who signed in to this App (service token; only for a purpose registered for the App)",
  description:
    "Replaces keeping a copy of members' e-mail in the App: call it when you need to send a notice, use the address, and do not store it. `email` is the contact e-mail the member set (email_verified false), otherwise their verified Google e-mail. Members that are unknown, deleted, never signed in to this App or without an address come back in `not_found`. Each call is audited (App, count, purpose; never addresses).",
  security: [{ bearer: [] }],
  request: { params: AppIdParam, body: { required: true, content: json(z.object({ member_ids: z.array(z.string().uuid()).min(1).max(LOOKUP_MAX), purpose: z.enum(["payment_notice", "course_notice", "account_security"]) })) } },
  responses: {
    200: { description: "Contacts", content: json(z.object({ contacts: z.array(z.object({ member_id: z.string(), email: z.string(), email_verified: z.boolean() })), not_found: z.array(z.string()) }).openapi("ContactLookup")) },
    401: err("unauthenticated"),
    403: err("forbidden or purpose_not_allowed"),
    422: err("invalid_field"),
  },
});

// ---------- back office ----------
const security = [{ session: [] }];
const common = { 401: err("unauthenticated or reauth_required"), 403: err("forbidden") };
const platformRoute = createRoute({ method: "get", path: "/v1/admin/apps/{app_id}/platform", tags: ["admin"], summary: "One App's platform settings: webhook, delivery log, service credential, scopes, contact purposes, standards", security, request: { params: AppIdParam }, responses: { 200: { description: "Settings", content: json(Any) }, ...common, 404: err("app_not_found") } });
const webhookPutRoute = createRoute({ method: "put", path: "/v1/admin/apps/{app_id}/webhook", tags: ["admin"], summary: "Set (or remove with url null) the App's webhook endpoint (https only; needs a sign-in within 10 minutes)", security, request: { params: AppIdParam, body: { required: true, content: json(z.object({ url: z.string().max(300).nullable(), enabled: z.boolean().optional() })) } }, responses: { 200: { description: "Saved", content: json(Any) }, ...common, 404: err("app_not_found"), 422: err("invalid_field") } });
const webhookSecretRoute = createRoute({ method: "post", path: "/v1/admin/apps/{app_id}/webhook/secret", tags: ["admin"], summary: "Show the webhook signing secret once (rotate true = new secret; the old one stops working). Needs a sign-in within 10 minutes and WEBHOOK_SIGNING_KEY.", security, request: { params: AppIdParam, body: { required: true, content: json(z.object({ rotate: z.boolean() })) } }, responses: { 200: { description: "Secret", content: json(Any) }, ...common, 404: err("app_not_found"), 503: err("not_configured") } });
const webhookTestRoute = createRoute({ method: "post", path: "/v1/admin/apps/{app_id}/webhook/test", tags: ["admin"], summary: "Send a webhook.test event to the App now and report the result", security, request: { params: AppIdParam }, responses: { 200: { description: "Result", content: json(Any) }, ...common, 404: err("app_not_found"), 409: err("no_webhook"), 503: err("not_configured") } });
const serviceSecretRoute = createRoute({ method: "post", path: "/v1/admin/apps/{app_id}/service-secret", tags: ["admin"], summary: "Create or replace the App's service secret (shown once; needs a sign-in within 10 minutes)", security, request: { params: AppIdParam }, responses: { 200: { description: "Secret", content: json(Any) }, ...common, 404: err("app_not_found") } });
const serviceRevokeRoute = createRoute({ method: "delete", path: "/v1/admin/apps/{app_id}/service-secret", tags: ["admin"], summary: "Revoke the App's service secret", security, request: { params: AppIdParam }, responses: { 200: { description: "Revoked", content: json(Any) }, ...common, 404: err("app_not_found") } });

function deny(c: C, p: Permission): Response | null {
  const st = c.get("staff");
  if (can(st.roles, p, st.grants)) return null;
  return c.json(errorBody("forbidden", "Not permitted for your role", c.get("requestId"), { required_permission: p }), 403);
}
function reauth(c: C, deps: Deps): Response | null {
  if (epochSeconds(deps.now()) - c.get("staff").authTime <= REAUTH_MAX_AGE) return null;
  return c.json(errorBody("reauth_required", "請重新登入後再試", c.get("requestId"), { login_url: "/login?return_to=%2Fadmin" }), 401);
}
const notFound = (c: C) => c.json(errorBody("app_not_found", "Unknown app", c.get("requestId")), 404);

export function registerPlatformRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.openapi(tokenRoute, async (c) => {
    const { app_id, client_secret } = c.req.valid("json");
    const t = await issueServiceToken(c.env, deps, resolveIssuer(c.env, c.req.url), app_id, client_secret, c.get("requestId"));
    c.header("cache-control", "no-store");
    if (!t) return c.json(errorBody("invalid_client", "App 或金鑰不正確", c.get("requestId")), 401) as never;
    return c.json({ access_token: t.token, token_type: "Bearer" as const, expires_in: t.expires_in, scope: "contacts.lookup" }, 200);
  });

  app.openapi(lookupRoute, async (c) => {
    const appId = await checkServiceToken(c.env, deps, resolveIssuer(c.env, c.req.url), c.req.header("authorization"));
    if (!appId) return c.json(errorBody("unauthenticated", "Invalid or expired service token", c.get("requestId")), 401) as never;
    if (appId !== c.req.valid("param").app_id) return c.json(errorBody("forbidden", "This credential belongs to another App", c.get("requestId")), 403) as never;
    const a = await getApp(c.env.DB, appId, deps.now());
    const { member_ids, purpose } = c.req.valid("json");
    if (!a || !a.contact_purposes.includes(purpose)) return c.json(errorBody("purpose_not_allowed", "這個用途沒有獲得業主授權", c.get("requestId"), { purpose }), 403) as never;
    c.header("cache-control", "no-store");
    return c.json(await lookupContacts(c.env.DB, appId, purpose, member_ids, c.get("requestId"), deps.now()), 200);
  });

  app.openapi(platformRoute, async (c) => {
    const d = deny(c, "apps.operate");
    if (d) return d as never;
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    const [w, log, service] = await Promise.all([getWebhook(c.env.DB, a.app_id), recentEvents(c.env.DB, a.app_id), hasServiceCredential(c.env.DB, a.app_id)]);
    return c.json(
      {
        app_id: a.app_id,
        scopes: a.scopes,
        scopes_restricted: a.scopes_restricted,
        contact_purposes: a.contact_purposes,
        scope_options: APP_SCOPES.map((key) => ({ key, label: SCOPE_LABELS[key] ?? key })),
        contact_purpose_options: CONTACT_PURPOSES.map((key) => ({ key, label: PURPOSE_LABELS[key] ?? key })),
        webhook: w ? { url: w.url, enabled: w.enabled === 1, secret_version: w.secret_version } : null,
        signing_configured: !!c.env.WEBHOOK_SIGNING_KEY,
        webhook_log: log,
        service_credential: service,
      },
      200,
    );
  });

  app.openapi(webhookPutRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const r = reauth(c, deps);
    if (r) return r as never;
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    const { url, enabled } = c.req.valid("json");
    if (url !== null && !isWebhookUrl(url)) return c.json(errorBody("invalid_field", "網址必須是 https 的網域（不能是 IP 位址或 localhost）", c.get("requestId")), 422) as never;
    await setWebhook(c.env.DB, a.app_id, url, enabled ?? true, c.get("staff").memberId, c.get("requestId"), deps.now());
    return c.json({ webhook: url === null ? null : { url, enabled: enabled ?? true } }, 200);
  });

  app.openapi(webhookSecretRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const r = reauth(c, deps);
    if (r) return r as never;
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    if (!c.env.WEBHOOK_SIGNING_KEY) return c.json(errorBody("not_configured", "尚未設定 WEBHOOK_SIGNING_KEY（Workers Secret），不會送出任何事件", c.get("requestId")), 503) as never;
    if (!(await getWebhook(c.env.DB, a.app_id))) return c.json(errorBody("invalid_field", "請先設定這款 App 的 webhook 網址", c.get("requestId")), 422) as never;
    const secret = c.req.valid("json").rotate
      ? await rotateWebhookSecret(c.env.DB, c.env, a.app_id, c.get("staff").memberId, c.get("requestId"), deps.now())
      : await currentWebhookSecret(c.env.DB, c.env, a.app_id);
    c.header("cache-control", "no-store");
    return c.json({ secret, note: "只顯示這一次，請由業主放進這款 App 的伺服器環境變數；不要貼到對話、Issue 或 PR。" }, 200);
  });

  app.openapi(webhookTestRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    if (!c.env.WEBHOOK_SIGNING_KEY) return c.json(errorBody("not_configured", "尚未設定 WEBHOOK_SIGNING_KEY", c.get("requestId")), 503) as never;
    if (!(await getWebhook(c.env.DB, a.app_id))) return c.json(errorBody("no_webhook", "這款 App 沒有 webhook 網址", c.get("requestId")), 409) as never;
    const now = deps.now();
    const id = `evt_${uuidv7(now.getTime())}`;
    const t = epochSeconds(now);
    await c.env.DB.prepare("INSERT INTO webhook_events (id, app_id, member_id, type, fields, created_at, status, attempts, next_attempt_epoch, purge_epoch) VALUES (?, ?, ?, 'webhook.test', NULL, ?, 'pending', 0, ?, ?)")
      .bind(id, a.app_id, c.get("staff").memberId, taipeiIso(now), t, t + EVENT_RETENTION_SECONDS)
      .run();
    await deliverDue(c.env.DB, c.env, now, undefined, 5);
    const row = await c.env.DB.prepare("SELECT status, attempts, last_http_status, last_error FROM webhook_events WHERE id = ?").bind(id).first<Record<string, unknown>>();
    return c.json({ event_id: id, ...row }, 200);
  });

  app.openapi(serviceSecretRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const r = reauth(c, deps);
    if (r) return r as never;
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    const secret = await rotateServiceSecret(c.env.DB, a.app_id, c.get("staff").memberId, c.get("requestId"), deps.now());
    c.header("cache-control", "no-store");
    return c.json({ client_secret: secret, note: "只顯示這一次，請由業主放進這款 App 的伺服器環境變數；不要貼到對話、Issue 或 PR。舊的金鑰已失效。" }, 200);
  });

  app.openapi(serviceRevokeRoute, async (c) => {
    const d = deny(c, "apps.manage");
    if (d) return d as never;
    const r = reauth(c, deps);
    if (r) return r as never;
    const a = await getApp(c.env.DB, c.req.valid("param").app_id, deps.now());
    if (!a) return notFound(c);
    return c.json({ revoked: await revokeServiceSecret(c.env.DB, a.app_id, c.get("staff").memberId, c.get("requestId"), deps.now()) }, 200);
  });
}
