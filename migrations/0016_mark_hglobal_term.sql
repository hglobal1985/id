-- 寰宇 may already exist as a (unmarked) term typed by a member before migration 0015 seeded it: mark it as meaning
-- H-Global1985 (the owner's decision: typing 寰宇 as the training system means H-Global1985).
UPDATE vocab_terms SET hglobal = 1 WHERE pool = 'education_system' AND norm = '寰宇';
