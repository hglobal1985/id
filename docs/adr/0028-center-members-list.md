# ADR 0028：查詢同中心會員名單（給 App 讓音控或會長挑人）

日期：2026-11-15。狀態：程式已寫並測試；部署後要實測。來源：行動大學 `docs/central-request-center-members.md`（業主同意修改中央）。

## 決定
- 新增 `GET /v1/eligibility/center-members`（`q`、`limit` 預設 20 上限 50、`cursor`、`center`）。用呼叫者**本人的 App 會員 Token**（`amway.read`），與 `GET /v1/eligibility/context` 同一套驗證，不用服務 Token，所以中央確實知道「是誰、哪個 App」在查。
- **權限**：`sound`、`president` 且有已審核的教育中心 → 只看自己中心，指定別的中心回 403；`super_admin`、`secretary` 可用 `center` 查詞庫裡的任一中心（不存在 404，沒帶又沒有自己的中心 422）；其他人 403。不是 App 內登入的 Token 一律 403。
- **名單**：教育中心已審核（`value_approved`）且以 `center.key`（`normTerm`）相同、帳號啟用、Amway 開啟的會員，不含呼叫者自己。**沒登入過該 App 的會員也列出**，用 `signed_in_app` 標示（業主要求；理由：這是同中心的職務人員挑人，回傳只有名字與頭像，沒有聯絡或 Amway 資料）。
- **隱私**：只回 `member_id`、`display_name`、`avatar_url`、`signed_in_app`。搜尋只比對顯示名稱，**不比對本名**（本名只供對帳）。依 ADR 0022，呼叫的 App 必須在後台「平台設定」被勾選 `display_name`（回頭像再勾 `avatar`），否則 `403 field_not_allowed`。
- **稽核**：每次查詢記一筆（呼叫者、App、中心、筆數、是否搜尋／翻頁；不記搜尋字與姓名）；被拒絕的記 `denied` 與原因。
- 排序：顯示名稱、再依會員識別碼；`cursor` 是最後一筆的（名稱、識別碼），翻頁不重複不漏。
- 串接指令新增三、14 與檢查清單 26（版本 2026-11-15.4）。

## 不做
- 不在中央新增「小編」職務、不寫入任何會員資料、不開放修改中心／職務／獎銜。

## 效能
- 中心成員在程式裡比對 `center.key`（資料庫沒有存正規化欄位）：一次查出所有「已審核中心」的會員，再依中心過濾；人數到數千人仍是常數次往返（姓名與頭像每 90 人一批）。若超過萬人再加正規化欄位。
