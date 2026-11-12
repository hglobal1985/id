// Queue a webhook event for a member's Apps and try to deliver it right after the response (best effort; the cron retries).
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { deliverDue, enqueueEvent } from "../db/webhooks";

/** Best effort: right after the response, send what is due. Where there is no execution context (tests), the cron does it. */
export function kickDelivery(c: Context<AppBindings>, deps: Deps): void {
  try {
    c.executionCtx.waitUntil(deliverDue(c.env.DB, c.env, deps.now()).then(() => undefined, () => undefined));
  } catch {
    /* no execution context */
  }
}

/** The member's profile changed: tell every App they use (field NAMES only). Never blocks or fails the request. */
export async function notifyProfileChanged(c: Context<AppBindings>, deps: Deps, memberId: string, fields: string[]): Promise<void> {
  try {
    await enqueueEvent(c.env.DB, memberId, "member.profile_changed", fields, deps.now());
    kickDelivery(c, deps);
  } catch (e) {
    console.log(JSON.stringify({ job: "webhook.enqueue", error: e instanceof Error ? e.name : "error" }));
  }
}
