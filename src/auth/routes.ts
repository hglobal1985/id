// Sign-in pages at id.hglobal1985.com: /login, /login/google, /login/google/callback.
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import {
  LIFETIME,
  consumeLoginFlowByState,
  createLoginFlow,
  createSession,
  getOpenLoginFlow,
  startLoginFlow,
  upsertMemberByGoogle,
} from "../db/identity";
import { writeAudit } from "../db/audit";
import { hashSecret, randomToken, s256Challenge, timingSafeEqual } from "../lib/crypto";
import { isSafeReturnPath } from "../oidc/uris";
import { resolveIssuer, requireGoogleConfig } from "../oidc/config";
import { completeGoogleSignIn, googleAuthorizeUrl, GoogleSignInError } from "./google";
import { FLOW_COOKIE, SESSION_COOKIE, clearCookie, readCookie, writeCookie } from "./cookies";
import { PAGE_CSP, loginPage, messagePage } from "../web/pages";
import { isRelayState, relayCallback } from "../api/app-auth";

type C = Context<AppBindings>;

export function html(c: C, body: string, status: 200 | 400 | 403 | 500 | 503 = 200) {
  c.header("content-security-policy", PAGE_CSP);
  c.header("cache-control", "no-store");
  return c.html(body, status);
}

export function failurePage(c: C, status: 400 | 403 | 500 | 503 = 400) {
  return html(c, messagePage("登入失敗", "登入沒有完成，請重新再試一次。", { href: "/login", label: "重新登入" }), status);
}

/** Starts a sign-in that resumes at `returnTo` (a same-origin path) and redirects to the login page. */
export async function redirectToLogin(c: C, deps: Deps, returnTo: string) {
  const { flowId, browserToken } = await createLoginFlow(c.env.DB, returnTo, deps.now());
  writeCookie(c, FLOW_COOKIE, browserToken, LIFETIME.loginFlow);
  c.header("cache-control", "no-store");
  return c.redirect(`/login?flow=${encodeURIComponent(flowId)}`, 302);
}

async function flowBelongsToBrowser(c: C, browserHash: string): Promise<boolean> {
  const token = readCookie(c, FLOW_COOKIE);
  return !!token && timingSafeEqual(await hashSecret(token), browserHash);
}

export function registerAuthRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  app.get("/login", async (c) => {
    const flowId = c.req.query("flow");
    if (flowId) {
      const flow = await getOpenLoginFlow(c.env.DB, flowId, deps.now());
      if (flow && (await flowBelongsToBrowser(c, flow.browser_hash))) {
        return html(c, loginPage(`/login/google?flow=${encodeURIComponent(flowId)}`));
      }
    }
    const rt = c.req.query("return_to");
    return redirectToLogin(c, deps, rt && isSafeReturnPath(rt) ? rt : "/");
  });

  app.get("/login/google", async (c) => {
    const google = requireGoogleConfig(c.env);
    const flowId = c.req.query("flow") ?? "";
    const flow = await getOpenLoginFlow(c.env.DB, flowId, deps.now());
    if (!flow || !(await flowBelongsToBrowser(c, flow.browser_hash))) return redirectToLogin(c, deps, "/");
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);
    await startLoginFlow(c.env.DB, flow.id, state, nonce, verifier);
    c.header("cache-control", "no-store");
    return c.redirect(
      googleAuthorizeUrl({
        clientId: google.clientId,
        redirectUri: `${resolveIssuer(c.env, c.req.url)}/login/google/callback`,
        state,
        nonce,
        codeChallenge: await s256Challenge(verifier),
      }),
      302,
    );
  });

  app.get("/login/google/callback", async (c) => {
    const now = deps.now();
    const google = requireGoogleConfig(c.env);
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!state) return failurePage(c);
    // App sign-in relay (ADR 0011) shares this redirect URI; its state is a signed token, not a browser-bound flow.
    if (isRelayState(state)) return relayCallback(c, deps, { state, code, error: c.req.query("error") });
    const flow = await consumeLoginFlowByState(c.env.DB, state, now);
    // Login CSRF protection: the flow must have been started in this same browser.
    if (!flow || !flow.nonce || !flow.code_verifier || !(await flowBelongsToBrowser(c, flow.browser_hash))) return failurePage(c);
    clearCookie(c, FLOW_COOKIE);
    if (!code || c.req.query("error")) return failurePage(c);

    let identity;
    try {
      identity = await completeGoogleSignIn(deps, {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        redirectUri: `${resolveIssuer(c.env, c.req.url)}/login/google/callback`,
        code,
        codeVerifier: flow.code_verifier,
        nonce: flow.nonce,
      });
    } catch (e) {
      if (e instanceof GoogleSignInError) return failurePage(c);
      throw e;
    }

    const cf = (c.req.raw as Request & { cf?: { country?: string } }).cf;
    const { member } = await upsertMemberByGoogle(c.env.DB, identity, cf?.country ?? "TW", now, c.get("requestId"));
    if (member.status !== "active") {
      await writeAudit(c.env.DB, { actorType: "member", actorId: member.id, action: "member.login", result: "denied", requestId: c.get("requestId"), detail: { reason: member.status } }, now);
      return html(c, messagePage("無法登入", "此帳號目前無法使用，如有疑問請聯絡客服。"), 403);
    }
    const { token } = await createSession(c.env.DB, member.id, now);
    writeCookie(c, SESSION_COOKIE, token, LIFETIME.session);
    await writeAudit(c.env.DB, { actorType: "member", actorId: member.id, action: "member.login", result: "success", requestId: c.get("requestId"), detail: { method: "google" } }, now);
    c.header("cache-control", "no-store");
    return c.redirect(isSafeReturnPath(flow.return_to) ? flow.return_to : "/", 302);
  });
}
