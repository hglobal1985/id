-- Round 3 (ADR 0015): 地區教育中心 is free text; when the training system is H-Global1985 it offers a vocabulary of
-- its own centers (managed in the back office 詞庫). Account deletion is immediate, so the request queue is unused.

ALTER TABLE vocab_terms ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Existing center values (option codes) become the option labels.
UPDATE amway_field_values
SET value = CASE WHEN value IS NOT NULL AND json_type(value) = 'text'
      THEN json_quote(COALESCE((SELECT o.label FROM amway_options o WHERE o.field_key = 'education_center' AND o.value = json_extract(amway_field_values.value, '$')), json_extract(amway_field_values.value, '$')))
      ELSE value END,
    pending_value = CASE WHEN pending_value IS NOT NULL AND json_type(pending_value) = 'text'
      THEN json_quote(COALESCE((SELECT o.label FROM amway_options o WHERE o.field_key = 'education_center' AND o.value = json_extract(amway_field_values.pending_value, '$')), json_extract(amway_field_values.pending_value, '$')))
      ELSE pending_value END
WHERE field_key = 'education_center';

-- The center vocabulary, in the owner's order (the sort order keeps it).
INSERT OR IGNORE INTO vocab_terms (pool, norm, term, uses, hglobal, sort_order, created_at, updated_at) VALUES
  ('education_center', '無', '無', 0, 0, 1, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '飛登', '飛登', 0, 0, 2, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '南京', '南京', 0, 0, 3, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '自強', '自強', 0, 0, 4, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '明星', '明星', 0, 0, 5, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '民權', '民權', 0, 0, 6, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '中山', '中山', 0, 0, 7, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '桃園', '桃園', 0, 0, 8, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '新竹', '新竹', 0, 0, 9, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '台中', '台中', 0, 0, 10, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '彰化', '彰化', 0, 0, 11, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '員林', '員林', 0, 0, 12, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '嘉義', '嘉義', 0, 0, 13, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '台南', '台南', 0, 0, 14, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '高雄', '高雄', 0, 0, 15, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '屏東', '屏東', 0, 0, 16, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '香港', '香港', 0, 0, 17, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '澳門', '澳門', 0, 0, 18, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '中國', '中國', 0, 0, 19, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '美國', '美國', 0, 0, 20, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '澳洲', '澳洲', 0, 0, 21, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '加拿大', '加拿大', 0, 0, 22, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '英國', '英國', 0, 0, 23, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '義大利', '義大利', 0, 0, 24, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '日本', '日本', 0, 0, 25, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '韓國', '韓國', 0, 0, 26, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '馬來西亞', '馬來西亞', 0, 0, 27, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '泰國', '泰國', 0, 0, 28, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00'),
  ('education_center', '越南', '越南', 0, 0, 29, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00');
-- Centers the administrator had already defined as options are kept as terms (after the list above).
INSERT OR IGNORE INTO vocab_terms (pool, norm, term, uses, hglobal, sort_order, created_at, updated_at)
SELECT 'education_center', lower(trim(label)), trim(label), 0, 0, 100 + sort_order, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00' FROM amway_options WHERE field_key = 'education_center' AND active = 1;

-- Typing 寰宇 as the training system means H-Global1985 (like the term already marked).
INSERT OR IGNORE INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at)
VALUES ('education_system', '寰宇', '寰宇', 0, 1, '2026-11-11T12:00:00+08:00', '2026-11-11T12:00:00+08:00');
