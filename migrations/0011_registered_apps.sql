-- App registry and App sign-in (ADR 0011). Every App is registered here by the super admin in the back office;
-- nothing about an App lives in the code. Apps are never deleted: a retired App is set to `killed`.

CREATE TABLE registered_apps (
  app_id      TEXT PRIMARY KEY,
  definition  TEXT NOT NULL,              -- JSON, validated by parseApp on every write and every read
  created_at  TEXT NOT NULL,
  created_by  TEXT,                       -- member id of the super admin; NULL when seeded by a migration
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

-- Runtime switch (active / paused / killed) set from the back office; reaches every location within 30 seconds.
CREATE TABLE app_status_overrides (
  app_id      TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('active','paused','killed')),
  reason      TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

-- The integration-instruction version each App last reported it was built to.
CREATE TABLE app_handoff_reports (
  app_id             TEXT PRIMARY KEY,
  integrated_version TEXT NOT NULL,
  reported_at        TEXT NOT NULL,
  reported_by        TEXT
);

-- Single-use sign-in nonces (10 minutes, bound to one App). Only the hash is stored.
CREATE TABLE app_nonces (
  nonce_hash     TEXT PRIMARY KEY,
  app_id         TEXT NOT NULL,
  expires_epoch  INTEGER NOT NULL,
  consumed_epoch INTEGER,
  created_at     TEXT NOT NULL
);

-- One row per App sign-in. Refresh tokens are "<id>.<secret>"; only hashes are stored. The previous hash is kept
-- so a replayed (already rotated) refresh token is detected and the whole session is revoked.
CREATE TABLE app_sessions (
  id                    TEXT PRIMARY KEY,
  member_id             TEXT NOT NULL REFERENCES members(id),
  app_id                TEXT NOT NULL,
  refresh_hash          TEXT NOT NULL,
  previous_refresh_hash TEXT,
  scope                 TEXT NOT NULL,
  device_label          TEXT,
  auth_time_epoch       INTEGER NOT NULL,
  last_used_epoch       INTEGER NOT NULL,
  expires_epoch         INTEGER NOT NULL,
  revoked_epoch         INTEGER,
  revoke_reason         TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_app_sessions_member ON app_sessions (member_id);
CREATE INDEX idx_app_sessions_app ON app_sessions (app_id);

-- Which members have signed in to which App (for the App list statistics).
CREATE TABLE member_apps (
  member_id     TEXT NOT NULL REFERENCES members(id),
  app_id        TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  PRIMARY KEY (member_id, app_id)
);

-- First App: 寰宇行動大學 (app_id learn). Same values the back-office form derives from the app_id.
INSERT OR IGNORE INTO registered_apps (app_id, definition, created_at, updated_at) VALUES (
  'learn',
  '{"app_id":"learn","name":"寰宇行動大學","ios_bundle_id":"com.hglobal1985.learn","android_package":"com.hglobal1985.learn","status":"active","scopes":["profile.read","amway.read"],"min_version":"0.0.0","config":{},"auth":{"google_audiences":[]},"web_origins":["https://learn.hglobal1985.com"],"return_urls":["learn://auth/google"]}',
  '2026-11-10T18:00:00.000+08:00',
  '2026-11-10T18:00:00.000+08:00'
);
