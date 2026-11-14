-- The 使用語言 (languages) field is removed (owner decision 2026-11-14): its saved values and visibility choices go with it.
DELETE FROM profile_field_values WHERE field_key = 'languages';
DELETE FROM profile_visibility WHERE field_key = 'languages';
