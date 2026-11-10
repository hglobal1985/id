# 部署步驟（業主操作）

金鑰、Token、Client Secret 都只放在 GitHub 或 Cloudflare 的「機密設定」裡，不要貼進對話、Issue、PR。

## 一次性設定

### 1. Cloudflare API Token（給 GitHub 自動部署用）
1. 用 hglobal1985@gmail.com 登入 Cloudflare → 右上角頭像 → **My Profile** → **API Tokens** → **Create Token**。
2. 選範本 **Edit Cloudflare Workers** → 在權限再加一列 **Account / D1 / Edit**。
3. **Account Resources** 只選 H-Global1985 的帳號；**Zone Resources** 選 hglobal1985.com。
4. 建立後畫面只會顯示一次 Token，直接複製到下一步，不要存到其他地方。

### 2. GitHub Secrets
到 github.com/hglobal1985/id → **Settings → Secrets and variables → Actions → New repository secret**：
- `CLOUDFLARE_API_TOKEN`：上一步的 Token。
- `CLOUDFLARE_ACCOUNT_ID`：H-Global1985 帳戶的 Account ID。

不需要另外建立 Environments（部署時 GitHub 會自動建立），也不需要設定審核人。

### 3. Google 登入用戶端（H-Global1985 專用的 Google Cloud 專案）
1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials → OAuth client ID** → 類型 **Web application**。
2. **Authorized redirect URIs**：
   - 測試：`https://hglobal-id-staging.<你的 workers 子網域>.workers.dev/login/google/callback`（第一次部署後才知道網址）
   - 正式：`https://id.hglobal1985.com/login/google/callback`
   - App 登入中繼（ADR 0011）共用上面這個網址，**不需要再加任何網址**；日後新增 App 也不必到 Google 後台做任何設定。
3. 測試與正式共用同一個用戶端（兩個 redirect URI 都加在同一個用戶端）。到 GitHub → **Settings → Secrets and variables → Actions**：
   - `GOOGLE_CLIENT_ID`（不是機密）：放在 **Variables** 或 **Secrets** 分頁都可以。
   - **Secrets** 分頁新增 `GOOGLE_CLIENT_SECRET`。

### 4. 把機密放進 Worker（不用在自己電腦輸入）
由 Claude 執行 GitHub 的 **Worker secrets** 流程：在 GitHub 的機器裡產生簽章金鑰並直接存進 Cloudflare，沒有人看得到；Google Client Secret 也一併轉存。業主不用操作。

## 之後的部署
- **測試環境**：每次合併到 main、CI 成功後自動部署。
- **正式環境**：業主在對話中同意後，由 Claude 啟動 Deploy 流程（選 `production`）。不需要在 GitHub 按核准。

## 正式環境上線前（需業主核准）
1. 建立正式資料庫 `hglobal-id`，把 ID 填進 `wrangler.jsonc`。正式環境是全新系統，不匯入任何舊會員（ADR 0009 已廢止）。
2. 網域 `id.hglobal1985.com` 指到 Worker。
3. 業主用指定的超級管理員 Google 帳號第一次登入，再用 `scripts/grant-role.mjs` 設定為超級管理員。
4. App 在後台登記（後台 → App → 新增 App），不用腳本；寰宇行動大學（`learn`）已由 migration 0011 登記。
