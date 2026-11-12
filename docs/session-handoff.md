# 新對話交接包（給接手的 AI）

寫於 2026-11-12（之後有更新）。狀態：production 與 staging 以 main 為準；串接指令 `2026-11-12.9`；資料庫遷移到 `0023`；本機 `npm run ci` 232 個測試全過（以 main 為準）。
這份文件不含任何機密或個資（公開 repo）。先讀 `AGENTS.md`（規則的權威），再讀本檔，再看交接 Issue `hglobal1985/id#2` 最後幾則留言。

## 1. 怎麼跟業主合作（最重要）
- 業主不是工程師；回覆**一律中文、先講結果不講過程**；每次回報分開標示 **規劃／已寫程式／已測試／已部署／已上架**，沒驗證的不說完成。
- 業主給一大批 UI 調整時，細節不確定就自己決定（業主已授權「有任何問題授權給你幫我決定」），但要在回覆說明你的決定；**討論性問題（「你覺得呢」「先不要執行」）只回答，不要動手**。
- 常設與永久授權（`AGENTS.md` 第 4 節）：對 `hglobal1985/id` 可直接開分支→PR→CI 通過→squash 合併→確認 staging→**dispatch production 部署**→實測→寫回 Issue #2。以下仍須先問：花錢或升級方案、刪除或還原正式資料、動 Secrets、刪除既有資源、任何一步失敗（失敗就停下回報，不要自己繞過重試）。`starry-phd/id` 只可唯讀。
- 前台畫面不顯示「寰宇」「H-Global1985」「hglobal」，品牌只用 starry.phd、Amway；網頁標題統一「會員中心」；對另一個系統一律稱「合作營運單位」。簡稱固定：直銷商培訓系統＝「系統」、地區教育中心＝「中心」；回聲 app 一律說「回聲」。

## 2. 工作流程與指令
```bash
npm run ci          # 政策、機密掃描、型別、lint、測試、OpenAPI 一致性（開 PR 前必過）
npm run openapi     # 改了 /v1 路由後重新產生 openapi/hglobal-id.v1.json 並提交
```
- 從 `origin/main` 開分支；**不要從舊的本機分支開**（squash 合併後舊分支與 main 歷史不同，會衝突；曾因此多開了一個 PR）。
- 沙盒裡 `gh` 的 GraphQL 被擋：開 PR 用 `gh api repos/hglobal1985/id/pulls -f title=… -f head=… -f base=main -f body=…`，合併用 `gh api -X PUT repos/hglobal1985/id/pulls/<n>/merge -f merge_method=squash`，部署 production 用 `gh api -X POST repos/hglobal1985/id/actions/workflows/deploy.yml/dispatches -f ref=main -f 'inputs[environment]=production'`。staging 在 main 的 CI 通過後自動部署，要等它成功再 dispatch production。
- 合併後 Stop hook 常誤報「分支有未推送提交且無遠端分支」（遠端分支被合併後自動刪除）；先用 `git ls-remote origin <branch>` 確認，再把本機切回 `main`（`git checkout -B main origin/main`）即可。強制推送會被擋，不要用。
- 提交與 PR 描述要附系統提供的 Co-Authored-By／Claude-Session 與 Generated with 行；不要把模型名稱寫進 repo。
- 每輪完成後在 Issue #2 留一則：規劃／已寫程式／已測試／已部署／已上架。

## 3. 技術重點與已踩過的坑
- Cloudflare Workers + D1、Hono + `@hono/zod-openapi`、TypeScript、vitest（測試用 `node:sqlite` 模擬 D1，`test/helpers/d1.mjs`）。每支 `/v1` 路由用 `createRoute`；新資料表要加進 `test/tables.json`；migration 檔名連號 `NNNN_說明.sql`。
- **D1 的 BLOB 欄位在正式環境回傳「數字陣列」**，不能直接當回應內容（會是空的）；一律用 `src/lib/blob.ts` 的 `blobBytes()`。測試用的 D1 已改成同樣回傳陣列。
- 前台 CSP：`style-src 'self'`、`script-src 'self'`、`img-src 'self' https: data: blob:` → **不可用行內 style 屬性**；顏色與尺寸用 class，動態尺寸用 JS 的 `element.style.x = …`（CSSOM 允許）。前端 JS 寫在 `src/web/assets/*.ts` 的 `String.raw` 模板字串裡：不可出現反引號與 `${}`，不可用全形空白（lint），改完用 `node --check` 檢查產生的 JS。
- 九宮格有兩份實作必須同步：伺服器 `src/web/chart.ts` 與編輯頁 `src/web/assets/me.ts`（資料來自 `src/profile/astro.ts` 的 `lifeChartOf`）。
- 改 `src/apps/handoff.ts` 的串接指令文字：必須同時更新 `HANDOFF_VERSION`、`HANDOFF_UPDATED`，以及 `test/apps.test.ts` 裡的摘要（先把摘要改成 `"X"`，跑測試取得新摘要再填回）。顏色等規範以 `docs/design-standard.md` 為準，有測試對照樣式表；改了顏色要一起改文件。
- 用 Python 腳本批次改檔時，**切片位置要確認 a < b**（曾因順序反了把檔案內容複製了兩份）；改完立刻 `git diff --stat` 與 `npx tsc --noEmit`。
- Playwright 與 Chromium 已預裝；曾在暫存目錄寫過一個本機測試伺服器（用測試用 D1 播種會員與 Cookie）搭配 Playwright 截圖驗證 UI，這些檔案不在 repo 裡，需要時重寫即可。`__Host-` 開頭的 Cookie 要用 `domain` 加 `path` 的形式設定。

