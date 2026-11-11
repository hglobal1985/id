-- Round 12 (ADR 0020): more staff positions, center-scoped review, and 寰宇 flagged again.

-- 1. Positions: 審核員 reviewer, 總部秘書 secretary, plus 會長 president, 課務 course, 音控 sound, 票務 ticket, 活動 activity.
CREATE TABLE staff_roles_new (
  member_id  TEXT NOT NULL REFERENCES members(id),
  role       TEXT NOT NULL CHECK (role IN ('super_admin','secretary','reviewer','president','course','sound','ticket','activity')),
  granted_at TEXT NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (member_id, role)
);
INSERT INTO staff_roles_new (member_id, role, granted_at, granted_by) SELECT member_id, role, granted_at, granted_by FROM staff_roles;
DROP TABLE staff_roles;
ALTER TABLE staff_roles_new RENAME TO staff_roles;
CREATE INDEX idx_staff_roles_role ON staff_roles (role);

-- 2. Review requests remember the (normalized) regional center they belong to: only reviewers of that center are told and may decide.
ALTER TABLE amway_review_requests ADD COLUMN center_norm TEXT;

-- 3. 寰宇 is flagged as the training system that is reviewed again (owner decision 2026-11-11). Only a member who is 寰宇
--    AND names a regional center is reviewed (center and rank); choosing 寰宇 alone passes at once.
UPDATE vocab_terms SET hglobal = 1 WHERE pool = 'education_system' AND norm = '寰宇';
