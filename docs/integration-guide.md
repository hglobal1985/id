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
- `GET /v1/eligibility/context`（需要 `amway.read`）→ `{member_id, roles:[{role,label}], hglobal_verified, center:{key,label}|null}`：登入者**自己**的職務、是否為已驗證的寰宇、已核准的中心。給需要「依中心／職務分派工作」的 App 使用（例如課程報名由同中心窗口審核）；比較中心一律用 `center.key`。非 200 一律視為沒有職務、未驗證。**例外（業主 2026-11-12）**：App 可以把 `center.label` 保存在它為該會員建立的紀錄上（例如報名紀錄），只用於分派審核與對帳；其餘 Amway 資料仍不得保存。

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

## 6.7 平台規範補充（2026-11-12.9）
- **本名**：欄位 `legal_name`（畫面標籤 2026-11-14 起為「本名」，原稱「本姓」「真實姓名」；預設不公開）。只在報名付費課程與對帳當下用會員本人的 token 讀 `GET /v1/me/profile` 的 `fields.legal_name`；不保存、不寫日誌、不另建欄位。
- **獎銜「無」**：選項（含「無」）來自 `GET /v1/amway/field-definitions` 的 `rank.options`；會員值 `fields.rank.value` 為 `null` 或 `"none"` 都代表「無」。對「無」顯示什麼文字由各 App 決定。
- **會員資料的使用範圍**：會員的「公開／隱藏」只管對外公開頁，不限制寰宇生態系內的 App；業主在後台替每款 App 勾選可用欄位（含隱藏的），App 用 `POST /v1/apps/{app_id}/members/lookup` 讀取（見 6.8、ADR 0022）。
- **深色模式**：跟隨系統，配色依視覺規範 1.5；業主核准的例外才可保留自己的配色。
- **測試環境**：正式前用 staging（`https://hglobal-id-staging.hglobal1985-static.workers.dev`，會員、金鑰、App 登記獨立）。`http://localhost` 不能登記；手機用已登記的深層連結，網頁用 https 預覽網址。測試版共用登入鍵名建議 `hglobal.sso.staging`。
- **新規範流程**：任何新規範先寫進串接指令與更新檢查清單並升版，各 App 只補差異（見 `AGENTS.md`「平台規範」）。

## 6.8 平台資料標準（2026-11-12.10，所有 App 一體適用）
完整設計與規格見 [ADR 0021](adr/0021-platform-standards.md)。
- **原則**：①個人資料正本只在中央，App 只存 `member_id`，複製要有同步與刪除機制；②交易紀錄存「當時快照」，對帳靠付款代碼或金流交易編號，不靠姓名；③需要聯絡方式走中央的聯絡查詢，不長期保存副本；④變動與刪除由中央 webhook 通知，App 照辦；⑤只拿到最小權限，中央留稽核。
- **webhook**：事件 `member.profile_changed`（`fields` 只有欄位名稱）、`member.deleted`、`webhook.test`；POST JSON，標頭 `X-HG-Event-Id`／`X-HG-Timestamp`／`X-HG-Attempt`／`X-HG-Signature: v1=HMAC-SHA256(金鑰, 時間戳.原始內容)`；驗簽用原始內容、常數時間、時間窗 5 分鐘、依 `id` 去重、5 秒內回 2xx。至少一次投遞，失敗在 1 分、5 分、30 分、2 小時、6 小時、24 小時重試（共 7 次），紀錄保存 30 天。金鑰由業主在後台取得，只放伺服器環境變數。
- **聯絡查詢**：服務金鑰（後台建立，只放伺服器）→ `POST /v1/service/token` → `POST /v1/apps/{app_id}/contacts/lookup`（≤ 50 個 `member_id`、`purpose` 須經業主核准）。信箱用完即丟；中央每次稽核（不記信箱）。
- **最小權限**：新 App 預設只有 `amway.read`；多的權限由業主在後台勾選；收到 403 不自行繞過。
- **符合度回報**：`GET /v1/apps/{app_id}/handoff?integrated=<版本>&standards=webhook,delete_copy,no_email_copy,snapshot_reconcile,least_scope`（只列已做到的），後台 App 清單顯示結果。

