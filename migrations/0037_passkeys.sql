-- Passkey（WebAuthn）取代後台危險操作的「重新登入 Google」（杜杜龍 2026-11-28）：
-- 管理員第一次先建立 passkey；之後做危險操作只要用指紋／臉部／手機解鎖確認，10 分鐘內有效。
-- 只存公鑰與計數器（沒有任何秘密）；挑戰碼單次使用、5 分鐘過期。
ALTER TABLE login_sessions ADD COLUMN stepup_epoch INTEGER;  -- 這個登入階段最後一次用 passkey 確認的時間

CREATE TABLE passkeys (
  id            TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES members(id),
  credential_id TEXT NOT NULL UNIQUE,   -- base64url
  public_key    TEXT NOT NULL,          -- SPKI DER，base64url
  alg           INTEGER NOT NULL,       -- COSE：-7（ES256）或 -257（RS256）
  sign_count    INTEGER NOT NULL DEFAULT 0,
  name          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX idx_passkeys_member ON passkeys (member_id);

CREATE TABLE passkey_challenges (
  challenge    TEXT PRIMARY KEY,        -- base64url，單次使用
  member_id    TEXT NOT NULL,
  purpose      TEXT NOT NULL,           -- register／authenticate
  expires_epoch INTEGER NOT NULL
);
