-- 全體平台共用金鑰的版本（杜杜龍 2026-11-28）：金鑰本身不存資料庫，由 WEBHOOK_SIGNING_KEY 與版本推導；
-- 按「重新產生」只是把版本加一，所有 App（含未來新接入的）顯示的都是同一組。
CREATE TABLE platform_secrets (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
