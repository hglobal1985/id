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
3. 核對 `state`，`POST /v1/auth/google` `{"app_id","id_token","nonce":<原值>,"device_label"?}` → `access_token`（15 分鐘）、`refresh_token`（**永不過期**，2026-11-27.1：只有登出、登出所有裝置、停權、刪除帳號才失效）、`scope`、`user.member_id`、`user.is_new`。

錯誤：`app_not_found`（404）、`app_unavailable`（403，App 被暫停或停用）、`invalid_token`／`invalid_nonce`（401）、`account_disabled`（403）、`rate_limited`（429）。

## 3. 呼叫 API 與換發
- 每個請求帶 `Authorization: Bearer <access_token>`。
- 401 `unauthenticated`：`POST /v1/auth/refresh` `{"refresh_token"}`，**新的 refresh_token 立刻覆蓋舊的**。舊的再用一次會撤銷整個登入（`refresh_reused`）。同一時間只執行一個換發（加鎖）。
- 登出：`POST /v1/auth/logout`；登出所有裝置與所有 App：`POST /v1/auth/logout-all`。
- 儲存：手機用系統安全儲存；網頁 Access Token 放記憶體、Refresh Token 放 `localStorage`（登入永不過期：關分頁、關瀏覽器都還是登入），多分頁換發要加鎖（例如 `navigator.locks`）。App 不可自設登入期限。
- 稽核：中央的「查審核清單」「查職務清單」同一人同一款 App 一小時只記一次；稽核紀錄保存 3 個月（Amway 區塊開關紀錄除外，隱私規則要用）。
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
- **開啟完整版會員中心不再選 Google 帳號（2026-11-24.1，ADR 0038）**：已有 `sso_token` 時，每次都先 `POST /v1/auth/sso/web-code` 取新 code，再用系統瀏覽器（手機 App）或整頁導向（網頁版）開 `/auth/sso/adopt?c=<code>&app_id=&return=<中央>/my/edit`。中央會替這個瀏覽器建立會員中心的登入並直接進入頁面。`return` 只接受中央自己的 `/my/edit` 與 `/my/<會員編號>`（其他路徑 400，不需登記）；code 單次、2 分鐘，失效時退回一般登入頁。

## 4. App 後端驗證會員
用 `GET /oauth/jwks` 的公鑰驗證 Access Token（RS256，`typ` 為 `at+jwt`）：`iss` 與 `aud` 都是中央會員網址、`app_id` 等於自己的 app_id、檢查 `exp`。快取 JWKS，遇到不認得的 `kid` 重新抓取。會員主鍵只用 `sub`（即 `member_id`）；不可用信箱、姓名或會員編號辨識會員（會員編號可能重複或被修改）。

## 5. 資格查詢
- `POST /v1/eligibility/check` `{"rule":{"audience":"hglobal_verified"|"everyone","min_rank"?}}` → `{"allowed","reason"}`；`POST /v1/eligibility/check-batch` `{"rules":[…≤50]}`。需要 `amway.read`。
- 獎銜代碼由 `GET /v1/amway/field-definitions` 提供，不要寫死。
- **Fail closed**：查不到、逾時、非 200 一律視為不符合。
- 快取最長 1 日，只能放記憶體或短時效快取服務，不寫入資料庫。
- `reason` 只供內部記錄，不可顯示給會員。
- `GET /v1/eligibility/context`（需要 `amway.read`）→ `{member_id, roles:[{role,label}], hglobal_verified, center:{key,label}|null}`：登入者**自己**的職務、是否為已驗證的寰宇、已核准的中心。給需要「依中心／職務分派工作」的 App 使用（例如課程報名由同中心窗口審核）；比較中心一律用 `center.key`。非 200 一律視為沒有職務、未驗證。**例外（杜杜龍 2026-11-12）**：App 可以把 `center.label` 保存在它為該會員建立的紀錄上（例如報名紀錄），只用於分派審核與對帳；其餘 Amway 資料仍不得保存。

