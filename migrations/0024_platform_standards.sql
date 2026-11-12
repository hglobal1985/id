-- Platform standards for every App (ADR 0021): change/deletion webhooks, App-to-App restricted contact lookup,
-- and the standards each App reports.

-- One webhook endpoint per App. The signing secret is never stored: it is derived from the Worker secret
-- WEBHOOK_SIGNING_KEY, the app_id and secret_version (rotating bumps the version and shows the new secret once).
CREATE TABLE app_webhooks (
  app_id         TEXT PRIMARY KEY,
  url            TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT
);

-- Outbox of events: at-least-once delivery. The body carries the member id and field NAMES only, never values.
CREATE TABLE webhook_events (
  id                 TEXT PRIMARY KEY,
  app_id             TEXT NOT NULL,
  member_id          TEXT NOT NULL,
  type               TEXT NOT NULL,
  fields             TEXT,
  created_at         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_epoch INTEGER NOT NULL,
  last_attempt_at    TEXT,
  last_http_status   INTEGER,
  last_error         TEXT,
  delivered_at       TEXT,
  purge_epoch        INTEGER NOT NULL
);
CREATE INDEX idx_webhook_due ON webhook_events (status, next_attempt_epoch);
CREATE INDEX idx_webhook_app ON webhook_events (app_id, created_at);

-- One service credential per App (client credentials). Only the hash of the secret is stored.
CREATE TABLE app_service_credentials (
  app_id       TEXT PRIMARY KEY,
  secret_hash  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  last_used_at TEXT
);

-- The standards an App reported (JSON array of keys) together with its integration version.
ALTER TABLE app_handoff_reports ADD COLUMN standards TEXT;
