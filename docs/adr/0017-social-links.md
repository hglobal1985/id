# ADR 0017：社群連結（名片上的圖示列）

狀態：已採用（2026-11-11，業主指示）。

## 決定
- **取代「社群連結／個人網站」欄位**：每個會員有一串社群連結（最多 30 個），每個連結 = 平台＋ https 網址（＋「自定義」可填名稱與自己的小圖示）。同一平台可重複新增。原本的單一網址欄位由 migration 0018 轉成一個「自定義」連結後刪除。
- **顯示**：名片（公開頁與編輯頁頁首）照片下方一列、置中；每列 5 個圖示，圖示總數超過兩排（編輯頁連同「＋」算，超過 10）時縮小成每列 7 個。每個圖示下方有「複製」小標籤（複製網址，顯示「已複製」），點圖示在新視窗開啟（`target=_blank rel="noopener noreferrer nofollow"`）。編輯頁最後有「＋」圖示，下方「新增社群」；按下後選平台（自訂下拉、可搜尋）＋貼網址，「自定義」可另填名稱並上傳圖示；每個圖示右上有 × 可移除。
- **平台**（`social_platforms`，超級管理員在後台「社群平台」管理：新增、改名、排序、換圖示、還原預設圖示、刪除）：安麗分享購、安麗iShare、LINE、脆 Threads、Dcard、IG、臉書 Facebook、YouTube、Spotify、微信 WeChat、電報 Telegram、WhatsApp、抖音、小紅書、X、Discord、Google Maps、自定義（最後；不能刪除）。刪除平台時，已建立的連結保留並改用通用連結圖示。
- **圖示**：預設圖示放在程式碼裡（`src/social/icons.ts`）：兩個 Amway 圖示（黑色 A、紅心 i）使用業主提供的圖片（縮成 96 px PNG），其餘是我依各品牌標誌畫的簡化 SVG（近似，非官方檔案，可在後台直接換成官方圖）。後台換圖示與會員的自定義圖示一律是小型點陣圖（PNG／JPEG／WebP，以位元組判斷，不收 SVG）：頁面先自動縮小（平台 96 px／上限 32 KB，會員 64 px／上限 16 KB）。圖示一律以圖片單獨提供（`/icons/social/platform/<key>?v=`、`/icons/social/link/<id>`，`nosniff` 與沙盒 CSP）。
- **存放位置**：業主要求「存到 R2」，但 R2 尚未啟用（AGENTS.md 第 3 節：需要業主核准並建立新的雲端資源），所以暫時和頭像一樣存在 D1（每個圖示最多 16～32 KB）；日後啟用 R2 可改存過去，網址不變。
- **API**：`GET /v1/social/platforms`、`GET/POST /v1/me/social-links`、`PUT /v1/me/social-links/{id}/icon`、`DELETE /v1/me/social-links/{id}`；後台 `/v1/admin/social-platforms*`（`social.manage`，只有超級管理員）。資料匯出含社群連結；刪除帳號會刪除連結與圖示。
- 同時修正：頁面縮圖用 canvas 需要 `blob:` 圖片來源，內容安全政策補上 `img-src ... blob:`（之前頭像上傳在瀏覽器被擋住）。
