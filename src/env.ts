/** Worker bindings. Secrets are added here as they are introduced; never commit values. */
export interface Env {
  /** Central member database (D1). Bound per environment in wrangler.jsonc. */
  DB: D1Database;
  /** "staging" | "production" (plain var, not a secret). */
  ENVIRONMENT: string;
}

export type AppBindings = { Bindings: Env; Variables: { requestId: string } };
