-- A reviewer may approve a request with a corrected value (ADR 0031). requested_value keeps what the member asked for;
-- approved_value holds the value the reviewer actually approved, only when it differs (NULL = approved as requested).
-- The values live here, not in the audit log: the audit log never stores Amway field values.
ALTER TABLE amway_review_requests ADD COLUMN approved_value TEXT;