## 6. 資料與文字規則
- Amway 相關資料（會員編號、獎銜、上手、資格結果）不得被 App 或 App 後端保存，也不得寫入日誌或分析工具。
- 日誌不得有 Token、信箱、姓名。
- 對會員顯示的品牌只用 starry.phd、Amway；畫面上不要出現「寰宇」「H-Global1985」「hglobal」字樣（App 選單裡的選項與隱私權文件除外），網頁標題統一「會員中心」。畫面上不提其他系統名稱，一律用「合作營運單位」。
- 隱私權政策（含完整隱私說明，同一份文件）`/privacy`；修改基本資料在 `/my/edit`；網頁版會員也可在那裡刪除帳號。App 內直接刪除帳號見 §6.15。

## 6.5 視覺規範
顏色、字體、圓角、方框、按鈕、名字旁的系統／中心／獎銜方框、生命靈數九宮格的標準見 [`docs/design-standard.md`](design-standard.md)（含 React Native 的 theme 範本）。畫面一律照它做，不要自己加顏色。

## 6.6 網址
- 公開頁（純淨，給別人看）：`/<國碼二碼緊接編號>`，例如 `TW9475831`；沒有選單、頁尾、分享與編輯按鈕。
- 自己的頁面 `/my/<代碼>`、編輯頁 `/my/edit`；`/me` 已不存在。

## 6.7 平台規範補充（2026-11-12.9）
- **本名**：欄位 `legal_name`（畫面標籤 2026-11-14 起為「本名」，原稱「本姓」「真實姓名」；預設不公開）。只在報名付費課程與對帳當下用會員本人的 token 讀 `GET /v1/me/profile` 的 `fields.legal_name`；不保存、不寫日誌、不另建欄位。
- **Amway 三欄順序與中心規則（2026-11-23.1，杜杜龍 2026-11-23）**：資料頁與 `GET /v1/amway/field-definitions` 的欄位順序是獎銜 → 直銷商培訓系統 → 地區教育中心（名字旁方框順序不變：系統、中心、獎銜）。獎銜永遠可選、可送出，與系統、中心無關（`system_center_required` 已取消）。地區教育中心只有在系統屬於 `hglobal_systems`（寰宇）時才能選；系統不是寰宇（其他、「無」、沒填）時 App 自動送 `"無"` 並停用該欄（視為已填、不審核），後端對非寰宇卻送非「無」的中心回 `422 invalid_field`（`details.reason = center_requires_hglobal`）。必填與審核規則不變。
- **寰宇中心名稱提醒（2026-11-24.3，杜杜龍 2026-11-24）**：飛登、蓁分享、有賢社、聚冠是寰宇旗下的中心，不是獨立的系統。自訂系統的文字包含其中任一詞時：畫面在輸入框下方即時顯示提醒（不阻擋輸入）；中央 `PUT /v1/me/amway/fields/education_system` 回 `422`、`details.reason` 為 `use_hglobal_center`，`message` 為「「{詞}」屬於寰宇系統：請把「系統」改選「寰宇」，再從「中心」切換選擇。」。詞清單與提醒範本由 `GET /v1/amway/field-definitions` 的 `education_system.hglobal_center_words`／`hglobal_center_message` 提供，App 不寫死；杜杜龍增減詞時 App 不用改程式。既有會員資料不由 App 改，由中央／後台處理。
- **自訂系統、勾選列與必填標籤（2026-11-23.2，杜杜龍 2026-11-23）**：系統選「其他」時隱藏「地區教育中心」欄，同一位置顯示「自訂系統」輸入框，文字直接存進 `education_system`，中心視為 `"無"`（仍送出）；改選別的系統時輸入框消失。勾選「我是 Amway 會員」後該勾選列隱藏（取消入口各 App 自行安排）；勾「無」時下拉欄位寬度維持勾選前的寬度。「必填」標籤動態顯示：獎銜、系統（含自訂系統）未填才顯示；中心只在系統是寰宇且未選時顯示；`GET /v1/me/amway` 的 `missing` 是同一套判斷（已儲存的值）。
- **獎銜「無」**：選項（含「無」）來自 `GET /v1/amway/field-definitions` 的 `rank.options`；會員值 `fields.rank.value` 為 `null` 或 `"none"` 都代表「無」。對「無」顯示什麼文字由各 App 決定。
- **會員資料的使用範圍**：會員的「公開／隱藏」只管對外公開頁，不限制寰宇生態系內的 App；杜杜龍在後台替每款 App 勾選可用欄位（含隱藏的），App 用 `POST /v1/apps/{app_id}/members/lookup` 讀取（見 6.8、ADR 0022）。
- **獎銜與獎章圖（2026-11-22.2）**：`members/lookup` 的 `fields` 含 `rank` 時，每位會員多回 `rank_label`（中文名稱）與 `rank_badge`（`badge_url` 與 `badge` 幾何），服務 Token 不必再讀 `field-definitions`；杜杜龍在後台勾選 `rank` 才可用（見 ADR 0034）。
- **串接指令放在雲端（2026-11-22.3）**：完整指令固定公開在 `https://id.hglobal1985.com/handoff/<app_id>`（純文字、永遠最新、沒有金鑰）。交接時只要貼「請讀這個網址並照做」那幾行（後台「給開發 AI 的串接指令」頁最上面有複製鈕），不必貼整份；AI 更新時重新讀取網址、只補差異（ADR 0035）。\n- **深色模式**：跟隨系統，配色依視覺規範 1.5；杜杜龍核准的例外才可保留自己的配色。
- **測試環境**：正式前用 staging（`https://hglobal-id-staging.hglobal1985-static.workers.dev`，會員、金鑰、App 登記獨立）。`http://localhost` 不能登記；手機用已登記的深層連結，網頁用 https 預覽網址。測試版共用登入鍵名建議 `hglobal.sso.staging`。
- **新規範流程**：任何新規範先寫進串接指令與更新檢查清單並升版，各 App 只補差異（見 `AGENTS.md`「平台規範」）。

