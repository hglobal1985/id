# ADR 0001：初始架構

狀態：已採用（2026-11-10）

## 決定
- Cloudflare Workers + D1；Hono + Zod + OpenAPI（OpenAPI 3.1 由程式碼產生）。
- 邏輯架構與 UI 設計參考繁星 starry.phd 中央會員系統，但**不複製其程式碼**：寰宇需要新寫完整的 OIDC 提供者（授權碼 + PKCE），以及不同的欄位 API（`PUT /v1/me/profile/fields/{field_key}`）。
- 沒有電池系統。
- 會員編號允許重複（偵測夫妻），與繁星現行的唯一限制不同。
- 登入第一版只有 Google，以 `sub` 辨識。
- R2 暫不啟用（頭像上傳回 501 `not_available`）。
- 兩套系統不共用帳號、資料庫、R2 或 Secrets。

## 後果
- 公開 repo：機密只存在 Workers Secrets 與 GitHub Actions Secrets。
- 部署前需要業主備妥：Google OAuth 用戶端與 redirect URI、Cloudflare Token、GitHub Secrets。
