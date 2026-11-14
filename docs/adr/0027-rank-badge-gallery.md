# ADR 0027：獎銜徽章圖庫放在中央

日期：2026-11-15。狀態：程式已寫並測試；部署後要實測。來源：行動大學 repo `docs/central-request-rank-badges.md`（業主已決定：以後所有寰宇 App 讀同一套徽章圖庫，圖庫放中央）。

## 決定
- 24 張徽章圖（PNG、380×720、透明背景）放在中央的 R2（正式 `hglobal-id-files`、測試 `hglobal-id-files-staging`），鍵 `badges/<獎銜代碼>.png`，用獎銜代碼命名（不是原本的編號）。來源是行動大學 R2 bucket `learn` 的 `Pin-Level/`（只讀，未改動）。
- **公開網址**：`https://<中央網址>/badges/<獎銜代碼>.png?v=<版本>`，由 Worker 從 R2 讀出，`image/png`、`cache-control: public, max-age=31536000, immutable`、`access-control-allow-origin: *`、`nosniff`。圖片更新時版本號加一，網址跟著換，快取不會拿到舊圖。
- **索引表 `rank_badges`**（migration 0028）：獎銜代碼、版本、畫布寬高（380×720）、圖案上下緣（`art_top`、`art_bottom`）。沒有資料列＝沒有徽章。目前 24 筆，其餘 9 個獎銜（none、r03、r06、r09、r12、r12a、r15、r18、r21）沒有。圖案範圍採用行動大學文件的數值（用透明度重算過，相差 1 像素內）。
- **API**：`GET /v1/amway/field-definitions` 裡 `rank` 的每個選項新增 `badge_url`（公開絕對網址或 `null`）與 `badge`（`{width, height, art_top, art_bottom}` 或 `null`）。只新增欄位，`value`、`label`、順序不變；其他欄位的選項不動。
- **後台「獎銜徽章」**（權限 `badges.manage`，超級管理員）：列出所有獎銜與預覽，可上傳、更換、移除。上傳時瀏覽器用透明度量出圖案上下緣一起送出；伺服器檢查是 PNG、380×720、不超過 256 KB，再寫入 R2 並把版本加一。以後新增獎銜（用 migration 加選項）後，在這裡替它上傳徽章即可；沒上傳就是沒有徽章。
- **串接指令**新增三、13「獎銜徽章顯示標準」與檢查清單 25（版本 2026-11-15.2）：位置、顯示高度 92、只佔頭像高度 48、呼吸 1.1 倍／2.6 秒、4 顆星形閃光球參數、減少動態效果、沒有徽章或載入失敗就不顯示。App 只讀 `badge_url`，不存圖庫。
- 圖片不含任何會員資料；會員的獎銜仍只由會員自己的資料決定。

## 搬移紀錄（2026-11-15）
- 24 張逐張驗證：PNG、380×720；寫入兩個 bucket 後核對大小與 content-type 全部相符。
- 行動大學現有的徽章功能與來源（`learn` bucket 的 `Pin-Level/`）沒有動；等行動大學改讀 `badge_url` 並驗收後，由行動大學自己刪除。

## 之後
- 若要快取到邊緣（減少 Worker 與 R2 讀取），可加 Cache API；目前流量很小，不做。
