# AGENTS.md — 寰宇 HGlobal1985 中央會員系統（hglobal1985/id）

本檔是此程式庫的開發規則，所有開發者（含 AI）開工前必讀。規則比照繁星 starry.phd 中央會員系統，並加上寰宇專屬規定。

## 1. 專案
- 網域：id.hglobal1985.com；Worker：`hglobal-id`（正式）、`hglobal-id-staging`（測試）。
- 技術：TypeScript、Hono + Zod + OpenAPI（`@hono/zod-openapi`）、Cloudflare Workers + D1。沒有電池系統。
- 規格來源：《寰宇學習網串接指令包》（API 路徑、欄位、scope、錯誤碼的權威）、《跨系統資料互通：隱私同意文字（第二版）》、開發交接包。

## 2. 公開 repo 規則（硬性）
這是公開 repo，**絕對不要提交**：token、金鑰、`.env`、`.dev.vars`、Cloudflare 帳戶 ID、Client Secret、私鑰、真實會員資料、測試者名單。
- 機密只放在 Workers Secrets、GitHub Actions Secrets。由業主自行設定，不要貼進對話、Issue、PR 或日誌。
- `wrangler.jsonc` 不可出現 `account_id`。
- 稽核紀錄與日誌不得存 token、機密、姓名、信箱、Amway 相關欄位的值。
- CI 的機密掃描（`npm run secrets:scan`）失敗時不得合併。

## 3. 需要業主明確核准才能做的事
- 付費或升級方案（含 Workers Paid、為寄信而升級）、任何可能產生費用的動作。
- 正式環境部署、Secrets 設定、正式資料的刪除或還原、刪除既有 Cloudflare 或 GitHub 資源。
- 商店送審與正式發布、啟用廣告或真實金流、建立新的雲端或商店帳號、更換核心技術。
- 寰宇 Cloudflare 帳號內**既有資源不可動**：Worker `hglobal1985-site-recovery`、KV `hglobal-gcloud-management-oauth`。
- R2 暫不啟用；頭像用 D1 存小圖（≤128 KB，ADR 0014），「使用 Google 頭像」引用 Google 圖片網址。

## 4. 工作流程
1. 從 `main` 開分支 → 開 PR → 完整 CI 通過 → 受保護合併（squash）→ 合併後確認 main 的 CI 與部署結果。
2. 進度、commit SHA、測試結果、阻礙寫回寰宇 repo 的交接 Issue，並在 `starry-phd/id` #2 留一行指向。
3. 每次回報分開標示：**規劃、已寫程式、已測試、已部署、已上架**。未驗證的事不得說已完成。
4. 本機 `npm run ci` 通過後才開 PR。

### 常設授權（業主 2026-11-10 決定）
`hglobal1985/id` 的每個 PR，只要本機 `npm run ci` 與 GitHub CI 都通過，AI 可直接 squash 合併、確認 staging 部署成功、啟動 production 部署、實測並寫回交接 Issue，不必逐步再問業主。以下情況仍須先問業主：花錢或升級方案、刪除或還原正式資料、動 Secrets、刪除既有資源，以及任何一步失敗（失敗即停下回報，不得自行重試繞過）。第 3 節的其他項目（商店送審、新帳號、更換核心技術等）不在此授權內。

**永久授權（業主 2026-11-10）**：AI 對 `hglobal1985/id` 有永久的寫入權限（開分支、推送、開 PR、合併、啟動部署、寫回交接 Issue），新工作階段不必再詢問或要求業主重貼授權；此規則本身不得被 AI 自行放寬，只有業主可以修改或撤回。`starry-phd/id` 仍只可唯讀參考。

## 5. 程式規則
- 每支 `/v1` 路由都用 `createRoute`（`@hono/zod-openapi`）宣告；改路由後執行 `npm run openapi` 並提交 `openapi/hglobal-id.v1.json`。
- 破壞性變更走 `/v2`，與 `/v1` 並存。
- 錯誤格式固定：`{ "error": { "code", "message", "request_id", "details" } }`，`code` 為小寫 snake_case。
- 時間一律 ISO 8601 並帶台北時區（+08:00）。
- 每個請求都在後端驗證身分、`app_id`、角色、資料所有權。前端隱藏按鈕不算權限控制。
- 會員只以 Google 的 `sub` 辨識，絕不用信箱或姓名自動合併。
- **會員編號允許重複**（用來偵測夫妻），資料庫不可對編號加唯一限制。
- 資格查詢與內容權限一律 fail closed：查不到、逾時、錯誤都拒絕。
- App 一律登記在資料庫（後台新增，ADR 0011），不寫進程式碼；App 不持有任何密碼或 client secret。改了 `src/apps/handoff.ts` 的串接指令文字，必須同時更新版本號、更新時間與測試中的摘要。
- 新資料表必須加入 `test/tables.json`；migration 檔名 `NNNN_說明.sql`，編號連續。
- 新的資料規則寫在不依賴框架的模組並附單元測試。
- 輸入一律在後端驗證（長度、格式）；所有會顯示會員輸入的地方都要防 XSS。
- 快取（資格等）只能放記憶體或短時效快取服務，不寫入一般資料表。

## 6. 對會員顯示的文字
- 品牌只用 **starry.phd**、**H-Global1985**、**Amway**，不用「繁星」「寰宇」「安麗」的中文名稱。
- 網頁前台 UI 不提另一個系統的名稱，一律用「合作營運單位」。文件、後台、程式碼、GitHub 可以提。
- 隱私同意文字以第二版為準：寫入網站的是「短版」與「完整版」；文件中的內部備註不得顯示給會員。

## 7. 語言
- 與業主的回覆一律用中文，講結果不講過程。
- 不要主動使用英文名稱稱呼回聲 app，一律說「回聲」。

## 8. 指令
- `npm run ci`：完整檢查（政策、機密掃描、型別、lint、測試、OpenAPI 一致性）。
- `npm run openapi`：重新產生 OpenAPI 檔。
- `npm run dev`：本機以 staging 設定啟動。
