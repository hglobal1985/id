# 0039 生態系統功能（杜杜龍 2026-11-27）

## 決定
- 四項系統功能（套件漏洞提醒、網站自動巡檢、錯誤回報週報、重要資料每週備份）由中央統一設定，所有現在與未來的 App 一體適用。
- 設定存中央：`eco_features`（每個功能一列 JSON 設定，沒有列＝程式內預設值）、`eco_feature_apps`（某 App 不參與的覆寫與最近結果，沒有列＝參與）。
- App 透過既有的 `GET /v1/apps/{app_id}/config` 的 `config.eco_features` 取得自己的設定；只含是否參與與少數公開欄位，不含通知對象與網址清單。
- 後台新增「系統功能」頁；`apps.operate` 可看、`apps.manage` 可改；每次修改寫稽核（不含設定內容）。
- 巡檢網址只允許 hglobal1985.com 的 https，避免中央被當成任意網址的探測器。
- 設定壞掉時退回預設值（fail safe）。

## 後續（各自一個 PR）
1. Dependabot（三個程式庫）　2. 網站巡檢　3. 錯誤回報週報　4. 每週備份。（第 5 項截圖測試已永久刪除。）

## 實作紀錄
- 2026-11-27 Dependabot：兩個程式庫各加 `.github/dependabot.yml`。
- 2026-11-28 網站巡檢：`src/jobs/uptime.ts`、`src/platform/uptime.ts`、`eco_uptime_state`（migration 0032）；只在正式環境巡檢；Email 走 `send_email` 綁定（借用 learn 網域的寄件人）。
- 2026-11-28 錯誤回報週報：`POST /v1/apps/{app_id}/error-reports`（不用登入，依 App 與連線來源限流）收 `{kind, page, app_version, count}` 統計，存在 `eco_error_counts`（migration 0033，每天每個 App 最多 200 種組合，保留 35 天）；`src/jobs/error-digest.ts` 在設定的星期、台北 09:00 彙整最近 7 天，站內通知（kind `eco.error_digest`）＋Email 給超級管理員，沒有錯誤就不寄；`eco_digest_runs` 確保一天只寄一次。只在正式環境執行。串接指令升 2026-11-27.4（三、18 (3)、檢查清單 43）。
- 2026-11-28 每週備份（串接指令 2026-11-27.5）：中央在設定的星期（預設星期日）台北 03:00 把自己的永久資料匯出到 R2（`backups/<日期>/`，每表 NDJSON 分檔、README.txt 還原說明、最後寫 manifest.json），只留最近 `keep` 份（預設 8）；只備份明確列出的資料表與欄位（`src/platform/backup.ts`，新資料表預設不備份），不含 Amway、Token 與雜湊、登入與暫存資料、圖檔本體；失敗時回寫設定頁「最近結果」並通知超級管理員。`eco_backup_runs` 確保一天只備份一次。各 App 備份自己的資料（同格式，寫在串接指令）。**尚未做**：後台還原按鈕（還原須杜杜龍核准，先靠 README 手動步驟）。
- 2026-11-28 截圖測試：杜杜龍指示**永久刪除**（串接指令升 2026-11-27.7；功能目錄、串接指令、行動大學的 workflow 與腳本全部移除）。不要加回來。
- 2026-11-28 巡檢手機推播（串接指令 2026-11-27.8）：中央沒有手機推播能力，改用既有 webhook 機制送新事件 `eco.alert`（每位超級管理員一則、不含個資），由各 App 自己推給該管理員的裝置；由行動大學先做。收件人＝超級管理員本人（不靠 App 的角色對應）；沒設 webhook 的 App 收不到，站內通知與 Email 照常。
- 2026-11-28 全體平台共用金鑰（串接指令 2026-11-28.1，三、19）：App 之間的內部橋接用同一組金鑰 APP_BRIDGE_SECRET，由中央「平台設定」頁產生並顯示，所有 App（含未來新接入的）相同；由金鑰與版本推導、不存資料庫。
