# ADR 0012：共用登入（單一登入）

狀態：已採用（2026-11-10）。做法與 starry.phd 中央會員相同，改用 H-Global1985 的名稱；業主決定 Apple 登入與通行密鑰暫不做。

## 決定
- **裝置共用登入** `device_sso`：會員在任一款 App 登入後，App 呼叫 `POST /v1/auth/sso/start` 取得 `sso_token`（`<id>.<secret>`，資料庫只存雜湊），放進所有 H-Global1985 App 共用的儲存（iPhone：Keychain 群組 `$(AppIdentifierPrefix)com.hglobal1985.shared`，鍵名 `hglobal.sso`；Android 之後再決定）。
  - 其他 App：`POST /v1/auth/sso/exchange` 換得自己的 App session（scope 來自該 App 的登記）。
  - `POST /v1/auth/sso/status`：發現別的 App 已登出或換了會員。
  - `POST /v1/auth/sso/logout`：結束這個共用登入與由它產生的所有 App session（可重複呼叫）。
  - 同一裝置換會員：舊會員由這個共用登入產生的所有 session 立即失效；同一會員重新登入則沿用。
  - 30 天沒有使用就過期；`logout-all`、停用會員、刪除帳號都會使其失效。
- **網頁版（同一個瀏覽器）**：瀏覽器不能跨網站共用儲存，由中央會員以 cookie `__Host-hgid_sso`（HttpOnly、Secure、SameSite=Lax）記住，網頁版用整頁導向詢問：
  - `/auth/sso/adopt?c=<POST /v1/auth/sso/web-code 的單次碼>`：設定 cookie。cookie 的值是另外產生的（只存雜湊），不是 App 手上的 `sso_token`。
  - `/auth/sso/check`：回傳綁定 App 與 nonce 雜湊的單次碼（2 分鐘），再由 `POST /v1/auth/sso/web-exchange` 以 nonce 原值換得 session。
  - `/auth/sso/logout`：清 cookie 並結束所有相關 session。
  - 只能回到該 App 已登記的網頁版來源；結果放在 `#` fragment。
- **不需要新的機密**：starry.phd 用加密金鑰封裝單次碼；這裡改為資料表 `sso_codes`（只存雜湊、單次使用、2 分鐘），效果相同且不必請業主設定新的 Secret。
- 串接指令升版為 `2026-11-10.3`（新增共用登入；已串接的 App 只補差異）。

## 限制
- 網頁版只在同一個瀏覽器內連動；手機 App 與網頁版之間不連動。
- 網頁版在下一次載入頁面時才會跟上登出或換人。
- 會員網站（id.hglobal1985.com 自己的登入）不參與 App 的共用登入。
