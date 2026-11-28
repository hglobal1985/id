// 後台 Passkey（杜杜龍 2026-11-28）：管理員的危險操作（金鑰、App 登記、權限）不再要求「重新登入 Google」，
// 改用 passkey（指紋／臉部／手機解鎖）確認，10 分鐘內有效。第一次先建立 passkey（建立時要 任何有效的登入階段就能建立第一把）。
// 沒有 passkey 的管理員做危險操作 → 401 passkey_setup_required；有 passkey 但太久沒確認 → 401 passkey_required。
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { REAUTH_MAX_AGE } from "../admin/roles";
import { epochSeconds } from "../lib/time";
import { resolveIssuer } from "../oidc/config";
import { base64url } from "../lib/crypto";
import { ALG_ES256, ALG_RS256, SUPPORTED_ALGS, checkCeremony, decode, importPublicKey, parseClientData, randomChallenge, verifySignature } from "../auth/webauthn";
import { MAX_PASSKEYS, addPasskey, consumeChallenge, deletePasskey, findPasskey, listPasskeys, markStepUp, newChallenge } from "../db/passkeys";
import { auditStatement } from "../db/audit";

type C = Context<AppBindings>;
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const err = (d: string) => ({ description: d, content: json(ErrorBodySchema) });
const Any = z.record(z.string(), z.unknown());
const security = [{ session: [] }];
const common = { 401: err("unauthenticated or reauth_required"), 403: err("forbidden") };
const B64 = z.string().min(1).max(4096);

const listRoute = createRoute({ method: "get", path: "/v1/admin/passkeys", tags: ["admin"], summary: "The signed-in staff member's passkeys, and whether a recent confirmation is still valid", security, responses: { 200: { description: "Passkeys", content: json(Any) }, ...common } });
const regOptionsRoute = createRoute({ method: "post", path: "/v1/admin/passkeys/register/options", tags: ["admin"], summary: "Start adding a passkey (the first one needs only a valid session; further ones need a passkey confirmation within the last 10 minutes)", security, responses: { 200: { description: "WebAuthn creation options", content: json(Any) }, ...common } });
const regVerifyRoute = createRoute({ method: "post", path: "/v1/admin/passkeys/register/verify", tags: ["admin"], summary: "Finish adding a passkey", security, request: { body: { required: true, content: json(z.object({ credential_id: B64, client_data_json: B64, authenticator_data: B64, public_key: B64, alg: z.number().int(), name: z.string().max(40).optional() })) } }, responses: { 200: { description: "Added", content: json(Any) }, ...common, 400: err("invalid_passkey"), 409: err("passkey_exists") } });
const authOptionsRoute = createRoute({ method: "post", path: "/v1/admin/passkeys/auth/options", tags: ["admin"], summary: "Start a passkey confirmation (for dangerous operations)", security, responses: { 200: { description: "WebAuthn request options", content: json(Any) }, ...common, 409: err("no_passkey") } });
const authVerifyRoute = createRoute({ method: "post", path: "/v1/admin/passkeys/auth/verify", tags: ["admin"], summary: "Finish a passkey confirmation: the session counts as freshly confirmed for 10 minutes", security, request: { body: { required: true, content: json(z.object({ credential_id: B64, client_data_json: B64, authenticator_data: B64, signature: B64 })) } }, responses: { 200: { description: "Confirmed", content: json(Any) }, ...common, 400: err("invalid_passkey") } });
const deleteRoute = createRoute({ method: "delete", path: "/v1/admin/passkeys/{id}", tags: ["admin"], summary: "Remove one of the signed-in staff member's passkeys (needs a recent confirmation)", security, request: { params: z.object({ id: z.string().max(64) }) }, responses: { 200: { description: "Removed", content: json(Any) }, ...common, 404: err("not_found") } });

