-- 職稱 (job_title) now holds several items like 行業與工作 and 公司／單位: a text value becomes a one-item list.
UPDATE profile_field_values SET value = json_array(json_extract(value, '$')) WHERE field_key = 'job_title' AND json_type(value) = 'text';