## 6.8 平台資料標準（2026-11-12.10，所有 App 一體適用）
完整設計與規格見 [ADR 0021](adr/0021-platform-standards.md)。
- **原則**：①個人資料正本只在中央，App 只存 `member_id`，複製要有同步與刪除機制；②交易紀錄存「當時快照」，對帳靠付款代碼或金流交易編號，不靠姓名；③需要聯絡方式走中央的聯絡查詢，不長期保存副本；④變動與刪除由中央 webhook 通知，App 照辦；⑤只拿到最小權限，中央留稽核。
- **webhook**：事件 `member.profile_changed`（`fields` 只有欄位名稱）、`member.deleted`、`webhook.test`；POST JSON，標頭 `X-HG-Event-Id`／`X-HG-Timestamp`／`X-HG-Attempt`／`X-HG-Signature: v1=HMAC-SHA256(金鑰, 時間戳.原始內容)`；驗簽用原始內容、常數時間、時間窗 5 分鐘、依 `id` 去重、5 秒內回 2xx。至少一次投遞，失敗在 1 分、5 分、30 分、2 小時、6 小時、24 小時重試（共 7 次），紀錄保存 30 天。金鑰由杜杜龍在後台取得，只放伺服器環境變數。
- **聯絡查詢**：服務金鑰（後台建立，只放伺服器）→ `POST /v1/service/token` → `POST /v1/apps/{app_id}/contacts/lookup`（≤ 50 個 `member_id`、`purpose` 須經杜杜龍核准）。信箱用完即丟；中央每次稽核（不記信箱）。
- **最小權限**：新 App 預設只有 `amway.read`；多的權限由杜杜龍在後台勾選；收到 403 不自行繞過。
- **符合度回報**：`GET /v1/apps/{app_id}/handoff?integrated=<版本>&standards=webhook,delete_copy,no_email_copy,snapshot_reconcile,least_scope`（只列已做到的），後台 App 清單顯示結果。

