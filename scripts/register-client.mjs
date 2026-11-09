// Prints SQL that registers an app (OIDC client). The owner runs it with wrangler; nothing is committed.
//   node scripts/register-client.mjs --id elearning --name "elearning" \
//     --redirect https://elearning.hglobal1985.com/auth/callback \
//     --post-logout https://elearning.hglobal1985.com/ \
//     --auth client_secret_basic > client.sql
//   npx wrangler d1 execute hglobal-id-staging --env staging --remote --file client.sql
// For confidential clients the generated client secret is printed once to stderr: put it straight into the
// app's own secret store. Do not paste it into chats, issues, PRs or logs. Delete client.sql afterwards.
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    name: { type: "string" },
    redirect: { type: "string", multiple: true },
    "post-logout": { type: "string", multiple: true, default: [] },
    auth: { type: "string", default: "client_secret_basic" },
    scopes: {
      type: "string",
      default:
        "openid profile profile.read profile.basic.write profile.avatar.write profile.contact.write profile.birthday.write profile.visibility.write profile.spouse.write amway.read amway.write",
    },
  },
});

const fail = (m) => {
  console.error(m);
  process.exit(1);
};
if (!values.id || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(values.id)) fail("--id: lowercase letters, digits, hyphen");
if (!values.name) fail("--name is required");
if (!values.redirect?.length) fail("--redirect is required (exact https URL; repeatable)");
if (!["none", "client_secret_basic", "client_secret_post"].includes(values.auth)) fail("--auth: none | client_secret_basic | client_secret_post");
for (const u of [...values.redirect, ...values["post-logout"]]) {
  let ok = false;
  try {
    const p = new URL(u);
    ok = p.protocol === "https:" && !p.hash && !u.includes("*") && p.href === u;
  } catch {
    ok = false;
  }
  if (!ok) fail(`not an exact https URL: ${u}`);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
let secretHash = "NULL";
if (values.auth !== "none") {
  const secret = randomBytes(32).toString("base64url");
  secretHash = q(createHash("sha256").update(secret).digest("base64url"));
  console.error(`client_secret (shown once, store it in the app's secret settings only): ${secret}`);
}
const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace("Z", "+08:00");
process.stdout.write(
  `INSERT INTO oauth_clients (client_id, name, client_secret_hash, token_endpoint_auth_method, redirect_uris, post_logout_redirect_uris, allowed_scopes, status, created_at, updated_at)
VALUES (${q(values.id)}, ${q(values.name)}, ${secretHash}, ${q(values.auth)}, ${q(JSON.stringify(values.redirect))}, ${q(JSON.stringify(values["post-logout"]))}, ${q(values.scopes)}, 'active', ${q(now)}, ${q(now)});
`,
);
