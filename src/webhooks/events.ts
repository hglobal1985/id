// Webhook rules (framework-free): the event body, the HMAC signature and the retry schedule.
// Events carry the member id and field NAMES only, never values: the App reads what it needs from the central system.
import { base64url, utf8 } from "../lib/crypto";

export const WEBHOOK_EVENTS = ["member.profile_changed", "member.deleted", "webhook.test"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** Seconds to wait after the 1st, 2nd … failed attempt: 1 min, 5 min, 30 min, 2 h, 6 h, 24 h. After the 7th failure the event is `failed`. */
export const RETRY_DELAYS: readonly number[] = [60, 300, 1800, 7200, 21600, 86400];
export const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;
/** Events (delivered or failed) are kept this long for the back-office delivery log, then purged. */
export const EVENT_RETENTION_SECONDS = 30 * 24 * 3600;
/** A receiver must answer 2xx within this time. */
export const DELIVERY_TIMEOUT_MS = 5000;
/** Receivers reject a timestamp older (or newer) than this many seconds. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function nextDelaySeconds(attemptsMade: number): number | null {
  return attemptsMade >= MAX_ATTEMPTS ? null : (RETRY_DELAYS[attemptsMade - 1] ?? null);
}

export interface EventBody {
  id: string;
  type: WebhookEventType;
  created_at: string;
  app_id: string;
  member_id: string;
  /** Names of the changed profile fields (member.profile_changed only). */
  fields?: string[];
}

export function bodyOf(e: { id: string; type: string; created_at: string; app_id: string; member_id: string; fields: string | null }): string {
  const body: EventBody = { id: e.id, type: e.type as WebhookEventType, created_at: e.created_at, app_id: e.app_id, member_id: e.member_id };
  if (e.fields) body.fields = JSON.parse(e.fields) as string[];
  return JSON.stringify(body);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(message)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `X-HG-Signature: v1=<hex>` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`). */
export async function signature(secret: string, timestamp: number, rawBody: string): Promise<string> {
  return `v1=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}

/** The per-App signing secret: HMAC(WEBHOOK_SIGNING_KEY, "webhook:<app_id>:<version>"), shown to the owner once. */
export async function deriveSecret(masterKey: string, appId: string, version: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8(masterKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(`webhook:${appId}:${version}`))));
}

export const WEBHOOK_URL = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?(\/[A-Za-z0-9._~\-/%]{0,200})?$/;
