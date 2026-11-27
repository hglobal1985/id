# 0039 生態系統功能（杜杜龍 2026-11-27）

## 決定
- 五項系統功能（套件漏洞提醒、網站自動巡檢、錯誤回報週報、重要資料每週備份、主要畫面自動截圖測試）由中央統一設定，所有現在與未來的 App 一體適用。
- 設定存中央：`eco_features`（每個功能一列 JSON 設定，沒有列＝程式內預設值）、`eco_feature_apps`（某 App 不參與的覆寫與最近結果，沒有列＝參與）。
- App 透過既有的 `GET /v1/apps/{app_id}/config` 的 `config.eco_features` 取得自己的設定；只含是否參與與少數公開欄位，不含通知對象與網址清單。
- 後台新增「系統功能」頁；`apps.operate` 可看、`apps.manage` 可改；每次修改寫稽核（不含設定內容）。
- 巡檢網址只允許 hglobal1985.com 的 https，避免中央被當成任意網址的探測器。
- 設定壞掉時退回預設值（fail safe）。

## 後續（各自一個 PR）
1. Dependabot（三個程式庫）　2. 網站巡檢　3. 錯誤回報週報　4. 每週備份　5. 截圖測試。

## 實作紀錄
- 2026-11-27 Dependabot：兩個程式庫各加 `.github/dependabot.yml`。
- 2026-11-28 網站巡檢：`src/jobs/uptime.ts`、`src/platform/uptime.ts`、`eco_uptime_state`（migration 0032）；只在正式環境巡檢；Email 走 `send_email` 綁定（借用 learn 網域的寄件人）。
