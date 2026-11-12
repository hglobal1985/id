# ADR 0021：平台資料標準（事件通知、聯絡查詢、最小權限、符合度）

狀態：程式已寫並可在 staging 測試；**production 需業主確認**。串接指令 `2026-11-12.10`。適用所有現在與未來的 App，寰宇行動大學（`learn`）是第一個驗收的 App。

## 原則（已寫進串接指令與 `docs/integration-guide.md`）
1. 個人資料正本只在中央；App 只存 `member_id`。複製只限必要，並要有同步與刪除機制。
2. 交易紀錄（報名、付款）存「當時快照」，不跟著改名；對帳靠付款代碼或金流交易編號，不靠姓名。
3. App 在會員不在線上時需要聯絡方式，走中央提供的正式管道，不長期保存副本。
4. 資料變動與刪除，中央通知各 App，App 照辦。
5. 每個 App 只拿到需要的最小權限，中央留稽核紀錄。

## 項目一：事件通知（webhook）
- **事件**：`member.profile_changed`（`fields`＝變動欄位的**名稱**，不含值；涵蓋基本資料欄位、`avatar`、`member_number`；同一會員、同一 App、1 分鐘內尚未送出的會合併成一則）、`member.deleted`、`webhook.test`（後台測試用）。
- **`member.email_changed` 不另做**：App 可取得的聯絡信箱是 `contact_email`，它的變動已在 `profile_changed.fields` 裡；Google 登入信箱從不提供給 App。重複，所以不做。
- **投遞對象**：會員登入過、且已設定 webhook 網址的 App。
- **格式**：POST JSON `{"id","type","created_at","app_id","member_id","fields"?}`；標頭 `X-HG-Event-Id`、`X-HG-Timestamp`（秒）、`X-HG-Attempt`、`X-HG-Signature: v1=<hex>`＝`HMAC-SHA256(secret, timestamp + "." + 原始內容)`；接收端須驗簽（常數時間）、拒絕與現在差超過 5 分鐘的時間戳、用 `id` 去重、5 秒內回 2xx。
- **可靠度**：至少一次（可能重複、不保證順序）。失敗重試間隔 1 分鐘、5 分鐘、30 分鐘、2 小時、6 小時、24 小時，共 7 次，之後標為 `failed`。事件（含失敗）保存 30 天後清除；後台可看每款 App 的送達紀錄（不含會員識別碼與欄位名）。
- **金鑰**：不存資料庫。由 Worker Secret `WEBHOOK_SIGNING_KEY`、`app_id` 與版本號導出；後台「顯示金鑰／重新產生金鑰」只顯示一次，由業主放進 App 的伺服器環境變數。**未設定 `WEBHOOK_SIGNING_KEY` 時不送出任何事件**（事件留在佇列，fail closed）。
- **投遞方式**：寫入事件與變動在同一個動作；請求結束後盡力立即送出，排程每 5 分鐘補送與重試（`wrangler.jsonc` 的 cron 由每日一次改為每 5 分鐘一次，每日清理改在 03:00 台灣時間那一輪）。
- **網址限制**：只能 https、真實網域（不可 IP、localhost），不跟隨轉址。
- 刪除帳號時，`member.deleted` 與刪除在同一個動作內排入；排入失敗不會擋住刪除。

## 項目二：聯絡查詢（取代 App 長期存信箱）
- **服務金鑰**（client credentials）：每個 App 一組，後台建立／重新產生（只顯示一次）、可撤銷；只存雜湊。`POST /v1/service/token {app_id, client_secret}` → 10 分鐘的服務 Token（`typ svc+jwt`，**不能**當會員 Token 使用，反之亦然）。
- **端點**：`POST /v1/apps/{app_id}/contacts/lookup`（路徑沿用 `/contacts/lookup`，不用冒號寫法，避免與路徑參數語法衝突）。輸入 `member_ids`（1～50）與 `purpose`；回 `contacts[{member_id, email, email_verified}]` 與 `not_found`。
  - `email` 優先用會員自己填的聯絡信箱（`email_verified: false`），沒有才用已驗證的 Google 信箱；
  - 只查「在這款 App 登入過」的會員；已刪除、不明、沒有信箱的都在 `not_found`；
  - `purpose` 必須是業主在後台替這款 App 核准的用途（`payment_notice`、`course_notice`、`account_security`），預設全部不核准；
  - 每次查詢寫稽核（App、筆數、回傳筆數、用途；**不記信箱**）。
