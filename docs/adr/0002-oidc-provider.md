# ADR 0002：OIDC 提供者與 Google 登入

狀態：已採用（2026-11-10，PR 2）

## 決定
- 自寫 OpenID Connect 提供者（不用外部身分服務）：探索設定 `/.well-known/openid-configuration`、`/oauth/authorize`、`/oauth/token`、`/oauth/userinfo`、`/oauth/logout`、`/oauth/jwks`。
- 只支援授權碼流程，**一律要求 PKCE S256**；不支援 implicit、hybrid、password、request object。回導帶 `iss`（RFC 9207）。
- `redirect_uri` 與 `post_logout_redirect_uri` 只做完整字串比對，只接受 https，不支援萬用字元；未登記的 client 或 redirect_uri 一律顯示錯誤頁，不轉址。
- 簽章：RS256；私鑰（JWK）放 Worker Secret `OIDC_SIGNING_JWK`，輪替時舊鑰放 `OIDC_SIGNING_JWK_PREVIOUS` 並繼續公開於 JWKS。
- 權杖效期：access token 15 分鐘（JWT，`typ: at+jwt`）、ID token 15 分鐘、refresh token 30 天（每次使用即輪替；舊 token 被重用時整個家族作廢）、授權碼 60 秒且只能用一次（重放時撤銷其發出的 refresh token）。
- 中央登入 session 30 天，cookie `__Host-hgid_session`（HttpOnly、Secure、SameSite=Lax）。access token 每次使用都檢查 session 仍有效、會員為 active、client 未停用（fail closed）。
- 登出（RP-initiated）會結束中央 session，並撤銷該 session 下**所有 app** 的 refresh token（連動登出）。
- Google 登入：授權碼 + PKCE + nonce，驗證 Google id_token 的簽章、iss、aud、exp、nonce；登入流程以 `__Host-hgid_flow` cookie 綁定同一瀏覽器（防登入 CSRF）。會員只以 Google `sub` 綁定。
- client 由管理員登記（`scripts/register-client.mjs` 產生 SQL），不開放動態註冊；app 皆為第一方，第一版不顯示額外同意畫面。
- 資料庫只存 session token、授權碼、refresh token、client secret 的 SHA-256 雜湊。

## 例外：/oauth/* 的錯誤格式
`/oauth/token`、`/oauth/userinfo` 依 RFC 6749／6750 回 `{ "error": "...", "error_description": "..." }`，讓標準 OIDC 函式庫可直接使用。`/v1` 的 API 仍使用共用格式 `{ error: { code, message, request_id, details } }`。

## 後續
- `client_id`／`redirect_uri` 的實際登記、Google OAuth 用戶端、Secrets 由業主在部署前設定（見 `docs/oidc-setup.md`）。
- 限流、通行密鑰、跨系統共用登入（一次性簽章通行證）在後續 PR。
