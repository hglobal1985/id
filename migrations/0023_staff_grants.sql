-- Round 23 (ADR 0020): permissions are separate from positions. A position (職務, staff_roles) carries default permissions;
-- staff_grants are the extra permissions given to one person on top (with a scope: own center / 寰宇 / everyone).
CREATE TABLE staff_grants (
  member_id  TEXT NOT NULL REFERENCES members(id),
  permission TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('center','hglobal','all')),
  granted_at TEXT NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (member_id, permission, scope)
);
CREATE INDEX idx_staff_grants_member ON staff_grants (member_id);