const bad = (c: C, msg: string) => c.json(errorBody("invalid_passkey", msg, c.get("requestId")), 400);
const fresh = (c: C, deps: Deps) => {
  const st = c.get("staff");
  return epochSeconds(deps.now()) - Math.max(st.authTime, st.stepupEpoch) <= REAUTH_MAX_AGE;
};

export function registerPasskeyRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  const rp = (c: C) => { const origin = resolveIssuer(c.env, c.req.url); return { origin, id: new URL(origin).hostname }; };

  app.openapi(listRoute, async (c) => {
    const rows = await listPasskeys(c.env.DB, c.get("staff").memberId);
    c.header("cache-control", "no-store");
    return c.json({ passkeys: rows.map((p) => ({ id: p.id, name: p.name, created_at: p.created_at, last_used_at: p.last_used_at })), confirmed: fresh(c, deps), max: MAX_PASSKEYS }, 200);
  });

  /** 第一把 passkey 任何有效的登入階段都能建立（不再要求重新登入 Google，杜杜龍 2026-11-28）；已經有 passkey 時，再加新的要先用 passkey 確認過（10 分鐘內）。 */
  const mayRegister = async (c: C, existingCount: number) => existingCount === 0 || fresh(c, deps);

  app.openapi(regOptionsRoute, async (c) => {
    const st = c.get("staff");
    const existing = await listPasskeys(c.env.DB, st.memberId);
    if (!(await mayRegister(c, existing.length))) return c.json(errorBody("passkey_required", "請先用現有的 passkey 確認，才能再加新的", c.get("requestId")), 401) as never;
    if (existing.length >= MAX_PASSKEYS) return c.json(errorBody("invalid_passkey", `最多只能建立 ${MAX_PASSKEYS} 個 passkey`, c.get("requestId")), 400) as never;
    const challenge = randomChallenge();
    await newChallenge(c.env.DB, st.memberId, "register", challenge, deps.now());
    return c.json({ challenge, rp: { id: rp(c).id, name: "會員中心" }, user: { id: base64url(new TextEncoder().encode(st.memberId)), name: st.memberId.slice(0, 8), displayName: "管理員" }, pubKeyCredParams: SUPPORTED_ALGS.map((alg) => ({ type: "public-key", alg })), excludeCredentials: existing.map((p) => ({ type: "public-key", id: p.credential_id })), authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, attestation: "none", timeout: 120000 }, 200);
  });

  app.openapi(regVerifyRoute, async (c) => {
    const st = c.get("staff");
    if (!(await mayRegister(c, (await listPasskeys(c.env.DB, st.memberId)).length))) return c.json(errorBody("passkey_required", "請先用現有的 passkey 確認，才能再加新的", c.get("requestId")), 401) as never;
    const b = c.req.valid("json");
    const cdj = decode(b.client_data_json), ad = decode(b.authenticator_data), spki = decode(b.public_key), credId = decode(b.credential_id);
    if (!cdj || !ad || !spki || !credId || !(SUPPORTED_ALGS as readonly number[]).includes(b.alg)) return bad(c, "資料格式不正確") as never;
    const cd = parseClientData(cdj);
    if (!cd || !(await consumeChallenge(c.env.DB, st.memberId, "register", cd.challenge, deps.now()))) return bad(c, "驗證碼已過期，請重新操作") as never;
    const parsed = await checkCeremony({ type: "webauthn.create", clientDataJSON: cdj, authenticatorData: ad, challenge: cd.challenge, origin: rp(c).origin, rpId: rp(c).id });
    if (!parsed?.credentialId || base64url(parsed.credentialId) !== b.credential_id) return bad(c, "passkey 驗證失敗") as never;
    if (!(await importPublicKey(spki, b.alg))) return bad(c, "公鑰格式不正確") as never;
    if (await findPasskey(c.env.DB, st.memberId, b.credential_id)) return c.json(errorBody("passkey_exists", "這個 passkey 已經建立過了", c.get("requestId")), 409) as never;
    try {
      const id = await addPasskey(c.env.DB, st.memberId, b.credential_id, b.public_key, b.alg, parsed.signCount, b.name?.trim() || "我的裝置", deps.now());
      await auditStatement(c.env.DB, { actorType: "staff", actorId: st.memberId, action: "passkey.add", targetType: "passkey", targetId: id, result: "success", requestId: c.get("requestId") }, deps.now()).run();
      return c.json({ id, ok: true }, 200);
    } catch {
      return c.json(errorBody("passkey_exists", "這個 passkey 已經建立過了", c.get("requestId")), 409) as never;
    }
  });

  app.openapi(authOptionsRoute, async (c) => {
    const st = c.get("staff");
    const rows = await listPasskeys(c.env.DB, st.memberId);
    if (!rows.length) return c.json(errorBody("no_passkey", "還沒有建立 passkey", c.get("requestId")), 409) as never;
    const challenge = randomChallenge();
    await newChallenge(c.env.DB, st.memberId, "authenticate", challenge, deps.now());
    return c.json({ challenge, rpId: rp(c).id, allowCredentials: rows.map((p) => ({ type: "public-key", id: p.credential_id })), userVerification: "required", timeout: 120000 }, 200);
  });

  app.openapi(authVerifyRoute, async (c) => {
    const st = c.get("staff");
    const b = c.req.valid("json");
    const cdj = decode(b.client_data_json), ad = decode(b.authenticator_data), sig = decode(b.signature);
    if (!cdj || !ad || !sig) return bad(c, "資料格式不正確") as never;
    const cd = parseClientData(cdj);
    if (!cd || !(await consumeChallenge(c.env.DB, st.memberId, "authenticate", cd.challenge, deps.now()))) return bad(c, "驗證碼已過期，請重新操作") as never;
    const pk = await findPasskey(c.env.DB, st.memberId, b.credential_id);
    if (!pk) return bad(c, "找不到這個 passkey") as never;
    const parsed = await checkCeremony({ type: "webauthn.get", clientDataJSON: cdj, authenticatorData: ad, challenge: cd.challenge, origin: rp(c).origin, rpId: rp(c).id });
    const key = parsed ? await importPublicKey(decode(pk.public_key) ?? new Uint8Array(), pk.alg) : null;
    if (!parsed || !key || !(await verifySignature({ publicKey: key, alg: pk.alg === ALG_RS256 ? ALG_RS256 : ALG_ES256, authenticatorData: ad, clientDataJSON: cdj, signature: sig }))) return bad(c, "passkey 驗證失敗") as never;
    // 計數器只增不減（兩邊都是 0 的裝置，例如部分手機，不檢查）；倒退代表這把 passkey 可能被複製。
    if ((pk.sign_count > 0 || parsed.signCount > 0) && parsed.signCount <= pk.sign_count) return bad(c, "passkey 驗證失敗") as never;
    await markStepUp(c.env.DB, pk.id, parsed.signCount, st.sessionId, deps.now());
    await auditStatement(c.env.DB, { actorType: "staff", actorId: st.memberId, action: "passkey.confirm", targetType: "passkey", targetId: pk.id, result: "success", requestId: c.get("requestId") }, deps.now()).run();
    return c.json({ ok: true, valid_for_seconds: REAUTH_MAX_AGE }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    if (!fresh(c, deps)) return c.json(errorBody("passkey_required", "請先用 passkey 確認", c.get("requestId")), 401) as never;
    const st = c.get("staff");
    const id = c.req.valid("param").id;
    if (!(await deletePasskey(c.env.DB, st.memberId, id))) return c.json(errorBody("not_found", "找不到這個 passkey", c.get("requestId")), 404) as never;
    await auditStatement(c.env.DB, { actorType: "staff", actorId: st.memberId, action: "passkey.remove", targetType: "passkey", targetId: id, result: "success", requestId: c.get("requestId") }, deps.now()).run();
    return c.json({ ok: true }, 200);
  });
}
