-- Audit log: who did what to whom. Never store tokens, secrets or raw personal data.
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,            -- UUIDv7
  occurred_at TEXT NOT NULL,               -- ISO 8601, +08:00
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('member','staff','system','app')),
  actor_id    TEXT,                        -- member id / staff id / app id (opaque)
  action      TEXT NOT NULL,               -- e.g. 'profile.field.update'
  target_type TEXT,
  target_id   TEXT,
  result      TEXT NOT NULL CHECK (result IN ('success','denied','error')),
  app_id      TEXT,
  request_id  TEXT,
  detail      TEXT                         -- small JSON with non-sensitive context only
);
CREATE INDEX idx_audit_log_occurred_at ON audit_log (occurred_at);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_type, actor_id);
CREATE INDEX idx_audit_log_target ON audit_log (target_type, target_id);
