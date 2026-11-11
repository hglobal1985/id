-- Round 11 (ADR 0020): values that need review but were saved without it (entered before the training system 寰宇 was marked
-- as such, so nobody — the super admin included — went through the standard review) are sent to review now.
-- The value stops being effective until a reviewer approves it.

-- 1. Review requests (one per such value), judged on the data as it is before anything is moved.
INSERT INTO amway_review_requests (id, member_id, field_key, requested_value, status, created_at, app_id)
SELECT lower(hex(randomblob(16))), v.member_id, v.field_key, v.value, 'pending', '2026-11-11T17:00:00+08:00', NULL
FROM amway_field_values v
WHERE v.value IS NOT NULL AND v.value_approved = 0 AND v.status = 'not_required' AND v.pending_value IS NULL
  AND (
    (v.field_key = 'education_system'
      AND EXISTS (SELECT 1 FROM vocab_terms t WHERE t.pool = 'education_system' AND t.hglobal = 1 AND t.norm = lower(trim(json_extract(v.value, '$')))))
    OR
    (v.field_key = 'rank'
      AND EXISTS (SELECT 1 FROM amway_field_values s JOIN vocab_terms t ON t.pool = 'education_system' AND t.hglobal = 1
                  WHERE s.member_id = v.member_id AND s.field_key = 'education_system'
                    AND (t.norm = lower(trim(json_extract(s.value, '$'))) OR t.norm = lower(trim(json_extract(s.pending_value, '$'))))))
  );

-- 2. Every staff member is told that requests are waiting.
INSERT INTO notifications (id, member_id, kind, payload, created_at)
SELECT lower(hex(randomblob(16))), s.member_id, 'staff.review.requested', json_object('request_id', r.id), '2026-11-11T17:00:00+08:00'
FROM amway_review_requests r CROSS JOIN (SELECT DISTINCT member_id FROM staff_roles) s
WHERE r.created_at = '2026-11-11T17:00:00+08:00' AND r.status = 'pending';

-- 3. The values wait as pending (not effective).
UPDATE amway_field_values
SET pending_value = value, value = NULL, status = 'pending', updated_at = '2026-11-11T17:00:00+08:00'
WHERE EXISTS (SELECT 1 FROM amway_review_requests r
              WHERE r.member_id = amway_field_values.member_id AND r.field_key = amway_field_values.field_key
                AND r.created_at = '2026-11-11T17:00:00+08:00' AND r.status = 'pending');
