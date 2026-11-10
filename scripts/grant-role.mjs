// Prints SQL that grants a staff role to an existing member (for the first super admin).
// The member must have signed in once. Find their member id on the profile page (會員識別碼).
//   node scripts/grant-role.mjs --member <member id> --role super_admin > grant.sql
//   npx wrangler d1 execute hglobal-id-staging --env staging --remote --file grant.sql && rm grant.sql
// Later roles are managed in the admin area by a super admin.
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { member: { type: "string" }, role: { type: "string" } } });
if (!values.member || !/^[0-9a-f-]{36}$/.test(values.member)) {
  console.error("--member must be a member id (UUID)");
  process.exit(1);
}
if (!["super_admin", "secretary", "reviewer"].includes(values.role ?? "")) {
  console.error("--role: super_admin | secretary | reviewer");
  process.exit(1);
}
const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace("Z", "+08:00");
process.stdout.write(
  `INSERT INTO staff_roles (member_id, role, granted_at, granted_by) SELECT id, '${values.role}', '${now}', NULL FROM members WHERE id = '${values.member}' ON CONFLICT DO NOTHING;
INSERT INTO audit_log (id, occurred_at, actor_type, action, target_type, target_id, result, detail) VALUES (lower(hex(randomblob(16))), '${now}', 'system', 'staff.role.grant', 'member', '${values.member}', 'success', '{"role":"${values.role}","bootstrap":true}');
`,
);
