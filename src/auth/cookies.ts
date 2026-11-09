import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

// __Host- prefix: Secure, Path=/, no Domain (cannot be set or read by sibling subdomains).
export const SESSION_COOKIE = "hgid_session";
export const FLOW_COOKIE = "hgid_flow";

export function readCookie(c: Context, name: string): string | undefined {
  return getCookie(c, name, "host");
}

export function writeCookie(c: Context, name: string, value: string, maxAge: number): void {
  setCookie(c, name, value, { prefix: "host", path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge });
}

export function clearCookie(c: Context, name: string): void {
  deleteCookie(c, name, { prefix: "host", path: "/", secure: true });
}
