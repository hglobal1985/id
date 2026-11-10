-- Member numbers (= Amway member numbers), spouse binding, and in-site notifications.
-- Member numbers are intentionally NOT unique: a duplicate is how spouses are detected.

CREATE TABLE member_numbers (
  member_id  TEXT NOT NULL REFERENCES members(id),
  position   INTEGER NOT NULL,                 -- 0 = default (public URL and support id)
  country    TEXT NOT NULL,                    -- ISO 3166-1 alpha-2
  number     TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, position)
);
CREATE INDEX idx_member_numbers_lookup ON member_numbers (country, number);
CREATE INDEX idx_member_numbers_number ON member_numbers (number);

-- "我是Amway會員" switch (the Amway area API arrives in PR 5). Enables up to 50 numbers.
ALTER TABLE members ADD COLUMN amway_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE spouse_bindings (
  id           TEXT PRIMARY KEY,
  initiator_id TEXT NOT NULL REFERENCES members(id),   -- who bound
  partner_id   TEXT NOT NULL REFERENCES members(id),   -- who was bound (single-sided consent)
  created_at   TEXT NOT NULL,
  ended_at     TEXT,
  ended_by     TEXT REFERENCES members(id)
);
CREATE INDEX idx_spouse_bindings_initiator ON spouse_bindings (initiator_id);
CREATE INDEX idx_spouse_bindings_partner ON spouse_bindings (partner_id);

-- One row per member in an active binding; the primary key enforces "at most one spouse".
CREATE TABLE spouse_members (
  member_id  TEXT PRIMARY KEY REFERENCES members(id),
  binding_id TEXT NOT NULL REFERENCES spouse_bindings(id)
);

-- Short-lived opaque ids handed out with duplicate_candidate, so apps never see other members' ids.
CREATE TABLE spouse_candidates (
  token_hash          TEXT PRIMARY KEY,
  member_id           TEXT NOT NULL REFERENCES members(id),
  candidate_member_id TEXT NOT NULL REFERENCES members(id),
  expires_epoch       INTEGER NOT NULL
);
CREATE INDEX idx_spouse_candidates_member ON spouse_candidates (member_id);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,                 -- UUIDv7
  member_id  TEXT NOT NULL REFERENCES members(id),
  kind       TEXT NOT NULL,                    -- e.g. 'spouse.bound'
  payload    TEXT,                             -- small JSON of ids only; text is rendered when shown
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX idx_notifications_member ON notifications (member_id, created_at);
