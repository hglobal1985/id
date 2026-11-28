# ADR 0040：後台危險操作改用 passkey 確認（取代重新登入 Google）

- 日期：2026-11-28，決定者：杜杜龍。
- 背景：金鑰、App 登記、權限等危險操作原本要求「10 分鐘內剛用 Google 登入過」，否則要整個重新登入，很不方便。
- 決定：
  1. 改用 passkey（WebAuthn，指紋／臉部／手機解鎖）確認，確認後這個登入階段 10 分鐘內有效（`login_sessions.stepup_epoch`）。10 分鐘內剛用 Google 登入過也視為已確認（和以前一樣）。
  2. 管理員**第一次先建立 passkey**（建立時需要 10 分鐘內剛登入過 Google，避免被偷走的登入階段偷偷加上攻擊者自己的 passkey）；還沒建立就做危險操作 → `401 passkey_setup_required`，畫面引導建立；有 passkey 但太久沒確認 → `401 passkey_required`，畫面跳出 passkey 確認。沒有「略過」選項。
  3. 範圍只有後台管理員的危險操作；會員自己「刪除帳號」（所有 App 通用的 Google 重新驗證流程，串接指令三、9）不變。
  4. 「輸入 ok」的確認規則照舊，兩者同時存在。
- 實作：`src/auth/webauthn.ts`（只用 WebCrypto、不用 CBOR：瀏覽器端用 `getPublicKey()`、`getAuthenticatorData()` 取得 SPKI 公鑰與 authenticatorData；驗證 clientDataJSON 的種類、挑戰碼、來源、rpId 雜湊、使用者在場與使用者驗證旗標，再驗簽章；支援 ES256 與 RS256；不要求 attestation）、`src/db/passkeys.ts`、`src/api/passkeys.ts`、migration 0037（`passkeys`、`passkey_challenges`、`login_sessions.stepup_epoch`）。
- 安全：挑戰碼單次、5 分鐘、綁定會員與用途；簽章計數器不可倒退（兩邊都是 0 的裝置不檢查）；每人最多 10 把；只存公鑰與計數器；稽核記建立／確認／移除（不含任何金鑰內容）。
- 後台：新分頁「Passkey」可建立、查看、移除；遇到危險操作被擋時自動跳出視窗。
