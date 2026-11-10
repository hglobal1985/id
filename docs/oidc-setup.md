# OIDC 與 Google 登入：部署前設定（業主操作）

> **2026-11-10 更新**：新的 App 一律在後台登記並使用登入中繼（見 `docs/integration-guide.md` 與 ADR 0011），不需要 client secret，也不需要本頁第 3 節。第 3 節只保留給仍在使用 `/oauth/*` 的既有用戶端；範例中的 `elearning` 是舊名稱（現為寰宇行動大學，app_id `learn`）。實際部署步驟以 `docs/deploy.md` 為準。

以下都由業主在自己的終端機或主控台操作。**金鑰、Client Secret 不要貼進對話、Issue、PR 或日誌。**

## 1. Google OAuth 用戶端（H-Global1985 專用 Google Cloud 專案）
- 類型：網頁應用程式。
- 已授權的重新導向 URI：
  - 正式：`https://id.hglobal1985.com/login/google/callback`
  - 測試：`https://<staging 網址>/login/google/callback`（staging 網址於部署 PR 決定）
- 取得的 Client ID 寫進 `wrangler.jsonc` 的 `GOOGLE_CLIENT_ID`（不是機密）；Client Secret 用 Secret 設定：

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
```

## 2. 簽章金鑰
直接用管線把產生的金鑰送進 Secret，不落地、不顯示：

```bash
node scripts/generate-signing-key.mjs | npx wrangler secret put OIDC_SIGNING_JWK --env staging
```

輪替：把目前的值設到 `OIDC_SIGNING_JWK_PREVIOUS`，再產生新的 `OIDC_SIGNING_JWK`；30 天後刪除 `OIDC_SIGNING_JWK_PREVIOUS`。

## 3. 登記 OIDC 用戶端（舊方式，新的 App 請改用後台登記）

```bash
node scripts/register-client.mjs --id elearning --name elearning \
  --redirect https://elearning.hglobal1985.com/auth/callback \
  --post-logout https://elearning.hglobal1985.com/ \
  --auth client_secret_basic > client.sql
```

畫面上會顯示一次 client secret：直接存進該 app 的機密設定。然後執行並刪除 SQL 檔：

```bash
npx wrangler d1 execute hglobal-id-staging --env staging --remote --file client.sql && rm client.sql
```
