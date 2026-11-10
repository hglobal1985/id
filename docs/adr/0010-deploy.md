# ADR 0010：部署（staging → production）

狀態：已採用（2026-11-10，PR 10）

## 決定
- 測試環境：Worker `hglobal-id-staging`（workers.dev 網址）＋ D1 `hglobal-id-staging`（2026-11-10 建立於 H-Global1985 帳號，APAC，資料表已套用 0001～0008）。正式環境：Worker `hglobal-id`＋ D1 `hglobal-id`＋ `id.hglobal1985.com`，建立與上線需業主核准。
- 部署由 GitHub Actions 執行（`.github/workflows/deploy.yml`）：main 的 CI 成功後自動部署 staging；production 只能手動啟動：業主在對話中明確同意後由 Claude 啟動（業主 2026-11-10 決定不設 GitHub 審核人，以減少手動操作）。Cloudflare Token 與帳號 ID 只放在 GitHub Secrets；沒設定時部署步驟自動略過。
- Worker 機密由 `.github/workflows/worker-secrets.yml` 寫入：簽章金鑰在 GitHub 執行機內產生並直接寫進 Cloudflare；Google Client Secret 從 GitHub repository secret 轉存。`GOOGLE_CLIENT_ID` 為 repository variable，部署時以 `--var` 帶入。
- 次數限制：Workers Rate Limiting，每位會員每分鐘查詢 120 次、寫入 30 次，超過回 429 `rate_limited`（`Retry-After: 60`）。資格查詢算查詢。限制服務本身故障時不擋請求（它是防濫用，不是權限控制）。
- 每日排程（台北 03:00）：清除過期的登入流程、授權碼、撮合候選；取消勾選「我是Amway會員」滿 1 年的會員，刪除其 Amway 資料並記錄撤回同意與稽核。
- 帳號內既有資源（`hglobal1985-site-recovery`、KV `hglobal-gcloud-management-oauth`，以及另行建立的 `learn`）不動。
