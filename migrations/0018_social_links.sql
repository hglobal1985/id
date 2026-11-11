-- Social links (ADR 0017): the 社群連結 field is replaced by a list of links shown as icons on the member's card.
-- Platforms are managed by the super admin (name, order, icon); the built-in icons live in the code and an uploaded
-- icon replaces them. 自定義 lets a member upload a small icon of their own for one link.

CREATE TABLE social_platforms (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL,
  builtin_icon  TEXT,                       -- key of an icon shipped in the code; NULL = the generic link icon
  icon_mime     TEXT,                       -- an uploaded icon replaces the built-in one
  icon_data     BLOB,
  icon_version  INTEGER NOT NULL DEFAULT 1, -- bumped when the icon changes (cache busting)
  custom        INTEGER NOT NULL DEFAULT 0, -- 1 = members upload their own icon per link
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE social_links (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES members(id),
  platform_key TEXT NOT NULL,
  url         TEXT NOT NULL,
  label       TEXT,
  icon_mime   TEXT,                         -- custom links only: the member's own small icon
  icon_data   BLOB,
  sort_order  INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_social_links_member ON social_links (member_id, sort_order);

INSERT INTO social_platforms (key, name, sort_order, builtin_icon, custom, created_at, updated_at) VALUES
  ('amway_share', '安麗分享購', 10, 'amway_share', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('amway_ishare', '安麗iShare', 20, 'amway_ishare', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('line', 'LINE', 30, 'line', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('threads', '脆 Threads', 40, 'threads', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('dcard', 'Dcard', 50, 'dcard', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('instagram', 'IG', 60, 'instagram', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('facebook', '臉書 Facebook', 70, 'facebook', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('youtube', 'YouTube', 80, 'youtube', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('spotify', 'Spotify', 90, 'spotify', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('wechat', '微信 WeChat', 100, 'wechat', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('telegram', '電報 Telegram', 110, 'telegram', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('whatsapp', 'WhatsApp', 120, 'whatsapp', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('douyin', '抖音', 130, 'douyin', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('xiaohongshu', '小紅書', 140, 'xiaohongshu', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('x', 'X', 150, 'x', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('discord', 'Discord', 160, 'discord', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('googlemaps', 'Google Maps', 170, 'googlemaps', 0, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00'),
  ('custom', '自定義', 180, 'custom', 1, '2026-11-11T16:00:00+08:00', '2026-11-11T16:00:00+08:00');

-- The old single 社群連結 (website) field becomes one custom link; the field is deleted.
INSERT INTO social_links (id, member_id, platform_key, url, label, sort_order, created_at)
SELECT lower(hex(randomblob(16))), member_id, 'custom', json_extract(value, '$'), NULL, 10, updated_at
FROM profile_field_values WHERE field_key = 'website' AND json_type(value) = 'text';
DELETE FROM profile_field_values WHERE field_key = 'website';
DELETE FROM profile_visibility WHERE field_key = 'website';
