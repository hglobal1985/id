// Scope rules (framework-free). Names follow the integration instruction pack, section 3 / 4A / 4B,
// and are the same in both central member systems.

export const SUPPORTED_SCOPES = [
  "openid",
  "profile",
  "profile.read",
  "profile.basic.write",
  "profile.avatar.write",
  "profile.contact.write",
  "profile.birthday.write",
  "profile.visibility.write",
  "profile.spouse.write",
  "amway.read",
  "amway.write",
] as const;

export type Scope = (typeof SUPPORTED_SCOPES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_SCOPES);

export function parseScope(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(" ").filter(Boolean))];
}

export function formatScope(scopes: Iterable<string>): string {
  // Keep a stable order (the order of SUPPORTED_SCOPES) so stored values are comparable.
  const set = new Set(scopes);
  return SUPPORTED_SCOPES.filter((s) => set.has(s)).join(" ");
}

export type ScopeCheck =
  | { ok: true; scopes: string[] }
  | { ok: false; reason: "missing_openid" | "unknown_scope" | "not_allowed"; scope?: string };

/**
 * Validates a requested scope string for a client.
 * - `openid` is required (this is an OpenID Connect provider).
 * - Unknown scopes are rejected (no silent dropping), as are scopes the client is not registered for.
 */
export function checkRequestedScope(raw: string | undefined, allowedForClient: string): ScopeCheck {
  const requested = parseScope(raw);
  if (!requested.includes("openid")) return { ok: false, reason: "missing_openid" };
  const allowed = new Set(parseScope(allowedForClient));
  for (const s of requested) {
    if (!SUPPORTED.has(s)) return { ok: false, reason: "unknown_scope", scope: s };
    if (!allowed.has(s)) return { ok: false, reason: "not_allowed", scope: s };
  }
  return { ok: true, scopes: parseScope(formatScope(requested)) };
}

/** True when every scope in `needed` is granted. */
export function hasScopes(granted: string, needed: string[]): boolean {
  const g = new Set(parseScope(granted));
  return needed.every((s) => g.has(s));
}
