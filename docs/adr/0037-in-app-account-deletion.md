# ADR 0037：App 內直接刪除帳號（所有 App 一體適用）

日期：2026-11-23　狀態：採用（杜杜龍決定）

## 背景
`POST /v1/me/delete-account` 原本只接受會員網站的 session，App 只能放按鈕把會員帶去 `/my/edit` 重新登入再按一次。杜杜龍要求取消二次跳轉：會員在任何串接 App 內按「刪除帳號」就直接刪除並清空所有資料。

## 決定
- **刪除端點雙軌**：會員網站維持原樣（session，10 分鐘內登入）；App 改用會員自己的 App Access Token（Bearer）加 `reauth_token`。只能刪 token 本人；OIDC 用戶端的 token 仍是 `403`。被暫停或下架的 App，token 本來就無效（`401`）。
- **重新驗證**（不新增 session、不發新的 Access Token）：登入中繼 `/auth/google/start` 多一個選填參數 `purpose=delete_account`（只影響回傳頁文字「確認完成」；其他值回 400）。App 把回傳的 `id_token` 與原始 nonce 送新端點 `POST /v1/auth/reauth`（Bearer）。驗證項目與登入相同（Google 簽章、audience、nonce 綁定 App 且只能用一次），再加上：Google `sub` 必須等於這位會員的 `google_sub`，否則 `403`。成功回短效 `reauth_token`。
- **`reauth_token`**：JWT，`typ` 為 `reauth+jwt`（因此永遠不能當 Access Token），效期 10 分鐘（與網站的 `REAUTH_MAX_AGE` 同一個常數），綁定 member、App、App session（`sid`）與用途 `delete_account`。刪除時逐項核對，不符回 `401 reauth_required`。不做單次使用：刪除成功後會員已不存在。
- **效果**與網站完全相同（同一個 `deleteAccount`）：匿名化並關閉、所有裝置登出、Google 帳號釋放、資料清除、對所有已串接 App 送 `member.deleted`。稽核紀錄 `account.delete` 多記 `app_id` 與 `detail.via = "app"`（不記信箱）。`app.reauth` 另有稽核（成功／拒絕與原因）。
- **防濫用**：沿用 Bearer 的每會員寫入頻率限制；`/v1/auth/reauth` 另有與登入相同的每 IP 限制。不需要新的 scope（所有已登記且 active 的 App 一體適用）。
- 錯誤碼：`401 reauth_required`、`403 forbidden`、`409 last_super_admin`（訊息為白話中文，App 直接顯示）。
- 新標準代碼 `in_app_delete`（App 內可直接刪除帳號），納入標準符合度回報與後台 App 清單。串接指令三、9 改寫、檢查清單新增 36，升 `2026-11-23.3`。

## 後果
App 不必再開啟 `/my/edit`；`/my/edit` 的刪除按鈕保留給網頁版會員。重新驗證靠「會員在瀏覽器再按一次 Google 登入」，與網站的重新登入同等強度。
