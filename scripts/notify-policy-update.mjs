// Prints SQL that gives every active member the in-site notice 「隱私權政策已更新」 (kind policy.updated).
// Run it ONLY after the owner approved the policy text and the policy page is live:
//   node scripts/notify-policy-update.mjs > notice.sql
//   npx wrangler d1 execute hglobal-id --env production --remote --file notice.sql && rm notice.sql
const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace("Z", "+08:00");
process.stdout.write(
  `INSERT INTO notifications (id, member_id, kind, payload, created_at)
SELECT lower(hex(randomblob(16))), id, 'policy.updated', '{}', '${now}' FROM members WHERE status = 'active'
  AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.member_id = members.id AND n.kind = 'policy.updated');
`,
);
