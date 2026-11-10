-- Whether the EFFECTIVE value was approved by review (or set by a reviewer). The `status` column describes
-- the latest change (e.g. 'pending' for a new value), so it alone cannot tell whether the old effective value
-- that stays in force during review, or after a rejection, was itself approved. Eligibility relies on this flag.
ALTER TABLE amway_field_values ADD COLUMN value_approved INTEGER NOT NULL DEFAULT 0;
UPDATE amway_field_values SET value_approved = 1 WHERE status = 'approved';