## 4. 已定案的產品規則（摘要，細節看 `docs/adr/0006–0019` 與程式）
- **會員與網址**：以 Google `sub` 辨識，絕不用信箱或姓名合併；會員編號可重複；公開網址＝國碼二碼緊接編號（如 `TW9475831`）。`/<編號>` 是純淨公開頁（無選單、無頁尾、無分享／編輯鈕、圖例不顯示）；自己的頁面 `/my/<編號>`；編輯頁 `/my/edit`；舊 `/me` 已移除。每頁底部右側「網站設計 杜杜龍」（純淨公開頁除外）。
- **搜尋引擎**：編輯頁勾選「是否同意讓搜尋引擎為你打知名度？」；預設 noindex，勾選後公開頁才 `index,follow`。
- **隱私文件**：隱私權政策與完整隱私說明合併為單一 `/privacy`（完整說明在 `#full`），只留一個連結。
- **審核規則**：系統選「寰宇」不需審核；只有「寰宇＋同時填了地區教育中心」時，**中心與獎銜**才需審核，且由**相同中心的審核員**審核（全部審核員都會收到站內通知；沒有同中心審核員時通知總部秘書與超級管理員）。審核紀錄標示審核人員名稱。資格 `hglobal_verified`：寰宇單獨通過，有中心者須中心通過。
- **職務與權限**（兩種設定）：職務（超級管理員、總部秘書、審核員、會長、課務、音控、票務、活動）帶預設權限，另可對個人額外開權限（`staff_grants`），權限＝動作＋範圍（自己中心／系統寰宇／全部）。「查詢會員」唯讀：任何職務看自己中心、會長看寰宇、本人**已審核**獎銜達鑽石級以上看全部、總部秘書與超級管理員看全部；只有總部秘書與超級管理員能改系統／中心／獎銜、停權、刪除。課務、音控、票務、活動目前只有基本查詢，**功能權限等業主決定**。指派職務與刪除會員不要求重新登入（登記 App 頁仍要求）。
- **會員編號**：24 小時最多自行修改 3 次，超級管理員不受限；Amway 欄位可隱藏，預設值見 `src/profile/visibility.ts`；生日欄位是年／月／日三個自訂下拉（月份「1 Jan」形式）。
- **九宮格**：數字 0–9（0 在第四欄最下列，只有 3-6-9-0 一種連線）；先天數黑圈、生日數黃圈、星座數紫圈、天賦數亮綠空心三角形（出現幾次畫幾個，間距同圈）、加總命數紅色空心正方形；全部細線 1.5、可重疊；主線實線、副線虛線（水藍 `#0ea5e9`）；有圈或有形狀的數字都算「標記」，三個都標記的橫／直／斜線才連線。圖例只給本人看。區塊標題「xxx生命靈數 x年x月x日」一行、字多縮小，生日隱藏時不露日期。
- **後台**：主選單直接列出所有選項（無「更多」、無會員中心／登出）；「詞庫」稱「關聯詞」；有「權限」豆豆圖頁（不列超管與總部秘書）；管理人員頁可搜尋會員後分兩段設定職務與額外權限。

## 5. 進行中與待辦
- **正在串接第一個 App：寰宇行動大學**（`app_id` 為 `learn`）。它的 AI 需要最新串接指令（後台複製，版本以後台為準，目前 `2026-11-12.9`）加 `docs/design-standard.md`；它要照「只補差異」更新。
- 待業主決定／批准：登記新 App 與編輯 App 登記頁是否也拿掉「10 分鐘內重新登入」；課務、音控、票務、活動各職務要做什麼；額外權限是否要加到期日；移除舊 `learn` 的 `oauth_clients` 與舊機密（需業主核准）；R2 是否啟用（需核准，頭像與圖示目前存 D1，上限 128 KB）；隱私文件 §4 的修改與 `starry-phd/id#2` 的指向留言由業主自己做。
- **平台資料標準（ADR 0021，串接指令 2026-11-12.10）**：webhook（`WEBHOOK_SIGNING_KEY` 要業主設定，沒設就不送）、聯絡查詢與服務金鑰、新 App 預設最小權限（`learn` 仍是舊制，等業主確認才收緊）、標準符合度回報；staging 已可測，**production 需業主確認**。
- **平台規範（業主 2026-11-12）**：所有新功能與規範一律先寫進串接指令包與更新檢查清單並升版（見 AGENTS.md「平台規範」）；行動大學是第一個驗收的 App；真實姓名 `legal_name` 已恢復（ADR 0020）；深色模式已上線。
- 業主評估後**否決**的建議：強制登出會員、查看會員登入裝置、刪除前先停權保護、稽核紀錄篩選（不需要做）。
- 付費、正式資料刪除或還原、Secrets、商店送審、新帳號：一律先問。

## 6. 給新對話的第一句提示（業主貼這段）
```
這個工作階段只處理 hglobal1985/id（寰宇 H-Global1985 中央會員系統）；starry-phd/id 只可唯讀參考。
請先讀 AGENTS.md、docs/session-handoff.md、docs/design-standard.md、docs/integration-guide.md，再讀交接 Issue hglobal1985/id#2 最新的幾則留言，然後等我的指示。
回覆一律中文、先講結果；回報分開標示 規劃／已寫程式／已測試／已部署／已上架。
```
