-- The training system is shown as 寰宇, never as H-Global1985 (owner decision 2026-11-11): existing values and the
-- suggestion term "H-Global1985" become 寰宇, which stays the term that means H-Global1985 (review, eligibility).
UPDATE amway_field_values SET value = json_quote('寰宇') WHERE field_key = 'education_system' AND value IS NOT NULL AND json_type(value) = 'text' AND lower(trim(json_extract(value, '$'))) = 'h-global1985';
UPDATE amway_field_values SET pending_value = json_quote('寰宇') WHERE field_key = 'education_system' AND pending_value IS NOT NULL AND json_type(pending_value) = 'text' AND lower(trim(json_extract(pending_value, '$'))) = 'h-global1985';
UPDATE amway_review_requests SET requested_value = json_quote('寰宇') WHERE field_key = 'education_system' AND json_type(requested_value) = 'text' AND lower(trim(json_extract(requested_value, '$'))) = 'h-global1985';
INSERT OR IGNORE INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at) VALUES ('education_system', '寰宇', '寰宇', 0, 1, '2026-11-11T18:00:00+08:00', '2026-11-11T18:00:00+08:00');
UPDATE vocab_terms SET hglobal = 1, uses = uses + COALESCE((SELECT uses FROM vocab_terms WHERE pool = 'education_system' AND norm = 'h-global1985'), 0) WHERE pool = 'education_system' AND norm = '寰宇';
DELETE FROM vocab_terms WHERE pool = 'education_system' AND norm = 'h-global1985';
