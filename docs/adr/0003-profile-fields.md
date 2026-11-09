# ADR 0003：基本資料欄位 API

狀態：已採用（2026-11-10，PR 3）

## 決定
- API（串接指令包 4A／4C）：`GET /v1/profile/field-definitions`、`GET /v1/me/profile`、`PUT /v1/me/profile/fields/{field_key}`、`PUT /v1/me/profile/visibility`、`POST /v1/me/profile/avatar`、`POST /v1/me/profile/avatar/google`、`DELETE /v1/me/profile/avatar`。
- 欄位定義集中在 `src/profile/definitions.ts`（不依賴框架、附單元測試）。資料表只存「會員 × 欄位」的值，新增欄位不需要 migration。
- 每個欄位各自驗證、各自 scope（basic／contact／birthday），稽核記錄只記「哪個 app、哪一欄、什麼時候」，不記值。重送相同值不產生新紀錄（冪等）。
- `value: null`（或空字串、空清單）= 清除欄位；`display_name` 不可清除。未設定 `display_name` 時沿用註冊時的 Google 名稱。
- 信箱、手機只做格式檢查，立即生效，不寄驗證碼、不通知舊信箱。
- 頭像永遠公開；上傳與「使用 Google 頭像」回 501 `not_available`（儲存空間未啟用）；「移除頭像」正常。新會員預設沒有頭像。
- 唯讀資訊：會員識別碼（預設收合）、註冊國家、帳號狀態、星座、生命靈數（由生日推算）。

## 預設值（之後可調整，不影響 API）
- 公開設定預設：基本資料類公開；本名、介面語言、聯絡與地區、生日不公開。
- 生命靈數：生日 8 位數字相加，化簡到 1–9，保留 11、22、33。
- 會員編號（`member_number`）與夫妻綁定在 PR 4；Amway 欄位在 PR 5。
