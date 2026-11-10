-- Amway area: options, field values with review state, review queue, consent records.
-- Amway values live only here (H-Global1985 system); other systems keep links, never copies.

-- Option lists maintained by administrators. Only `education_system` hglobal/other are structural.
CREATE TABLE amway_options (
  field_key  TEXT NOT NULL,
  value      TEXT NOT NULL,                -- stable code apps store (e.g. rank codes for min_rank)
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL,             -- for rank: ladder order, low to high
  active     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (field_key, value)
);
INSERT INTO amway_options (field_key, value, label, sort_order) VALUES ('education_system', 'hglobal', 'H-Global1985', 10);

CREATE TABLE amway_field_values (
  member_id     TEXT NOT NULL REFERENCES members(id),
  field_key     TEXT NOT NULL,
  value         TEXT,                      -- JSON; the effective value (NULL = none)
  pending_value TEXT,                      -- JSON; awaiting review (not effective)
  status        TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','not_required')),
  updated_at    TEXT NOT NULL,
  reviewed_at   TEXT,
  reviewed_by   TEXT,                      -- staff id
  PRIMARY KEY (member_id, field_key)
);

CREATE TABLE amway_review_requests (
  id              TEXT PRIMARY KEY,        -- UUIDv7
  member_id       TEXT NOT NULL REFERENCES members(id),
  field_key       TEXT NOT NULL,
  requested_value TEXT NOT NULL,           -- JSON
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','superseded')),
  created_at      TEXT NOT NULL,
  decided_at      TEXT,
  decided_by      TEXT,
  app_id          TEXT
);
CREATE INDEX idx_amway_review_requests_status ON amway_review_requests (status, created_at);
CREATE INDEX idx_amway_review_requests_member ON amway_review_requests (member_id, field_key);

-- Append-only consent log (version and time of every acceptance and withdrawal).
CREATE TABLE consent_records (
  id          TEXT PRIMARY KEY,            -- UUIDv7
  member_id   TEXT NOT NULL REFERENCES members(id),
  document    TEXT NOT NULL,               -- e.g. 'amway_data_sharing'
  version     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('accept','withdraw')),
  occurred_at TEXT NOT NULL,
  app_id      TEXT
);
CREATE INDEX idx_consent_records_member ON consent_records (member_id, document, occurred_at);
