// Redirect URI and return-path rules (framework-free).

/** Registered redirect URIs must be absolute https URLs without fragments or wildcards. */
export function isRegistrableRedirectUri(uri: string): boolean {
  if (uri.includes("*")) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.hash && !u.username && !u.password && u.href === uri;
}

/** Exact string match against the registered list (no prefix or wildcard matching). */
export function matchRegisteredUri(uri: string | undefined, registered: string[]): boolean {
  return typeof uri === "string" && registered.includes(uri);
}

/** A same-origin path to resume after sign-in: "/..." but not "//" or "/\" (which browsers treat as another host). */
export function isSafeReturnPath(path: string): boolean {
  return /^\/(?![/\\])[^\s\\]*$/.test(path) && path.length <= 4096;
}

export function parseUriList(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
