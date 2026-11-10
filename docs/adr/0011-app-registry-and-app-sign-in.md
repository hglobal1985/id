# ADR 0011：App 登記在資料庫、App 登入中繼與 App Token

狀態：已採用（2026-11-10）。業主決定：App 的登記與串接方式與 starry.phd 中央會員相同。

## 決定
- **所有 App 登記在資料庫** `registered_apps`（`definition` 是一筆 JSON，寫入與讀取都用同一個 `parseApp` 驗證）。超級管理員在後台新增與編輯，不必改程式碼或部署。App 不能刪除；不再使用時把狀態設為 `killed`。
- **三個平台共用一個 app_id**：iOS、Android、網頁版。新增時空白欄位依 app_id 自動產生：`com.hglobal1985.<app_id>`（Bundle ID 與套件名稱）、`https://<app_id>.hglobal1985.com`（網頁版來源）、`<app_id>://auth/google`（App 回傳網址）。
- **狀態開關** `app_status_overrides`：active／paused／killed，後台一鍵切換。登記與狀態在每個 isolate 的記憶體快取 30 秒（不寫入資料表），所以 30 秒內全球生效。
- `GET /v1/apps/{app_id}/config`：公開，回傳狀態、最低版本與公開設定。
- **App 登入**（App 不持有任何密碼或 client secret）：
  1. `POST /v1/auth/nonce`：單次有效、10 分鐘、綁定 App；資料庫只存雜湊。
  2. 登入中繼 `GET /auth/google/start` → Google（中央會員自己的 Google 用戶端，授權碼流程）→ `GET /login/google/callback` → 中央會員以 client secret 換得 Google ID Token → 回到登記過的回傳網址（深層連結用 query，網頁用 `#` fragment）。瀏覽器中只出現 nonce 的 SHA-256；中繼的 state 用簽章金鑰簽署（10 分鐘），不需要新的機密。
     - 中繼**共用會員網站既有的重新導向 URI**（`/login/google/callback`，以 state 的型別區分），所以啟用中繼、以及日後新增任何 App，都不必到 Google 後台做任何設定（業主 2026-11-10 要求）。
  3. `POST /v1/auth/google`：驗證 Google ID Token（簽章、iss、aud、exp、nonce），以 Google `sub` 找到或建立會員，發出 Token。
- **App Token**：Access Token 15 分鐘（RS256、`typ: at+jwt`，與 OIDC 相同的金鑰與 JWKS，多一個 `app_id` claim）；Refresh Token 30 天，格式 `<session_id>.<secret>`，每次使用即輪替，保留上一個雜湊，被重用時整個 session 撤銷並寫入稽核。每個請求都檢查 App session、會員狀態與 App 狀態（fail closed）。權限範圍（scope）來自 App 登記，換發時重新讀取。
- `POST /v1/auth/logout`（這次登入）、`POST /v1/auth/logout-all`（該會員所有 App、所有裝置與會員網站）。
- **CORS**：只對已登記的網頁版來源開放 `/v1`（不含 `/v1/admin`），只接受 Bearer Token，不允許 Cookie。
- **給開發 AI 的串接指令**：由 `src/apps/handoff.ts` 產生，有版本號與更新時間（文字改了但沒改版本，測試會失敗）；只含公開資料。App 自己的管理頁可用 `GET /v1/apps/{app_id}/handoff?integrated=<版本>` 取得最新指令並回報採用版本（只有超級管理員、只有該 App 自己的登入）。後台 App 清單顯示各 App 回報的版本是否最新。規則：每次更新只補差異。
- **後台權限**：`apps.manage`（新增、編輯；超級管理員；編輯需 10 分鐘內登入過，因為會改變誰能登入）、`apps.operate`（清單、統計、串接指令、狀態開關；超級管理員與秘書）。
- 寰宇行動大學（app_id `learn`）由 migration 0011 以 `INSERT OR IGNORE` 登記。

## 與 starry.phd 中央會員的差異
- 登入方式目前只有 Google（Apple 登入與通行密鑰待業主決定）；共用登入（SSO）在後續 PR。
- 沒有電池、商品目錄、邀請碼、內購；R2 不啟用。
- 損壞的登記列一律不使用（fail closed），並在後台警示。

## 既有 OIDC
`/oauth/*` 保留、不變。寰宇行動大學改用 App 登入後，舊的 `oauth_clients` 登記與 Worker `learn` 的機密經業主核准再移除。

## 業主需要做的事
沒有。新增 App 只要在後台登記。
