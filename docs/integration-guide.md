# H-Global1985 App 串接說明

給每款 H-Global1985 App 的開發者。中央會員網址：`https://id.hglobal1985.com`（測試環境：`https://hglobal-id-staging.hglobal1985-static.workers.dev`，兩個環境的資料庫與簽章金鑰各自獨立，帳號不互通）。

- 每款 App 的「串接指令」由後台產生（後台 → App → 給開發 AI 的串接指令），有版本號。**每次更新只補差異，不要整份重做。**
- API 契約：[`openapi/hglobal-id.v1.json`](../openapi/hglobal-id.v1.json)。破壞性變更走 `/v2`。請容忍回應中多出的欄位。
- 錯誤格式：`{"error":{"code","message","request_id","details"}}`，`code` 為小寫 snake_case。時間為 ISO 8601（+08:00）。

## 1. 啟動
`GET /v1/apps/{app_id}/config` → `{app_id, status, min_version, config}`。
- `status`：`active` 正常；`paused` 顯示維護中；`killed` 停止使用。後台切換後 30 秒內生效。
- App 版本低於 `min_version`：要求更新。
- 中央會員連不上：不需登入的畫面照常使用；需要登入或資格的功能一律拒絕。

## 2. 登入（登入中繼）
App 不持有任何密碼或 client secret。iOS、Android、網頁版共用同一個 `app_id`，一律走登入中繼，不必到 Google 後台為 App 做任何設定。目前登入方式只有 Google。

1. `POST /v1/auth/nonce` `{"app_id"}` → `{"nonce","expires_in"}`（單次有效、10 分鐘、綁定 App）。
2. 開啟 `/auth/google/start?app_id=<app_id>&nonce=<SHA-256(nonce) 十六進位小寫>&return=<回傳網址>&state=<隨機字串>`。
   - 手機：用系統登入瀏覽器視窗（Expo：`openAuthSessionAsync`），回傳網址是登記的深層連結；結果在 query：`?id_token=…&state=…` 或 `?error=…&state=…`。
   - 網頁：整頁導向，回傳網址在登記的網頁版來源底下、不帶 `#`；結果在 fragment：`#id_token=…&state=…`。讀取後立刻 `history.replaceState` 清掉。
3. 核對 `state`，`POST /v1/auth/google` `{"app_id","id_token","nonce":<原值>,"device_label"?}` → `access_token`（15 分鐘）、`refresh_token`（30 天）、`scope`、`user.member_id`、`user.is_new`。

錯誤：`app_not_found`（404）、`app_unavailable`（403，App 被暫停或停用）、`invalid_token`／`invalid_nonce`（401）、`account_disabled`（403）、`rate_limited`（429）。

## 3. 呼叫 API 與換發
- 每個請求帶 `Authorization: Bearer <access_token>`。
- 401 `unauthenticated`：`POST /v1/auth/refresh` `{"refresh_token"}`，**新的 refresh_token 立刻覆蓋舊的**。舊的再用一次會撤銷整個登入（`refresh_reused`）。同一時間只執行一個換發（加鎖）。
- 登出：`POST /v1/auth/logout`；登出所有裝置與所有 App：`POST /v1/auth/logout-all`。
- 儲存：手機用系統安全儲存；網頁 Access Token 只放記憶體、Refresh Token 放 `sessionStorage`。
- 網頁版 CORS 只對登記的網頁版來源開放，不使用 Cookie（不要設 `credentials: 'include'`）。

## 3.5 共用登入（單一登入）
任一款 App 登入，同一支手機上的其他 H-Global1985 App 自動登入；登出或換會員，所有 App 跟著變。登出按鈕寫「登出所有 App」。

**手機**
- 登入後 `POST /v1/auth/sso/start`（Bearer；可帶 `previous_sso_token`）→ `{sso_token}`，存進共用儲存。iPhone：Keychain 群組 `$(AppIdentifierPrefix)com.hglobal1985.shared`，鍵名 `hglobal.sso`。Android 為選做。
- 其他 App：`POST /v1/auth/sso/exchange` `{app_id, sso_token, device_label?}` → 與一般登入相同的回應。
- 啟動與回到前景：`POST /v1/auth/sso/status` `{sso_token}` → `{active, member_id}`。
- 登出：`POST /v1/auth/sso/logout` `{sso_token}` → 204。
- 錯誤 `invalid_sso`（401）：共用登入已失效，清掉共用儲存並回到登入畫面。

