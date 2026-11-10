// Per-member request limits (integration instruction pack, section 6): writes ≤ 30/min, reads ≤ 120/min.
// Uses the Workers Rate Limiting binding. Without a binding (local tests) requests are not limited.
export interface Limiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export const WRITE_LIMIT = { limit: 30, period: 60 } as const;
export const READ_LIMIT = { limit: 120, period: 60 } as const;

export function isWrite(method: string, path: string): boolean {
  if (path.startsWith("/v1/eligibility/")) return false; // eligibility checks are queries
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

export async function allowed(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    // The limiter is a guard against abuse, not an access control: if it is unavailable, serve the request.
    return true;
  }
}