- **是否需要新的同意文字**：需要補一段說明（現行政策只寫「依您的授權提供必要資料」，沒有具體說明聯絡信箱）。**建議文字（待業主核准，尚未寫進隱私權政策）：**
  - 短版（`contact_email` 欄位說明與登入頁）：「您的聯絡信箱會在您使用合作營運單位的 App 時，用來寄送報名、付款與帳號安全相關通知；對方不會長期保存，也不會用於行銷。」
  - 完整版（隱私權政策 §4 使用目的新增一點，§5 合作營運單位補一句）：§4「寄送您在合作營運單位報名、付款與帳號安全相關的通知（合作營運單位只在需要寄信時，向本網站查詢您的聯絡信箱，不會長期保存，也不會用於行銷或其他用途）。」；§5「合作營運單位查詢您的聯絡信箱時，本網站會留下查詢紀錄（哪一款 App、幾筆、用途），紀錄不含信箱內容。」
- **替代方案：由中央統一代寄通知**（未實作，供業主比較；費用為估計，未向供應商核實）：

| | A. 各 App 查詢後自己寄（本案） | B. 中央統一代寄 |
|---|---|---|
| 信箱是否離開中央 | 離開，但只在寄信當下（App 不保存） | 不離開 |
| 中央要做的事 | 已完成 | 通知 API、樣板、退信與黑名單、寄件網域（SPF／DKIM／DMARC）、濫用防護，約 3～5 個工作天 |
| 費用 | 各 App 自付寄信費用 | 需寄信服務：Cloudflare Email Service 要 Workers Paid（約每月 US$5 起，以官方現價為準；AGENTS.md 規定升級需業主核准），或第三方（依量計費，通常每千封約 US$0.1～1，以官方現價為準） |
| 風險 | App 端若違規保存信箱 | 中央成為寄信單點、信譽問題；App 的通知內容要受樣板限制 |
| 建議 | 先用 A，量大或要統一品牌再做 B | |

## 項目三：最小權限
- **機制**：App 定義新增 `scopes_restricted`。`false`（舊制，現有所有 App）＝全部權限；`true`＝只有 `scopes` 列表。**新登記的 App 預設 `true`、只有 `amway.read`（登入與資格查詢）**。要更多權限由超級管理員在後台「平台設定」勾選（舊制改新制會先確認），每次儲存寫稽核（權限清單，不含資料）。App 本身沒有升級自己的方法。
- **現有 App 不收緊**：`learn` 仍是舊制，**等業主確認後才切換**。
- **`learn` 建議 scope（盤點：讀 `/v1/me/profile` 含 `legal_name`、讀 `/v1/me/amway`、寫 `contact_email`、`/v1/eligibility/context`）**：
  - 需要：`profile.read`（`/v1/me/profile`、`legal_name`、頭像與社群連結讀取、站內通知）、`profile.contact.write`（寫 `contact_email`）、`amway.read`（`/v1/me/amway`、資格查詢與 `/v1/eligibility/context`）。
  - 不需要：`profile.basic.write`、`profile.avatar.write`、`profile.birthday.write`、`profile.visibility.write`、`profile.spouse.write`、`amway.write`。
  - 若之後行動大學要在 App 內改顯示名稱等基本資料，再加 `profile.basic.write`。
  - **切換前請 learn 的 AI 確認**沒有呼叫上述「不需要」的端點；切換後 403 `forbidden` 的錯誤要回報給業主。

## 項目四：標準符合度
- App 管理頁呼叫 `GET /v1/apps/{app_id}/handoff?integrated=<版本>&standards=<逗號分隔，只列已做到的>`；代碼：`webhook`、`delete_copy`、`no_email_copy`、`snapshot_reconcile`、`least_scope`（沿用既有的版本回報；沒帶 `standards` 就保留上一次回報）。
- 後台 App 清單顯示「平台標準符合 N／5」與送不出去的事件數；「平台設定」頁逐項列出，其中 `webhook`（是否已設定網址）與 `least_scope`（是否已收緊）由**中央自行驗證**，同時要 App 也回報才算符合；其餘三項只能由 App 回報。

## staging 測試方式
1. 業主先用 Google 帳號登入 staging 一次，告訴 AI；AI 在 staging 資料庫替他加超級管理員（只動 staging）。
2. 業主在 GitHub → Actions → **Worker secrets** → Run workflow，環境選 staging，勾選 `create_webhook_key`（金鑰在機器內產生並直接存進 Cloudflare，沒有人看得到；第一次才勾，再勾一次會讓所有 App 的 webhook 金鑰改變）。
3. 後台 → App → 平台設定：填 webhook 網址 →「送一則測試」→「顯示金鑰」交給 App 的環境變數；建立服務金鑰與核准用途。
4. 登入 App 後改一個基本資料欄位，確認 App 收到 `member.profile_changed`；刪除測試帳號，確認收到 `member.deleted`。

## 風險與需要業主決定
- 新增 Worker Secret（業主設定）；cron 改為每 5 分鐘（Workers 免費額度內，無費用）。
- 排程每 5 分鐘一輪，立即送出是盡力而為；網路失敗由重試補上。
- 刪除帳號多一筆查詢（已包在 try 裡，不會擋住刪除）。
- 業主要決定：隱私文字是否核准、`learn` 何時切到最小權限、是否要做中央代寄、`learn` 要核准哪些聯絡用途。
