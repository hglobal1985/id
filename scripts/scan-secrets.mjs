// Fails when tracked or new (untracked, not ignored) files look like they contain secrets or Cloudflare account IDs.
// This repo is public: never commit tokens, keys, .env files, account IDs or real member data.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !f.endsWith("package-lock.json") && !f.startsWith("scripts/scan-secrets"));

const rules = [
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "Google client secret", re: /GOCSPX-[A-Za-z0-9_-]{20,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "bearer token literal", re: /Bearer\s+[A-Za-z0-9._-]{30,}/ },
  { name: "Cloudflare account id", re: /account[_ -]?id["']?\s*[:=]\s*["']?[0-9a-f]{32}\b/i },
  { name: "JWK private part", re: /"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/ },
];

const forbiddenNames = [/(^|\/)\.env(\..*)?$/, /(^|\/)\.dev\.vars$/];

let failed = false;
for (const f of files) {
  if (forbiddenNames.some((re) => re.test(f))) {
    console.error(`forbidden file tracked: ${f}`);
    failed = true;
    continue;
  }
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const r of rules) {
    if (r.re.test(text)) {
      console.error(`${f}: possible ${r.name}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log(`secrets scan: ${files.length} files clean`);
