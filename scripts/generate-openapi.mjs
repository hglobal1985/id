// Generates openapi/hglobal-id.v1.json from the route definitions.
// Run with: tsx scripts/generate-openapi.mjs [--check]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createApp } from "../src/app.ts";

const OUT = new URL("../openapi/hglobal-id.v1.json", import.meta.url);
const doc = createApp().getOpenAPI31Document({
  openapi: "3.1.0",
  info: {
    title: "H-Global1985 Central Member System API",
    version: "1.0.0",
    description: "Central member API for id.hglobal1985.com.",
  },
});
const next = JSON.stringify(doc, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== next) {
    console.error("openapi/hglobal-id.v1.json is out of date. Run `npm run openapi` and commit it.");
    process.exit(1);
  }
  console.log("openapi: up to date");
} else {
  writeFileSync(OUT, next);
  console.log("openapi: written");
}
