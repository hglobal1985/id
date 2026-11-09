// Documents the /oauth/* and discovery endpoints in the generated OpenAPI file.
// They are plain Hono handlers (form-encoded bodies and RFC 6749 errors), so they are registered here.
import { z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import { SUPPORTED_SCOPES } from "./scopes";

const OAuthError = z
  .object({ error: z.string().openapi({ example: "invalid_grant" }), error_description: z.string().optional() })
  .openapi("OAuthError");

const TokenResponse = z
  .object({
    access_token: z.string(),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().openapi({ example: 900 }),
    refresh_token: z.string(),
    id_token: z.string(),
    scope: z.string(),
  })
  .openapi("TokenResponse");

const UserInfo = z
  .object({
    sub: z.string().openapi({ description: "Member id (UUID). The only identifier apps may use to match members." }),
    name: z.string().optional(),
    picture: z.string().url().optional(),
    updated_at: z.number().int().optional(),
  })
  .openapi("UserInfo");

const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const redirect = { description: "Redirect (302)" };

export function registerOidcDocs(app: OpenAPIHono<AppBindings>) {
  const r = app.openAPIRegistry;
  r.registerPath({
    method: "get",
    path: "/.well-known/openid-configuration",
    tags: ["oidc"],
    summary: "OpenID Provider discovery document",
    responses: { 200: { description: "Discovery document", content: json(z.record(z.unknown())) } },
  });
  r.registerPath({
    method: "get",
    path: "/oauth/jwks",
    tags: ["oidc"],
    summary: "Public signing keys (JWKS)",
    responses: { 200: { description: "JWK Set", content: json(z.object({ keys: z.array(z.record(z.unknown())) })) } },
  });
  r.registerPath({
    method: "get",
    path: "/oauth/authorize",
    tags: ["oidc"],
    summary: "Authorization endpoint (authorization code + PKCE S256)",
    request: {
      query: z.object({
        client_id: z.string(),
        redirect_uri: z.string().url(),
        response_type: z.literal("code"),
        scope: z.string().openapi({ description: `Space-separated; must include openid. Supported: ${SUPPORTED_SCOPES.join(" ")}` }),
        state: z.string(),
        code_challenge: z.string(),
        code_challenge_method: z.literal("S256"),
        nonce: z.string().optional(),
        prompt: z.string().optional().openapi({ description: "none | login | consent | select_account" }),
        max_age: z.string().optional(),
      }),
    },
    responses: { 302: redirect, 400: { description: "Unknown client or redirect_uri (HTML page, no redirect)" } },
  });
  r.registerPath({
    method: "post",
    path: "/oauth/token",
    tags: ["oidc"],
    summary: "Token endpoint (authorization_code, refresh_token with rotation)",
    request: {
      body: {
        content: {
          "application/x-www-form-urlencoded": {
            schema: z.object({
              grant_type: z.enum(["authorization_code", "refresh_token"]),
              code: z.string().optional(),
              redirect_uri: z.string().optional(),
              code_verifier: z.string().optional(),
              refresh_token: z.string().optional(),
              scope: z.string().optional(),
              client_id: z.string().optional(),
              client_secret: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Tokens", content: json(TokenResponse) },
      400: { description: "OAuth error", content: json(OAuthError) },
      401: { description: "Client authentication failed", content: json(OAuthError) },
    },
  });
  r.registerPath({
    method: "get",
    path: "/oauth/userinfo",
    tags: ["oidc"],
    summary: "UserInfo endpoint",
    security: [{ bearer: [] }],
    responses: {
      200: { description: "Claims", content: json(UserInfo) },
      401: { description: "Missing or invalid access token", content: json(OAuthError) },
      403: { description: "Insufficient scope", content: json(OAuthError) },
    },
  });
  r.registerPath({
    method: "get",
    path: "/oauth/logout",
    tags: ["oidc"],
    summary: "RP-initiated logout (ends the central sign-in session for every app)",
    request: {
      query: z.object({
        id_token_hint: z.string().optional(),
        client_id: z.string().optional(),
        post_logout_redirect_uri: z.string().url().optional(),
        state: z.string().optional(),
      }),
    },
    responses: { 200: { description: "Signed-out page (HTML)" }, 302: redirect, 400: { description: "Invalid request (HTML)" } },
  });
  r.registerComponent("securitySchemes", "bearer", { type: "http", scheme: "bearer", bearerFormat: "JWT" });
}
