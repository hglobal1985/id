// Repository policy checks (kept deliberately small and explicit).
import { existsSync, readFileSync } from "node:fs";

const problems = [];
const need = (cond, msg) => cond || problems.push(msg);

need(existsSync("AGENTS.md"), "AGENTS.md is missing");
need(existsSync(".github/workflows/ci.yml"), "CI workflow is missing");
need(existsSync(".github/workflows/deploy.yml"), "Deploy workflow is missing");
need(existsSync("openapi/hglobal-id.v1.json"), "openapi/hglobal-id.v1.json is missing");

if (existsSync("wrangler.jsonc")) {
  const w = readFileSync("wrangler.jsonc", "utf8");
  need(!/"account_id"/.test(w), "wrangler.jsonc must not contain account_id (public repo)");
}

if (problems.length) {
  for (const p of problems) console.error(`policy: ${p}`);
  process.exit(1);
}
console.log("policy: ok");
