-- 網站自動巡檢（生態系統功能 uptime_watch）：每個被巡檢網址目前的狀態。只存網址、名稱、狀態與時間，不存內容。
CREATE TABLE eco_uptime_state (
  url TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,                       -- up | down
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT NOT NULL,
  last_checked_epoch INTEGER NOT NULL,
  last_change_at TEXT NOT NULL,
  last_note TEXT
);
