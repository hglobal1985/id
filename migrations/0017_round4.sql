-- Round 4 (ADR 0016): the nickname field is deleted, forced-public fields, the member-number reminder flag,
-- and the updated regional-center list.

DELETE FROM profile_field_values WHERE field_key = 'nickname';
DELETE FROM profile_visibility WHERE field_key = 'nickname';

-- 1 = the member has changed the number at least once: the "recommended to change" reminder never comes back.
ALTER TABLE members ADD COLUMN number_customized INTEGER NOT NULL DEFAULT 0;
UPDATE members SET number_customized = 1
WHERE EXISTS (SELECT 1 FROM member_numbers n WHERE n.member_id = members.id AND n.position = 0
              AND NOT (n.number GLOB (n.country || '0[0-9][0-9][0-9][0-9][0-9][0-9]*')));

-- The regional center list is replaced by the owner's updated list (with the center codes), in his order.
DELETE FROM vocab_terms WHERE pool = 'education_center';
INSERT INTO vocab_terms (pool, norm, term, uses, hglobal, sort_order, created_at, updated_at) VALUES
  ('education_center', '飛登 013', '飛登 013', 0, 0, 1, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '飛登蓁分享', '飛登蓁分享', 0, 0, 2, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '南京 062', '南京 062', 0, 0, 3, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '自強 061', '自強 061', 0, 0, 4, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '民權 018', '民權 018', 0, 0, 5, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '明星 339', '明星 339', 0, 0, 6, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '中山 288', '中山 288', 0, 0, 7, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '桃園 321', '桃園 321', 0, 0, 8, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '新竹 122', '新竹 122', 0, 0, 9, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '台中 136', '台中 136', 0, 0, 10, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '彰化 151', '彰化 151', 0, 0, 11, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '員林 153', '員林 153', 0, 0, 12, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '嘉義 166', '嘉義 166', 0, 0, 13, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '台南 187', '台南 187', 0, 0, 14, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '高雄 195', '高雄 195', 0, 0, 15, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00'),
  ('education_center', '屏東 221', '屏東 221', 0, 0, 16, '2026-11-11T14:00:00+08:00', '2026-11-11T14:00:00+08:00');
