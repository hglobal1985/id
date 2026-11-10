-- Shared sign-in (single sign-on) across H-Global1985 Apps (ADR 0012).
-- One row per device (or browser) where a member signed in. Apps on the same device share the token through
-- shared storage (iOS keychain group); web versions share it through a cookie on the central member site.
-- Only hashes are stored.

CREATE TABLE device_sso (
  id              TEXT PRIMARY KEY,
  member_id       TEXT NOT NULL REFERENCES members(id),
  token_hash      TEXT NOT NULL,          -- the sso_token Apps keep in shared storage
  cookie_hash     TEXT,                   -- the browser cookie on the central site (web versions), set by /auth/sso/adopt
  last_used_epoch INTEGER NOT NULL,
  expires_epoch   INTEGER NOT NULL,       -- 30 days after the last use
  revoked_epoch   INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_device_sso_member ON device_sso (member_id);

-- App sessions created from (or joined to) a shared sign-in; ending the shared sign-in ends them all.
ALTER TABLE app_sessions ADD COLUMN sso_id TEXT;
CREATE INDEX idx_app_sessions_sso ON app_sessions (sso_id);

-- Single-use, 2-minute codes for the web flow. kind 'adopt': lets the central site remember the browser.
-- kind 'check': lets one App (bound to app_id and to a nonce only that App instance knows) sign in.
CREATE TABLE sso_codes (
  code_hash     TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('adopt','check')),
  sso_id        TEXT NOT NULL,
  app_id        TEXT,
  nonce_hash    TEXT,
  expires_epoch INTEGER NOT NULL,
  used_epoch    INTEGER,
  created_at    TEXT NOT NULL
);
