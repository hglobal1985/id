-- 生態系統功能（杜杜龍 2026-11-27）：中央存各項系統功能的設定，與每個 App 是否參與。
-- eco_features：每個功能一列的全域設定（JSON：開關、頻率、通知對象…；不放機密）。沒有列＝用程式內預設值。
CREATE TABLE eco_features (
  feature_key TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
-- eco_feature_apps：某個 App 對某個功能的「不參與」覆寫與最近一次的執行結果。沒有列＝參與（預設）。
CREATE TABLE eco_feature_apps (
  feature_key TEXT NOT NULL,
  app_id TEXT NOT NULL,
  participating INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  last_checked_at TEXT,
  last_note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (feature_key, app_id)
);
