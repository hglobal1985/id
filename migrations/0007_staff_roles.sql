-- Staff roles (super_admin, secretary, reviewer). Staff are members; a member may hold several roles.
CREATE TABLE staff_roles (
  member_id  TEXT NOT NULL REFERENCES members(id),
  role       TEXT NOT NULL CHECK (role IN ('super_admin','secretary','reviewer')),
  granted_at TEXT NOT NULL,
  granted_by TEXT,                         -- member id of the granting super admin; NULL = bootstrap by the owner
  PRIMARY KEY (member_id, role)
);
CREATE INDEX idx_staff_roles_role ON staff_roles (role);
