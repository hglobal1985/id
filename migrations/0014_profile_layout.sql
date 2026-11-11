-- Order of the profile fields on every member's page, set by the super admin (ADR 0014). A missing row means the
-- built-in order. `sort_order` is compared inside one group (basic, contact, amway) only.
CREATE TABLE profile_layout (
  field_key  TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