## 6.9 會員資料查詢（2026-11-13.1，ADR 0022）
- `POST /v1/apps/{app_id}/members/lookup`，服務 Token；`{"member_ids":[≤100],"fields":["legal_name","rank",…],"use":"process"|"display"}` → `{"members":[{"member_id","fields":{…}}],"not_found":[…]}`。
- 只能讀在該 App 登入過的會員、只能讀杜杜龍在後台勾選的欄位（含會員設為隱藏的）；沒勾回 `403 field_not_allowed`。需要審核的 Amway 欄位只回已審核的；非 Amway 會員的 Amway 欄位為 `null`。
- 只取需要的欄位；不長期保存、不寫日誌與分析工具、不轉給寰宇生態系以外；中央每次稽核（App、筆數、欄位名稱、用途，不含內容）。對外公開頁仍然只顯示會員設為公開的欄位。
- **批次與上手欄位（2026-11-20.2，ADR 0032）**：一次最多 **100** 個 `member_id`（超過 `422`）。`members` **依請求順序**、同一個 id 只出現一次；查不到的（沒在該 App 登入過、已停用、已刪除）列在 `not_found`，不會讓整批失敗。回傳形狀與以前相同（不改版）。
- **上手欄位**：`upline_platinum`（上手白金）、`upline_diamond`（上手鑽石）：文字（會員自己填的名字，不是會員 ID）；沒有待審核狀態；沒填或會員沒開 Amway 專區為 `null`。與其他欄位一樣要杜杜龍在「平台設定」勾選，沒勾 `403 field_not_allowed`。
- **頻率與效能**：每個 App 每分鐘 120 次（`429`，`retry-after: 60`）。單次 100 筆只做固定幾次資料庫查詢（不隨人數增加；`test/roundtrips.test.ts` 防退步）。實際牆鐘時間取決於 Worker 與資料庫的距離（見 ADR 0025），請以 staging／正式實測為準。
- **App 端**：列表頁只讀目前這一頁、匯出分批讀；結果只放記憶體或短暫快取，不寫資料庫與日誌；失敗（403／422／429／逾時／5xx）顯示「未提供」，不影響其他功能。

## 6.10 頭銜與行業類別欄位（2026-11-15.1）
- **頭銜**（`job_title`，2026-11-15 起標籤由「職稱」改稱「頭銜」，代碼不變）：`tags`（多項，最多 10 項、每項 ≤ 50 字）、預設公開、`profile.basic.write`；順序在「行業類別」之後、「公司／單位」之前。定義的 `suggest` 為 `job_title`，輸入時呼叫 `GET /v1/vocab/suggestions?pool=job_title&q=…` 顯示關聯詞。值是文字陣列：`PUT /v1/me/profile/fields/job_title`（`{"value":["經理"]}`）。輸入過的頭銜自動進詞庫，杜杜龍在後台「關聯詞」編輯、合併、刪除。
- **行業類別**（`occupation`，原稱「職業」「行業與工作」，代碼不變）：改為**單選下拉選單**（`type: "select"`），沒有關聯詞輸入。選項在欄位定義的 `options`（`value` 與 `label` 相同，順序即顯示順序），內建台灣常見行業別，杜杜龍在後台「關聯詞」頁維護（新增、改名、合併、刪除，App 不用改）。選項多，下拉要可搜尋。值是單一文字：`PUT /v1/me/profile/fields/occupation`（`{"value":"製造業"}`、`null` 清除），必須在目前清單內，否則 `422 not_an_option`；已存的值就算之後從清單刪除，仍會顯示、可原樣保存。舊版的標籤陣列請改成單選並容忍舊陣列值。
- 其他會員的這兩個欄位走 `POST /v1/apps/{app_id}/members/lookup`（杜杜龍在後台勾選 `job_title`、`occupation`）。欄位定義版本 `2026-11-15.1`。

## 6.10.1 欄位異動（2026-11-14.6）
- 刪除「使用語言」（`languages`）；中央已刪除會員存的舊值。畫面照欄位定義產生，自然消失。
- 「介面語言」（`locale`）預設繁體中文：沒選過時 `GET /v1/me/profile` 的 `fields.locale.value` 為 `"zh-TW"`，欄位定義多一個 `default_value`；預設值只用來顯示，不寫回中央。欄位定義版本 `2026-11-14.4`。

## 6.11 下拉重新整理（2026-11-14.3，所有 App、所有頁面一體適用）
杜杜龍 2026-11-14 決定：每個畫面都要支援「在頁面最上方往下拉 = 重新整理」，取代網頁版沒有重新整理按鈕的缺陷。
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
- App 不自己存圖庫、不自己新增徽章；新增獎銜時由杜杜龍在中央後台「獎銜徽章」上傳。

