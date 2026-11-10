# 部署步驟（業主操作）

金鑰、Token、Client Secret 都只放在 GitHub 或 Cloudflare 的「機密設定」裡，不要貼進對話、Issue、PR。

## 一次性設定

### 1. Cloudflare API Token（給 GitHub 自動部署用）
1. 用 hglobal1985@gmail.com 登入 Cloudflare → 右上角頭像 → **My Profile** → **API Tokens** → **Create Token**。
2. 選範本 **Edit Cloudflare Workers** → 在權限再加一列 **Account / D1 / Edit**。
3. **Account Resources** 只選 H-Global1985 的帳號；**Zone Resources** 選 hglobal1985.com。
4. 建立後畫面只會顯示一次 Token，直接複製到下一步，不要存到其他地方。

### 2. GitHub Secrets 與 Environments
到 github.com/hglobal1985/id → **Settings**：
1. **Secrets and variables → Actions → New repository secret**：
   - `CLOUDFLARE_API_TOKEN`：上一步的 Token。
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 首頁右側「Account ID」。
2. **Environments → New environment** 建立 `staging` 與 `production`；`production` 勾選 **Required reviewers** 並加入自己（正式部署前要你按核准）。

### 3. Google 登入用戶端（H-Global1985 專用的 Google Cloud 專案）
1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth client ID** → 類型 **Web application**。
2. **Authorized redirect URIs**：
   - 測試：`https://hglobal-id-staging.<你的 workers 子網域>.workers.dev/login/google/callback`（第一次部署後才知道網址）
   - 正式：`https://id.hglobal1985.com/login/google/callback`
3. 到 GitHub → Settings → **Environments → staging**：
   - **Environment variables** 新增 `GOOGLE_CLIENT_ID`（不是機密）。
   - **Environment secrets** 新增 `GOOGLE_CLIENT_SECRET`。
   正式環境在 `production` 做同樣設定。

### 4. 把機密放進 Worker（不用在自己電腦輸入）
GitHub → **Actions → Worker secrets → Run workflow**：選 `staging`，第一次要勾 **rotate_signing_key**（產生簽章金鑰）。它會在 GitHub 的機器裡產生金鑰並直接存進 Cloudflare，沒有人看得到。

## 之後的部署
- **測試環境**：每次合併到 main、CI 成功後自動部署。
- **正式環境**：Actions → **Deploy → Run workflow** → 選 `production`，再到通知裡按核准。

## 正式環境上線前（需業主核准）
1. 建立正式資料庫 `hglobal-id`，把 ID 填進 `wrangler.jsonc`。
2. 在會員開始登入前，匯入 77 位舊會員（`scripts/import-legacy.mjs`，見 ADR 0009）。
3. 網域 `id.hglobal1985.com` 指到 Worker。
4. 用 `scripts/grant-role.mjs` 設定第一位超級管理員（若舊管理員未匯入）。
5. 用 `scripts/register-client.mjs` 登記寰宇學習網等 app。
