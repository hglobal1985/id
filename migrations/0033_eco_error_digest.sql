-- 錯誤回報週報（生態系統功能 error_digest，杜杜龍 2026-11-27）：各 App 前台錯誤回報的「統計」。
-- 只存 App、日期、錯誤種類、頁面（已去掉查詢字串與識別碼）、App 版本、次數；不存訊息內容、不存任何個資。
CREATE TABLE eco_error_counts (
  app_id TEXT NOT NULL,
  day TEXT NOT NULL,                          -- 台北日期 YYYY-MM-DD
  kind TEXT NOT NULL,
  page TEXT NOT NULL,
  app_version TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (app_id, day, kind, page, app_version)
);
-- 週報寄過的紀錄（一天一列）：排程每 5 分鐘醒一次，靠這張表確保同一週只寄一次。
CREATE TABLE eco_digest_runs (
  run_date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