**網頁版（同一個瀏覽器）**
- 登入後：`sso/start` → `POST /v1/auth/sso/web-code` `{sso_token}` → 導向 `/auth/sso/adopt?c=<code>&app_id=&return=` → 回到 `#sso_adopted=1`。
- 載入頁面（5 分鐘節流）：取 nonce → 導向 `/auth/sso/check?app_id=&nonce=<SHA-256 hex>&return=&state=` → `#sso_code=&sso_member=&state=` 或 `#sso_none=1&state=` → `POST /v1/auth/sso/web-exchange` `{app_id, code, nonce}`（單次、2 分鐘、綁定 App 與 nonce）。
- 登出：導向 `/auth/sso/logout?app_id=&return=`。
- 回傳頁必須在登記的網頁版來源底下、不帶 `#`。手機 App 與網頁版之間不連動。

## 4. App 後端驗證會員
用 `GET /oauth/jwks` 的公鑰驗證 Access Token（RS256，`typ` 為 `at+jwt`）：`iss` 與 `aud` 都是中央會員網址、`app_id` 等於自己的 app_id、檢查 `exp`。快取 JWKS，遇到不認得的 `kid` 重新抓取。會員主鍵只用 `sub`（即 `member_id`）；不可用信箱、姓名或會員編號辨識會員（會員編號可能重複或被修改）。

## 5. 資格查詢
- `POST /v1/eligibility/check` `{"rule":{"audience":"hglobal_verified"|"everyone","min_rank"?}}` → `{"allowed","reason"}`；`POST /v1/eligibility/check-batch` `{"rules":[…≤50]}`。需要 `amway.read`。
- 獎銜代碼由 `GET /v1/amway/field-definitions` 提供，不要寫死。
- **Fail closed**：查不到、逾時、非 200 一律視為不符合。
- 快取最長 1 日，只能放記憶體或短時效快取服務，不寫入資料庫。
- `reason` 只供內部記錄，不可顯示給會員。

## 6. 資料與文字規則
- Amway 相關資料（會員編號、獎銜、上手、資格結果）不得被 App 或 App 後端保存，也不得寫入日誌或分析工具。
- 日誌不得有 Token、信箱、姓名。
- 對會員顯示的品牌只用 starry.phd、Amway；畫面上不要出現「寰宇」「H-Global1985」「hglobal」字樣（App 選單裡的選項與隱私權文件除外），網頁標題統一「會員中心」。畫面上不提其他系統名稱，一律用「合作營運單位」。
- 隱私權政策（含完整隱私說明，同一份文件）`/privacy`；修改基本資料與刪除帳號在 `/my/edit`。

## 6.5 視覺規範
顏色、字體、圓角、方框、按鈕、名字旁的系統／中心／獎銜方框、生命靈數九宮格的標準見 [`docs/design-standard.md`](design-standard.md)（含 React Native 的 theme 範本）。畫面一律照它做，不要自己加顏色。

## 6.6 網址
- 公開頁（純淨，給別人看）：`/<國碼二碼緊接編號>`，例如 `TW9475831`；沒有選單、頁尾、分享與編輯按鈕。
- 自己的頁面 `/my/<代碼>`、編輯頁 `/my/edit`；`/me` 已不存在。

## 7. 串接指令版本回報
App 自己的管理頁（只給超級管理員）呼叫 `GET /v1/apps/{app_id}/handoff?integrated=<採用的版本>`：回傳最新版本、`up_to_date` 與最新指令文字，並記錄 App 採用的版本。後台 App 清單會顯示是否最新。

## 8. 新 App 登記（業主）
後台 → App → 新增 App：填 `app_id` 與名稱即可，其餘欄位留空會自動產生。30 秒內生效，可用 `GET /v1/apps/<app_id>/config` 確認。App 不能刪除，不再使用時按「停用」。
