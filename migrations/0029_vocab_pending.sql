-- A term suggested by a trusted service (POST /v1/vocab/suggestions, ADR 0029) waits for the super admin before it appears in
-- anyone's suggestions: pending = 1 until approved in the back office 關聯詞 page. suggested_by is the App that sent it.
ALTER TABLE vocab_terms ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vocab_terms ADD COLUMN suggested_by TEXT;
