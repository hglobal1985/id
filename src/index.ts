import { createApp } from "./app";
import type { Env } from "./env";
import { runCleanup } from "./jobs/cleanup";
import { deliverDue, purgeOldEvents } from "./db/webhooks";
import { requeueUnreviewed } from "./jobs/requeue";
import { moveAvatarsToR2, sweepAvatars } from "./jobs/files";

const app = createApp();

export default {
  fetch: app.fetch,
  // Cron every 5 minutes (wrangler.jsonc `triggers.crons`): send/retry due webhook events; once a day (19:00 UTC =
  // 03:00 Taiwan) the housekeeping, the 1-year retention rule and the purge of old webhook events.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    ctx.waitUntil(
      deliverDue(env.DB, env, now).then((r) => {
        console.log(JSON.stringify({ job: "webhooks", delivered: r.delivered, retried: r.retried, failed: r.failed, paused: r.paused }));
      }),
    );
    ctx.waitUntil(requeueUnreviewed(env.DB, now).then((n) => { if (n) console.log(JSON.stringify({ job: "requeue", requeued: n })); }, () => undefined));
    ctx.waitUntil(moveAvatarsToR2(env.DB, env.FILES).then((n) => { if (n) console.log(JSON.stringify({ job: "avatars_to_r2", moved: n })); }, () => undefined));
    if (now.getUTCHours() === 19 && now.getUTCMinutes() < 5) {
      ctx.waitUntil(
        Promise.all([runCleanup(env.DB, now), purgeOldEvents(env.DB, now), sweepAvatars(env.DB, env.FILES, now)]).then(([r, purged, swept]) => {
          console.log(JSON.stringify({ job: "cleanup", purged_members: r.purgedMembers, purged_webhook_events: purged, swept_avatar_files: swept }));
        }),
      );
    }
  },
} satisfies ExportedHandler<Env>;
