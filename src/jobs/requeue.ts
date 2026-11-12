// Heals values that needed review but were saved without it (ADR 0023): a rank or center of a member who is 寰宇 and has a real
// regional center, saved earlier as "not required". Each one is sent again through the normal write, which starts the standard
// review (request, notice to the reviewers of that center) and keeps the value pending until approved. Safe to repeat.
import { getAmwayField } from "../amway/fields";
import { writeAmwayField } from "../db/amway";

export async function requeueUnreviewed(db: D1Database, now: Date): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT v.member_id AS member_id, v.field_key AS field_key, v.value AS value FROM amway_field_values v
       WHERE v.field_key IN ('education_center', 'rank') AND v.value IS NOT NULL AND v.value_approved = 0 AND v.status = 'not_required' AND v.pending_value IS NULL
         AND EXISTS (SELECT 1 FROM amway_field_values s JOIN vocab_terms t ON t.pool = 'education_system' AND t.hglobal = 1
                     WHERE s.member_id = v.member_id AND s.field_key = 'education_system'
                       AND (t.norm = lower(trim(json_extract(s.value, '$'))) OR t.norm = lower(trim(json_extract(s.pending_value, '$')))))
         AND ((v.field_key = 'education_center' AND json_extract(v.value, '$') != '無')
           OR (v.field_key = 'rank' AND EXISTS (SELECT 1 FROM amway_field_values c WHERE c.member_id = v.member_id AND c.field_key = 'education_center'
                 AND COALESCE(json_extract(c.pending_value, '$'), json_extract(c.value, '$')) IS NOT NULL
                 AND COALESCE(json_extract(c.pending_value, '$'), json_extract(c.value, '$')) != '無')))
       LIMIT 50`,
    )
    .all<{ member_id: string; field_key: string; value: string }>();
  let n = 0;
  for (const r of rows.results ?? []) {
    if (!getAmwayField(r.field_key)) continue;
    await writeAmwayField(db, r.member_id, r.field_key, JSON.parse(r.value) as string, { appId: "system", requestId: "requeue", now });
    n++;
  }
  return n;
}