## 6.9 會員資料查詢（2026-11-13.1，ADR 0022）
- `POST /v1/apps/{app_id}/members/lookup`，服務 Token；`{"member_ids":[≤50],"fields":["legal_name","rank",…],"use":"process"|"display"}` → `{"members":[{"member_id","fields":{…}}],"not_found":[…]}`。
- 只能讀在該 App 登入過的會員、只能讀業主在後台勾選的欄位（含會員設為隱藏的）；沒勾回 `403 field_not_allowed`。需要審核的 Amway 欄位只回已審核的；非 Amway 會員的 Amway 欄位為 `null`。
- 只取需要的欄位；不長期保存、不寫日誌與分析工具、不轉給寰宇生態系以外；中央每次稽核（App、筆數、欄位名稱、用途，不含內容）。對外公開頁仍然只顯示會員設為公開的欄位。

## 6.10 頭銜與行業類別欄位（2026-11-15.1）
- **頭銜**（`job_title`，2026-11-15 起標籤由「職稱」改稱「頭銜」，代碼不變）：`tags`（多項，最多 10 項、每項 ≤ 50 字）、預設公開、`profile.basic.write`；順序在「行業類別」之後、「公司／單位」之前。定義的 `suggest` 為 `job_title`，輸入時呼叫 `GET /v1/vocab/suggestions?pool=job_title&q=…` 顯示關聯詞。值是文字陣列：`PUT /v1/me/profile/fields/job_title`（`{"value":["經理"]}`）。輸入過的頭銜自動進詞庫，業主在後台「關聯詞」編輯、合併、刪除。
- **行業類別**（`occupation`，原稱「職業」「行業與工作」，代碼不變）：改為**單選下拉選單**（`type: "select"`），沒有關聯詞輸入。選項在欄位定義的 `options`（`value` 與 `label` 相同，順序即顯示順序），內建台灣常見行業別，業主在後台「關聯詞」頁維護（新增、改名、合併、刪除，App 不用改）。選項多，下拉要可搜尋。值是單一文字：`PUT /v1/me/profile/fields/occupation`（`{"value":"製造業"}`、`null` 清除），必須在目前清單內，否則 `422 not_an_option`；已存的值就算之後從清單刪除，仍會顯示、可原樣保存。舊版的標籤陣列請改成單選並容忍舊陣列值。
- 其他會員的這兩個欄位走 `POST /v1/apps/{app_id}/members/lookup`（業主在後台勾選 `job_title`、`occupation`）。欄位定義版本 `2026-11-15.1`。

## 6.10.1 欄位異動（2026-11-14.6）
- 刪除「使用語言」（`languages`）；中央已刪除會員存的舊值。畫面照欄位定義產生，自然消失。
- 「介面語言」（`locale`）預設繁體中文：沒選過時 `GET /v1/me/profile` 的 `fields.locale.value` 為 `"zh-TW"`，欄位定義多一個 `default_value`；預設值只用來顯示，不寫回中央。欄位定義版本 `2026-11-14.4`。

## 6.11 下拉重新整理（2026-11-14.3，所有 App、所有頁面一體適用）
業主 2026-11-14 決定：每個畫面都要支援「在頁面最上方往下拉 = 重新整理」，取代網頁版沒有重新整理按鈕的缺陷。
- **手勢**：捲到最頂端時往下拖超過約 70 px 放開才觸發；拖動時有指示（下拉重新整理 → 放開重新整理 → 載入中），用主色；沒過門檻就彈回。
- **觸發後**：重新讀取該頁資料與 config；不重載整個 App、不登出、不動共用登入；失敗用 toast；有未儲存修改先確認。
- **不誤觸**：不在最頂端、在輸入框／下拉／彈出視窗／可橫向捲動區域內、載入中、距上次不到 2 秒，都不觸發。
- **做法**：網頁版自己用 touch 事件實作＋CSS `overscroll-behavior-y: contain`；原生用 `RefreshControl`。
- 檢查清單第 23 項。

