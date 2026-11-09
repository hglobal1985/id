// Prints a new private RSA signing key (JWK JSON) to stdout, for the OIDC_SIGNING_JWK Worker secret.
// Pipe it straight into wrangler; never save it in the repo, paste it into chats, issues or logs:
//   node scripts/generate-signing-key.mjs | npx wrangler secret put OIDC_SIGNING_JWK --env staging
import { webcrypto } from "node:crypto";

const { privateKey } = await webcrypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const jwk = await webcrypto.subtle.exportKey("jwk", privateKey);
const kid = new Date().toISOString().slice(0, 10) + "-" + webcrypto.randomUUID().slice(0, 8);
process.stdout.write(JSON.stringify({ ...jwk, kid, alg: "RS256", use: "sig", key_ops: undefined, ext: undefined }));
