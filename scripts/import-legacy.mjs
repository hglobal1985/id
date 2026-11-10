// Legacy member import (PR 9). Turns an export of the old site's tables into SQL for the new database.
// Real member data stays on the owner's machine: the export and the SQL file are git-ignored (legacy-*.json,
// legacy-import*.sql) and must never be committed, pasted into chats, issues or logs.
//
// 1) Export (read-only, from the old account):
//    npx wrangler d1 execute echoes_db --remote --json --command "SELECT * FROM users" > legacy-users.json
//    npx wrangler d1 execute echoes_db --remote --json --command "SELECT kind, name FROM upline_names" > legacy-uplines.json
// 2) Build:   npx tsx scripts/import-legacy.mjs legacy-users.json legacy-uplines.json > legacy-import.sql
//    (prints only counts to stderr)
// 3) Apply (staging first; production only with the owner's approval, BEFORE members start signing in):
//    npx wrangler d1 execute hglobal-id-staging --env staging --remote --file legacy-import.sql
import { readFileSync } from "node:fs";
import { planImport } from "../src/import/legacy.ts";
import { generateMemberNumber } from "../src/profile/member-number.ts";

const rows = (file) => {
  const j = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(j) && j[0]?.results ? j[0].results : j;
};
const [usersFile, uplinesFile] = process.argv.slice(2);
if (!usersFile || !uplinesFile) {
  console.error("usage: tsx scripts/import-legacy.mjs legacy-users.json legacy-uplines.json > legacy-import.sql");
  process.exit(1);
}
const users = rows(usersFile);
const taken = new Set(users.map((u) => String(u.amwayId ?? "").trim().toUpperCase()).filter(Boolean));
const numbers = [];
for (let i = 0; i < users.length; i++) {
  const e = await generateMemberNumber("TW", async (n) => taken.has(n));
  taken.add(e.number);
  numbers.push(e.number);
}
const { sql, report } = planImport(users, rows(uplinesFile), new Date(), (i) => numbers[i]);
process.stdout.write(sql.join("\n") + "\n");
console.error(JSON.stringify(report, null, 2));
