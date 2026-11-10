-- Rank ladder options (owner decision 2026-11-10), low to high. Previously seeded by the legacy import,
-- which was dropped: the H-Global1985 central system starts with no member data.
-- Codes are stable (apps store them as min_rank). Administrators can rename or deactivate them later.
INSERT INTO amway_options (field_key, value, label, sort_order, active) VALUES
  ('rank', 'r03', '3%', 10, 1),
  ('rank', 'r09', '9%', 20, 1),
  ('rank', 'r12a', '12%初階', 30, 1),
  ('rank', 'r12', '12%', 40, 1),
  ('rank', 'r15', '15%', 50, 1),
  ('rank', 'r15b', '15%銅章', 60, 1),
  ('rank', 'r18', '18%', 70, 1),
  ('rank', 'r21', '21%', 80, 1),
  ('rank', 'silver', '銀章', 90, 1),
  ('rank', 'gold', '金章', 100, 1),
  ('rank', 'platinum', '白金', 110, 1),
  ('rank', 'f_platinum', '創辦人白金', 120, 1),
  ('rank', 'ruby', '紅寶石', 130, 1),
  ('rank', 'f_ruby', '創辦人紅寶石', 140, 1),
  ('rank', 'sapphire', '藍寶石', 150, 1),
  ('rank', 'f_sapphire', '創辦人藍寶石', 160, 1),
  ('rank', 'emerald', '翡翠', 170, 1),
  ('rank', 'diamond_plus', '鑽石級以上', 180, 1)
ON CONFLICT (field_key, value) DO NOTHING;