## 6.12 獎銜徽章（2026-11-15.2，所有 App 一體適用）
圖庫放在中央，所有 App 讀同一套（ADR 0027）。
- **資料**：`GET /v1/amway/field-definitions` 的 `rank` 選項每個都有 `badge_url`（公開絕對網址，沒有徽章是 `null`）與 `badge`（`{width, height, art_top, art_bottom}`，畫布 380×720 與圖案上下緣，沒有徽章是 `null`）。33 個獎銜中 24 個有徽章，`none`、`r03`、`r06`、`r09`、`r12`、`r12a`、`r15`、`r18`、`r21` 是 `null`。
- **圖片網址**：`https://id.hglobal1985.com/badges/<獎銜代碼>.png?v=<版本>`（例如 `/badges/f_double_diamond.png?v=1`）；公開、`image/png`、一年 immutable 快取、`access-control-allow-origin: *`。更新時版本號變、網址變：**一律用 API 給的完整網址**，不要自己拼、不要寫死、不要存副本。
- **顯示標準**（完整內容在串接指令三、13，檢查清單 25）：會員抬頭裡緊貼獎銜標籤右邊；顯示高度 92、版面只佔頭像高度 48（上下各溢出約 22）；呼吸 1.1 倍／2.6 秒（只改大小）；4 顆星形閃光球（位置依圖案範圍比例，高度 72 為基準等比縮放）；「減少動態效果」時只顯示靜態徽章；無徽章或載入失敗整塊不顯示。
- App 不自己存圖庫、不自己新增徽章；新增獎銜時由業主在中央後台「獎銜徽章」上傳。

## 6.13 同中心會員名單（2026-11-15.4，ADR 0028）
給需要讓教育中心的音控或會長「從名單點選同中心會員」的 App（例如指派小編；不可用手動貼會員 ID）。
- `GET /v1/eligibility/center-members?q=&limit=&cursor=&center=`：呼叫者本人的 App 會員 Token（`amway.read`）。
- **誰可查**：`sound`（音控）、`president`（會長）且有已審核教育中心 → 只回自己的中心（指定別的中心回 403）；`super_admin`、`secretary` 可帶 `center=<詞庫中的中心名稱>`（不存在 404；沒帶且沒有自己的中心 422）；其他人 403；非 App 內登入的 Token 403。
- **名單**：教育中心已審核且相同（`center.key`）、帳號啟用、Amway 開啟，不含自己；沒登入過這款 App 的也列出（`signed_in_app`）。`q` 只比對顯示名稱。`limit` 預設 20、上限 50，`cursor` 翻頁。
- **回傳**：`{center:{key,label}, members:[{member_id, display_name, avatar_url|null, signed_in_app}], next_cursor|null}`；沒有信箱、電話、獎銜或其他 Amway 欄位。
- **授權**：業主要在後台「平台設定」替 App 勾 `display_name`（頭像再勾 `avatar`，沒勾時 `avatar_url` 為 null），否則 `403 field_not_allowed`。每次查詢都有稽核（不記搜尋字與姓名）。
- App 只存被指派者的 `member_id` 與當下顯示名稱；確認對方仍在同中心用對方本人的 `GET /v1/eligibility/context`。

## 7. 串接指令版本回報
App 自己的管理頁（只給超級管理員）呼叫 `GET /v1/apps/{app_id}/handoff?integrated=<採用的版本>`：回傳最新版本、`up_to_date` 與最新指令文字，並記錄 App 採用的版本。後台 App 清單會顯示是否最新。

## 8. 新 App 登記（業主）
後台 → App → 新增 App：填 `app_id` 與名稱即可，其餘欄位留空會自動產生。30 秒內生效，可用 `GET /v1/apps/<app_id>/config` 確認。App 不能刪除，不再使用時按「停用」。