## 6.16 在 App 內指派職務（2026-11-21.1，ADR 0033）
給需要讓管理者直接在 App 內指定會員擔任審核員、會長、課務、音控、票務、活動的 App（例如行動大學）。
- `GET /v1/eligibility/staff`：不帶 `q` ＝ 有職務的會員（最多 200）；帶 `q`（2–30 字）＝ 搜尋顯示名稱含關鍵字的啟用會員（最多 20），有沒有職務都找得到。回 `{assignable_roles:[{role,label}], members:[{member_id, display_name, roles:[{role,label,assignable}]}]}`。
- `PUT /v1/eligibility/staff/{member_id}`，body `{"roles":["sound","course"]}`：`roles` 是事後應有的可指派職務完整清單（空陣列＝全部移除）。回 `{member_id, roles:[…事後全部職務], changed}`。
- 呼叫者本人的 App 會員 Token（`amway.read`）。**誰可用由中央判斷**：與後台相同的 `staff.manage`（目前只有超級管理員），否則 `403`；杜杜龍要替 App 勾 `display_name`，否則 `403 field_not_allowed`。
- **可指派**：`reviewer`、`president`、`course`、`sound`、`ticket`、`activity`。`super_admin`、`secretary` 只能在中央後台設定：帶了 `422`，對象原本的這兩種職務與額外權限不動。只能給出自己權限涵蓋的職務（`403`）；對象不存在或已停用 `404`。
- 每次查詢與指派都稽核（呼叫者、App、對象、職務變化；不記搜尋字與姓名）。App 只在管理者本人開啟時即時讀取、不保存名單；非 200 當作沒有權限；指派前要確認。

## 6.14 獎銜與中心的申請審核（2026-11-17.1，ADR 0030；修改後通過 2026-11-20.1，ADR 0031）
給需要讓審核人員在 App 內看到並處理中央「獎銜、教育中心」新申請的 App（例如行動大學通知頁的「審核」分類）。
- `GET /v1/eligibility/reviews`、`POST /v1/eligibility/reviews/{id}/decision`（body `{"decision":"approve"|"reject"}`）：呼叫者本人的 App 會員 Token（`amway.read`）。
- **規則與中央後台完全一致**（由中央判斷）：`super_admin`、`secretary` 看到並可處理全部；`reviewer`（審核員）只看得到、只能處理自己已審核教育中心的申請；沒有審核職務回 403；不屬於自己中心的處理回 403；已處理過回 404。
- **回傳**：`{scope:"all"|"center", reviews:[{id, member_id, display_name, field_key, field_label, center, current_value, requested_value, created_at}]}`（最舊在前、最多 200 筆）；沒有信箱、電話、會員編號。處理後申請人收到通知、審核員的「等待審核」通知標成已完成。
- **授權**：杜杜龍在後台「平台設定」替 App 勾 `display_name`，否則 `403 field_not_allowed`。每次列出與處理都有稽核。
- App 只在審核人員本人開啟時即時讀取；待審中的申請與整份待審名單不保存；任何非 200 當作沒有權限；處理前要確認。
- **已處理紀錄（2026-11-22.4，ADR 0036）**：審核完成後 App 可保存已處理紀錄供查詢：申請人姓名快照（處理當下的 `display_name`，不跟著改名）、申請內容快照（欄位名稱、原本的值、申請的值、修改後通過的值）、處理結果、處理時間、審核人員顯示名稱。快照只供查詢，不得用來判斷資格或權限；不得保存 Amway 會員編號、上手、資格查詢結果、整份待審名單、搜尋字；姓名與申請內容不進日誌、分析工具、錯誤回報；收到 `member.deleted` 要把該會員的姓名與申請內容快照清成空白（不用刪整筆）。這是三、7「Amway 資料不得保存」唯一的例外。沒有新的程式要做。
- **修改後通過（2026-11-20.1，ADR 0031）**：decision 的 body 可多帶選填 `value`（格式同欄位定義：文字，或 `{option, custom_text}`），例如 `{"decision":"approve","value":"新竹 122"}`。只有 `approve` 可帶（`reject` 帶 value `422`）；只能改 `education_system`、`education_center`、`rank`；不合規則（不在選項、空白、過長）`422`。與申請不同時以 `value` 核准，回應 `modified: true`，申請人的通知寫明經審核者修改。原申請值與修改後的值記在該筆申請上，稽核只記「有修改」、不記值。只有自己中心權限的審核員不能把中心改成別的中心（`403`）。
- **回傳新增**：列表每筆多 `member_id`（申請人的中央會員識別碼）；處理回應為 `{id, member_id, field_key, decided, modified}`。這兩個識別用來通知申請人；待審中的不保存，已處理紀錄依上一條規則保存。

