-- Core identity tables: members, sign-in sessions, OIDC clients, codes and refresh tokens.
-- Rules: members are identified only by Google `sub` (never merged by email or name).
-- Secrets (session tokens, codes, refresh tokens, client secrets) are stored only as SHA-256 hashes.
-- All timestamps are ISO 8601 strings with the Taipei offset (+08:00); *_epoch columns are Unix seconds for comparisons.

CREATE TABLE members (
  id                   TEXT PRIMARY KEY,                 -- member id (UUIDv7), the OIDC `sub`
  google_sub           TEXT NOT NULL UNIQUE,             -- Google account subject; the only auto-binding key
  google_email         TEXT,                             -- as reported by Google; never used to match members
  google_email_verified INTEGER NOT NULL DEFAULT 0,
  google_picture_url   TEXT,
  display_name         TEXT,
  registration_country TEXT NOT NULL DEFAULT 'TW',       -- ISO 3166-1 alpha-2 from the sign-up IP; read-only
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  last_login_at        TEXT
);

-- Browser sign-in sessions at id.hglobal1985.com (cookie holds the raw token; DB holds its hash).
CREATE TABLE login_sessions (
  id              TEXT PRIMARY KEY,                      -- session id, exposed as the OIDC `sid`
  token_hash      TEXT NOT NULL UNIQUE,
  member_id       TEXT NOT NULL REFERENCES members(id),
  auth_time_epoch INTEGER NOT NULL,                      -- last interactive Google sign-in
  expires_epoch   INTEGER NOT NULL,
  revoked_epoch   INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_login_sessions_member ON login_sessions (member_id);

-- One pending Google sign-in (state / nonce / PKCE verifier), bound to the browser by a cookie.
CREATE TABLE login_flows (
  id               TEXT PRIMARY KEY,
  browser_hash     TEXT NOT NULL,                        -- hash of the flow cookie value
  state_hash       TEXT UNIQUE,                          -- hash of the Google `state`, set when sign-in starts
  nonce            TEXT,
  code_verifier    TEXT,
  return_to        TEXT NOT NULL,                        -- same-origin path to resume (e.g. /oauth/authorize?...)
  expires_epoch    INTEGER NOT NULL,
  used_epoch       INTEGER,
  created_at       TEXT NOT NULL
);

-- Registered apps (relying parties). Registered by an administrator; no dynamic registration.
CREATE TABLE oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  client_secret_hash         TEXT,                       -- NULL for public clients (auth method 'none')
  token_endpoint_auth_method TEXT NOT NULL CHECK (token_endpoint_auth_method IN ('none','client_secret_basic','client_secret_post')),
  redirect_uris              TEXT NOT NULL,              -- JSON array of exact https URLs (no wildcards)
  post_logout_redirect_uris  TEXT NOT NULL DEFAULT '[]', -- JSON array of exact https URLs
  allowed_scopes             TEXT NOT NULL,              -- space-separated
  status                     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);

CREATE TABLE oauth_authorization_codes (
  code_hash             TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES oauth_clients(client_id),
  member_id             TEXT NOT NULL REFERENCES members(id),
  session_id            TEXT NOT NULL REFERENCES login_sessions(id),
  redirect_uri          TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,                   -- S256 only
  nonce                 TEXT,
  auth_time_epoch       INTEGER NOT NULL,
  expires_epoch         INTEGER NOT NULL,
  used_epoch            INTEGER,
  created_at            TEXT NOT NULL
);

-- Rotating refresh tokens. Re-use of a rotated token revokes the whole family.
CREATE TABLE oauth_refresh_tokens (
  token_hash      TEXT PRIMARY KEY,
  family_id       TEXT NOT NULL,
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id),
  member_id       TEXT NOT NULL REFERENCES members(id),
  session_id      TEXT NOT NULL REFERENCES login_sessions(id),
  scope           TEXT NOT NULL,
  auth_time_epoch INTEGER NOT NULL,
  expires_epoch   INTEGER NOT NULL,
  rotated_epoch   INTEGER,
  revoked_epoch   INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_oauth_refresh_tokens_family ON oauth_refresh_tokens (family_id);
CREATE INDEX idx_oauth_refresh_tokens_session ON oauth_refresh_tokens (session_id);
