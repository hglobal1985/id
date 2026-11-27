-- 每週備份（生態系統功能 weekly_backup，杜杜龍 2026-11-27）：備份做過的紀錄（一天一列）。
-- 排程每 5 分鐘醒一次，靠這張表確保同一天只備份一次。備份檔本身在 R2（backups/日期/），不在資料庫。
CREATE TABLE eco_backup_runs (
  run_date TEXT PRIMARY KEY,
  started_at TEXT NOT NULL
);