## 6.13 同中心會員名單（2026-11-15.4，ADR 0028）
給需要讓教育中心的音控或會長「從名單點選同中心會員」的 App（例如指派小編；不可用手動貼會員 ID）。
- `GET /v1/eligibility/center-members?q=&limit=&cursor=&center=`：呼叫者本人的 App 會員 Token（`amway.read`）。
- **誰可查**：`sound`（音控）、`president`（會長）且有已審核教育中心 → 只回自己的中心（指定別的中心回 403）；`super_admin`、`secretary` 可帶 `center=<詞庫中的中心名稱>`（不存在 404；沒帶且沒有自己的中心 422）；其他人 403；非 App 內登入的 Token 403。
- **名單**：教育中心已審核且相同（`center.key`）、帳號啟用、Amway 開啟，不含自己；沒登入過這款 App 的也列出（`signed_in_app`）。`q` 只比對顯示名稱。`limit` 預設 20、上限 50，`cursor` 翻頁。
- **回傳**：`{center:{key,label}, members:[{member_id, display_name, avatar_url|null, signed_in_app}], next_cursor|null}`；沒有信箱、電話、獎銜或其他 Amway 欄位。
- **授權**：杜杜龍要在後台「平台設定」替 App 勾 `display_name`（頭像再勾 `avatar`，沒勾時 `avatar_url` 為 null），否則 `403 field_not_allowed`。每次查詢都有稽核（不記搜尋字與姓名）。
- App 只存被指派者的 `member_id` 與當下顯示名稱；確認對方仍在同中心用對方本人的 `GET /v1/eligibility/context`。

## 6.14 新增職稱詞條（2026-11-15.5，ADR 0029）
- `POST /v1/vocab/suggestions`，**服務 token**（`POST /v1/service/token`，與聯絡查詢相同；不是會員登入），body `{"pool":"job_title","value":"區域經理"}`。
- 只開放 `job_title`（其他詞庫 `403`）；`value` 去除前後空白、最長 50 字（空或過長 `400`）；已有的詞（不分大小寫與全半形）不重複新增，回既有的詞，`created: false`。成功 `200 {pool, value, created}`。
- 新詞是**待核可**：杜杜龍在後台「關聯詞」核可後才出現在別人的建議（`GET /v1/vocab/suggestions`）；刪除＝拒絕。沒帶或帶錯 token `401`。不需要在後台另開權限。
- 限制：每個 App 每分鐘 30 次、待核可最多 200 個（`429`）；每次新增都有稽核（App、時間、字）。不讀寫任何會員自己的職稱。
- App 端：`404`／`405`／`501`（沒開放）、`401`、`429`、逾時、`5xx` 先暫存稍後重送；`400` 不重送。

## 7. 串接指令版本回報
App 自己的管理頁（只給超級管理員）呼叫 `GET /v1/apps/{app_id}/handoff?integrated=<採用的版本>`：回傳最新版本、`up_to_date` 與最新指令文字，並記錄 App 採用的版本。後台 App 清單會顯示是否最新。

## 8. 新 App 登記（杜杜龍）
後台 → App → 新增 App：填 `app_id` 與名稱即可，其餘欄位留空會自動產生。30 秒內生效，可用 `GET /v1/apps/<app_id>/config` 確認。不再使用時先按「停用」；停用且沒有會員的 App 可在後台按「刪除登記」永久刪除（稽核紀錄保留）。

