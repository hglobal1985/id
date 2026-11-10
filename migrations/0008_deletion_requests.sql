-- Data deletion requests: the member confirms after a fresh sign-in; an administrator executes within 15 days.
CREATE TABLE deletion_requests (
  id           TEXT PRIMARY KEY,           -- UUIDv7
  member_id    TEXT NOT NULL REFERENCES members(id),
  scope        TEXT NOT NULL CHECK (scope IN ('amway','account')),
  status       TEXT NOT NULL CHECK (status IN ('requested','completed','cancelled')),
  requested_at TEXT NOT NULL,
  due_at       TEXT NOT NULL,              -- requested_at + 15 days
  completed_at TEXT,
  completed_by TEXT,                       -- staff member id
  cancelled_at TEXT
);
CREATE INDEX idx_deletion_requests_status ON deletion_requests (status, due_at);
CREATE INDEX idx_deletion_requests_member ON deletion_requests (member_id);
