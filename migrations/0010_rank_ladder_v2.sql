-- Rank ladder, corrected version (owner, 2026-11-10), low to high. Replaces the order seeded by 0009.
-- 「無」 is an explicit option (lowest); an unanswered field stays empty. Existing codes keep their meaning;
-- only sort_order and labels change. 「鑽石級以上」 is withdrawn (removed unless a member already holds it).
INSERT INTO amway_options (field_key, value, label, sort_order, active) VALUES
  ('rank', 'none', '無', 10, 1),
  ('rank', 'r03', '3%', 20, 1),
  ('rank', 'r06', '6%', 30, 1),
  ('rank', 'r09', '9%', 40, 1),
  ('rank', 'r12', '12%', 50, 1),
  ('rank', 'r12a', '12%初階', 60, 1),
  ('rank', 'r15', '15%', 70, 1),
  ('rank', 'r15b', '15%銅章', 80, 1),
  ('rank', 'r18', '18%', 90, 1),
  ('rank', 'r21', '21%', 100, 1),
  ('rank', 'silver', '銀章', 110, 1),
  ('rank', 'gold', '金章', 120, 1),
  ('rank', 'platinum', '白金', 130, 1),
  ('rank', 'ruby', '紅寶石', 140, 1),
  ('rank', 'f_platinum', '創辦人白金', 150, 1),
  ('rank', 'f_ruby', '創辦人紅寶石', 160, 1),
  ('rank', 'sapphire', '藍寶石', 170, 1),
  ('rank', 'f_sapphire', '創辦人藍寶石', 180, 1),
  ('rank', 'pearl', '明珠', 190, 1),
  ('rank', 'emerald', '翡翠', 200, 1),
  ('rank', 'f_emerald', '創辦人翡翠', 210, 1),
  ('rank', 'diamond', '鑽石', 220, 1),
  ('rank', 'f_diamond', '創辦人鑽石', 230, 1),
  ('rank', 'exec_diamond', '執行專才鑽石', 240, 1),
  ('rank', 'f_exec_diamond', '創辦人執行專才鑽石', 250, 1),
  ('rank', 'double_diamond', '雙鑽石', 260, 1),
  ('rank', 'f_double_diamond', '創辦人雙鑽石', 270, 1),
  ('rank', 'triple_diamond', '參鑽石', 280, 1),
  ('rank', 'f_triple_diamond', '創辦人參鑽石', 290, 1),
  ('rank', 'crown', '皇冠', 300, 1),
  ('rank', 'f_crown', '創辦人皇冠', 310, 1),
  ('rank', 'crown_ambassador', '皇冠大使', 320, 1),
  ('rank', 'f_crown_ambassador', '創辦人皇冠大使', 330, 1)
ON CONFLICT (field_key, value) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order, active = 1;
UPDATE amway_options SET active = 0 WHERE field_key = 'rank' AND value = 'diamond_plus';
DELETE FROM amway_options WHERE field_key = 'rank' AND value = 'diamond_plus'
  AND NOT EXISTS (SELECT 1 FROM amway_field_values WHERE field_key = 'rank' AND (value = '"diamond_plus"' OR pending_value = '"diamond_plus"'));