## 6.15 App 內直接刪除帳號（2026-11-23.3，ADR 0037，所有 App 一體適用）
會員在任何串接的 App 內按「刪除帳號」就直接刪除並清空所有資料，不用再被帶去 `/my/edit`。
1. **二次確認**：寫明「會刪除你在所有寰宇 App 的帳號與資料，無法復原」。
2. **重新驗證**（10 分鐘內的 Google 登入）：`POST /v1/auth/nonce` → 瀏覽器開 `GET /auth/google/start?app_id=…&nonce=<sha256 hex>&return=…&state=…&purpose=delete_account`（會員再按一次 Google 登入）→ 把回傳的 `id_token` 與原始 `nonce` 送 `POST /v1/auth/reauth`（帶會員自己的 Access Token；必須是登入時同一個 Google 帳號，否則 `403`）→ 得到 `reauth_token`（10 分鐘，只綁這個會員、這個 App 的這次登入，只能用來刪帳號，不能當 Access Token）。
3. **刪除**：`POST /v1/me/delete-account`，Bearer Access Token，body `{"reauth_token":"…"}`；只能刪 token 本人。成功 `{"deleted":true}`，效果與網站按鈕完全一致（匿名化並關閉、所有裝置登出、Google 帳號釋放、會員資料與 Amway 資料清除）。App 成功後立刻清本機資料與 Token、回登入畫面；其他已串接 App 收到 `member.deleted`。
4. **錯誤**：`401 reauth_required`（沒帶或過 10 分鐘，重走第 2 步）、`403 forbidden`、`409 last_super_admin`（message 直接顯示給會員）。被暫停（paused／killed）的 App 不能呼叫。每次刪除寫稽核紀錄（不記信箱，記是哪個 App）。
5. 標準代碼 `in_app_delete`：做到後在 `GET /v1/apps/{app_id}/handoff?...&standards=` 回報，後台 App 清單會顯示。

## 6.16 審核通知派送（2026-11-24.1，ADR 0038）
申請當下沒有實際中心（「無」）或系統不是寰宇（含「無」「其他」自訂）的審核申請，通知與審核權限只給總部秘書（`secretary`）與超級管理員（`super_admin`，杜杜龍本人）；中心審核員看不到、不會被通知。系統是寰宇且有中心者維持原規則（同中心審核員；沒有時給秘書與超級管理員）。App 不用改，一切以中央回傳為準。

## 6.17 審核規則改版（2026-11-24.2，ADR 0038，杜杜龍決定）
- 獎銜：只要不是「無」，不論系統與中心一律審核（`status: pending`，核准前沒有生效值、別人看不到）。中心：系統是寰宇時審核（實際中心或明確勾「無」）；系統不是寰宇時中心自動「無」、不審核。系統本身不審核。
- 派送：寰宇＋實際中心 → 該中心審核員（沒有時給秘書與超級管理員）；其他一律只給總部秘書與超級管理員。使用審核資料的 App 不用改，一切以中央回傳為準。

## 6.18 生態系統功能（2026-11-27.3，ADR 0039，所有 App 一體適用）
杜杜龍 2026-11-27 決定：套件漏洞提醒、網站巡檢、錯誤回報週報、資料每週備份、主要畫面截圖測試是整個生態系的**系統功能**，由中央統一設定、各 App 一體參與。
- 設定與參與狀態存在中央（`eco_features`、`eco_feature_apps`），後台「系統功能」頁可看到每個 App 有沒有參與每一項，並調整開關、頻率、通知對象（推播／Email）；`apps.operate` 可看、`apps.manage` 可改。
- App 讀 `GET /v1/apps/{app_id}/config` 的 `config.eco_features`：`{ dependency_alerts:{enabled}, uptime_watch:{enabled}, error_digest:{enabled}, weekly_backup:{enabled, weekday, keep}, screenshot_test:{enabled} }`。沒有欄位視為 false。通知對象、網址清單只存在中央。
- App 要做的事見串接指令「三、18」與檢查清單第 42 項；App 不可自己另做一套通知。
- 實際執行（巡檢、週報、備份、截圖）分別在後續 PR 實作；設定頁的「最近結果」由執行端回寫。
- **已開始執行：網站自動巡檢（uptime_watch）**：只在正式環境，中央排程每 5 分鐘醒一次，依後台設定的頻率（5～60 分鐘）對「系統功能」頁列出的網址發 GET（8 秒逾時、只算 2xx 正常）；連續失敗 2 次才算掛了，掛了與恢復各通知一次。通知＝站內通知（kind `eco.uptime`，給超級管理員）＋Email（正式 Worker 的 `send_email` 綁定，寄件人借用 `noreply@learn.hglobal1985.com`，收件人是超級管理員的聯絡信箱；信裡只有網站名稱、原因與時間）。手機推播要由 App 端轉送站內通知，尚未接上。網址只能是 hglobal1985.com 的 https。
