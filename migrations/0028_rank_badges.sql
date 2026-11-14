-- Rank badge gallery (ADR 0027): the badge picture of a rank (獎銜), shared by every App through the central API.
-- The picture itself lives in R2 under badges/<rank code>.png (public through /badges/<code>.png); this table says which ranks
-- have one, the picture's version (bumped when it is replaced, so the public address changes and caches are not stale) and
-- where the artwork sits inside the 380x720 canvas (art_top..art_bottom, in pixels) so Apps can place the sparkle effect.
-- A rank without a row has no badge (the API returns null for it).
CREATE TABLE rank_badges (
  value      TEXT PRIMARY KEY,        -- the rank option code (amway_options.value, field_key 'rank')
  version    INTEGER NOT NULL DEFAULT 1,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  art_top    INTEGER NOT NULL,
  art_bottom INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- The 24 pictures copied from the learn App's gallery (the other 9 ranks have no badge). The pictures are uploaded to R2
-- BEFORE this migration is applied to an environment.
INSERT INTO rank_badges (value, version, width, height, art_top, art_bottom, updated_at) VALUES
  ('r15b', 1, 380, 720, 257, 463, '2026-11-15T12:00:00+08:00'),
  ('silver', 1, 380, 720, 235, 488, '2026-11-15T12:00:00+08:00'),
  ('gold', 1, 380, 720, 235, 488, '2026-11-15T12:00:00+08:00'),
  ('platinum', 1, 380, 720, 181, 552, '2026-11-15T12:00:00+08:00'),
  ('ruby', 1, 380, 720, 167, 564, '2026-11-15T12:00:00+08:00'),
  ('f_platinum', 1, 380, 720, 181, 552, '2026-11-15T12:00:00+08:00'),
  ('f_ruby', 1, 380, 720, 167, 564, '2026-11-15T12:00:00+08:00'),
  ('pearl', 1, 380, 720, 167, 564, '2026-11-15T12:00:00+08:00'),
  ('sapphire', 1, 380, 720, 167, 564, '2026-11-15T12:00:00+08:00'),
  ('f_sapphire', 1, 380, 720, 167, 564, '2026-11-15T12:00:00+08:00'),
  ('emerald', 1, 380, 720, 167, 564, '2026-11-15T12:00:00+08:00'),
  ('f_emerald', 1, 380, 720, 167, 564, '2026-11-15T12:00:00+08:00'),
  ('diamond', 1, 380, 720, 137, 593, '2026-11-15T12:00:00+08:00'),
  ('f_diamond', 1, 380, 720, 137, 593, '2026-11-15T12:00:00+08:00'),
  ('exec_diamond', 1, 380, 720, 137, 593, '2026-11-15T12:00:00+08:00'),
  ('f_exec_diamond', 1, 380, 720, 138, 594, '2026-11-15T12:00:00+08:00'),
  ('double_diamond', 1, 380, 720, 138, 594, '2026-11-15T12:00:00+08:00'),
  ('f_double_diamond', 1, 380, 720, 138, 594, '2026-11-15T12:00:00+08:00'),
  ('triple_diamond', 1, 380, 720, 137, 593, '2026-11-15T12:00:00+08:00'),
  ('f_triple_diamond', 1, 380, 720, 138, 594, '2026-11-15T12:00:00+08:00'),
  ('crown', 1, 380, 720, 70, 659, '2026-11-15T12:00:00+08:00'),
  ('f_crown', 1, 380, 720, 70, 659, '2026-11-15T12:00:00+08:00'),
  ('crown_ambassador', 1, 380, 720, 32, 694, '2026-11-15T12:00:00+08:00'),
  ('f_crown_ambassador', 1, 380, 720, 32, 694, '2026-11-15T12:00:00+08:00');
