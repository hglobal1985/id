/** Worker bindings. Secrets are set by the owner with `wrangler secret put`; never commit values. */
export interface Env {
  /** Central member database (D1). Bound per environment in wrangler.jsonc. */
  DB: D1Database;
  /** "staging" | "production" (plain var, not a secret). */
  ENVIRONMENT: string;
  /** OIDC issuer, e.g. https://id.hglobal1985.com (plain var). Required in production. */
  ISSUER?: string;
  /** Google OAuth client id for the H-Global1985 Google Cloud project (plain var). */
  GOOGLE_CLIENT_ID?: string;
  /** Secret: Google OAuth client secret. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Secret: private RSA JWK (JSON, with kid) used to sign ID and access tokens. */
  OIDC_SIGNING_JWK?: string;
  /** Secret (optional): previous private JWK, still published in JWKS during key rotation. */
  OIDC_SIGNING_JWK_PREVIOUS?: string;
}

export interface AuthContext {
  memberId: string;
  clientId: string;
  sessionId: string;
  scope: string;
  authTime: number;
}

export type AppBindings = { Bindings: Env; Variables: { requestId: string; auth: AuthContext } };
