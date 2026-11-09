-- Profile field values and visibility. One row per (member, field); field rules live in code
-- (src/profile/definitions.ts), so new fields need no migration.
CREATE TABLE profile_field_values (
  member_id      TEXT NOT NULL REFERENCES members(id),
  field_key      TEXT NOT NULL,
  value          TEXT NOT NULL,                 -- JSON (string or array of strings)
  updated_at     TEXT NOT NULL,                 -- ISO 8601, +08:00
  updated_by_app TEXT,                          -- client_id of the app that wrote it; NULL = this site
  PRIMARY KEY (member_id, field_key)
);

-- Only explicit choices are stored; otherwise the field definition's default applies.
CREATE TABLE profile_visibility (
  member_id  TEXT NOT NULL REFERENCES members(id),
  field_key  TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','private')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, field_key)
);

-- Avatar shown to everyone (always public). NULL = no avatar. Uploads are not available until storage is enabled.
ALTER TABLE members ADD COLUMN avatar_url TEXT;
ALTER TABLE members ADD COLUMN avatar_source TEXT NOT NULL DEFAULT 'none' CHECK (avatar_source IN ('none','google','upload'));
