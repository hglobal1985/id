# ADR 0040：後台危險操作改用 passkey 確認（取代重新登入 Google）

- 日期：2026-11-28，決定者：杜杜龍。
- 背景：金鑰、App 登記、權限等危險操作原本要求「10 分鐘內剛用 Google 登入過」，否則要整個重新登入，很不方便。
- 決定：
  1. 改用 passkey（WebAuthn，指紋／臉部／手機解鎖）確認，確認後這個登入階段 10 分鐘內有效（`login_sessions.stepup_epoch`）。10 分鐘內剛用 Google 登入過也視為已確認（和以前一樣）。
  2. 管理員**第一次先建立 passkey**（2026-11-28 後續決定（杜杜龍：全生態系統永久取消二次登入）：第一把 passkey 任何有效的登入階段都能建立，不再要求剛登入過 Google；已經有 passkey 後再加新的要先用 passkey 確認。取捨：被偷走的登入階段若在管理員建立 passkey 之前就被利用，可以先建立攻擊者自己的 passkey，所以請管理員盡早建立）；還沒建立就做危險操作 → `401 passkey_setup_required`，畫面引導建立；有 passkey 但太久沒確認 → `401 passkey_required`，畫面跳出 passkey 確認。沒有「略過」選項。
  3. 範圍：後台管理員的危險操作用 passkey。會員自己「刪除帳號」原本保留 Google 重新驗證，2026-11-28 杜杜龍進一步決定全站永久取消二次登入：會員刪除帳號改成 App 內輸入 ok，中央 `POST /v1/me/delete-account` 不再檢查重新驗證（串接指令 2026-11-28.3）。
  4. 「輸入 ok」的確認規則照舊，兩者同時存在。
- 實作：`src/auth/webauthn.ts`（只用 WebCrypto、不用 CBOR：瀏覽器端用 `getPublicKey()`、`getAuthenticatorData()` 取得 SPKI 公鑰與 authenticatorData；驗證 clientDataJSON 的種類、挑戰碼、來源、rpId 雜湊、使用者在場與使用者驗證旗標，再驗簽章；支援 ES256 與 RS256；不要求 attestation）、`src/db/passkeys.ts`、`src/api/passkeys.ts`、migration 0037（`passkeys`、`passkey_challenges`、`login_sessions.stepup_epoch`）。
- 安全：挑戰碼單次、5 分鐘、綁定會員與用途；簽章計數器不可倒退（兩邊都是 0 的裝置不檢查）；每人最多 10 把；只存公鑰與計數器；稽核記建立／確認／移除（不含任何金鑰內容）。
- 後台：新分頁「Passkey」可建立、查看、移除；遇到危險操作被擋時自動跳出視窗。
