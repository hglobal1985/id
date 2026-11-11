-- Profile model v2 (ADR 0014): free-text fields with suggestion vocabularies, merged interests/skills,
-- no legal name, avatars stored in D1 (no R2), Amway area without a consent screen.

-- Suggestion vocabularies (one pool per kind of field; shared pools are listed in src/vocab/terms.ts).
-- `norm` is the normalized spelling (NFKC, trimmed, lower case); `uses` counts how many saves used the term.
-- `hglobal` marks the education-system terms that mean H-Global1985 (they need review and unlock eligibility).
CREATE TABLE vocab_terms (
  pool       TEXT NOT NULL,
  norm       TEXT NOT NULL,
  term       TEXT NOT NULL,
  uses       INTEGER NOT NULL DEFAULT 0,
  hglobal    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pool, norm)
);
INSERT INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at)
VALUES ('education_system', 'h-global1985', 'H-Global1985', 0, 1, '2026-11-11T00:00:00+08:00', '2026-11-11T00:00:00+08:00');

-- Small square avatars (client-resized, at most 128 KB) served from /avatar/<member id>.
CREATE TABLE member_avatars (
  member_id  TEXT PRIMARY KEY REFERENCES members(id),
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

-- The legal-name field is permanently deleted (owner decision 2026-11-11).
DELETE FROM profile_field_values WHERE field_key = 'primary_name';
DELETE FROM profile_visibility WHERE field_key = 'primary_name';

-- Interests and skills become one list, 「興趣與專長」 (key `interests`).
INSERT INTO profile_field_values (member_id, field_key, value, updated_at, updated_by_app)
SELECT p.member_id, 'interests',
       (SELECT json_group_array(v) FROM (SELECT DISTINCT j.value AS v FROM profile_field_values p2, json_each(p2.value) j WHERE p2.member_id = p.member_id AND p2.field_key IN ('interests', 'skills'))),
       MAX(p.updated_at), NULL
FROM profile_field_values p WHERE p.field_key IN ('interests', 'skills') GROUP BY p.member_id
ON CONFLICT (member_id, field_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
DELETE FROM profile_field_values WHERE field_key = 'skills';
DELETE FROM profile_visibility WHERE field_key = 'skills';

-- Occupation and organization hold several items now.
UPDATE profile_field_values SET value = json_array(json_extract(value, '$')) WHERE field_key IN ('occupation', 'organization') AND json_type(value) = 'text';

-- Education system and the three upline fields are plain text: the old {option, custom_text} objects become text.
UPDATE amway_field_values
SET value = CASE WHEN value IS NOT NULL AND json_type(value) = 'object'
      THEN json_quote(COALESCE((SELECT o.label FROM amway_options o WHERE o.field_key = amway_field_values.field_key AND o.value = json_extract(amway_field_values.value, '$.option')),
                               json_extract(amway_field_values.value, '$.custom_text'), json_extract(amway_field_values.value, '$.option')))
      ELSE value END,
    pending_value = CASE WHEN pending_value IS NOT NULL AND json_type(pending_value) = 'object'
      THEN json_quote(COALESCE((SELECT o.label FROM amway_options o WHERE o.field_key = amway_field_values.field_key AND o.value = json_extract(amway_field_values.pending_value, '$.option')),
                               json_extract(amway_field_values.pending_value, '$.custom_text'), json_extract(amway_field_values.pending_value, '$.option')))
      ELSE pending_value END
WHERE field_key IN ('education_system', 'upline_diamond', 'upline_platinum', 'upline_crown_ambassador');
UPDATE amway_review_requests
SET requested_value = json_quote(COALESCE((SELECT o.label FROM amway_options o WHERE o.field_key = amway_review_requests.field_key AND o.value = json_extract(amway_review_requests.requested_value, '$.option')),
                                          json_extract(amway_review_requests.requested_value, '$.custom_text'), json_extract(amway_review_requests.requested_value, '$.option')))
WHERE field_key IN ('education_system', 'upline_diamond', 'upline_platinum', 'upline_crown_ambassador') AND json_type(requested_value) = 'object';

-- Existing education-system / upline text becomes suggestion terms.
INSERT OR IGNORE INTO vocab_terms (pool, norm, term, uses, hglobal, created_at, updated_at)
SELECT field_key, lower(trim(json_extract(value, '$'))), trim(json_extract(value, '$')), COUNT(*), 0, '2026-11-11T00:00:00+08:00', '2026-11-11T00:00:00+08:00'
FROM amway_field_values
WHERE field_key IN ('education_system', 'upline_diamond', 'upline_platinum', 'upline_crown_ambassador') AND value IS NOT NULL AND json_type(value) = 'text' AND trim(json_extract(value, '$')) <> ''
GROUP BY field_key, lower(trim(json_extract(value, '$')));
