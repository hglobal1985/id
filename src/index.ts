import { createApp } from "./app";
import type { Env } from "./env";
import { runCleanup } from "./jobs/cleanup";
import { deliverDue, purgeOldEvents } from "./db/webhooks";
import { requeueUnreviewed } from "./jobs/requeue";
import { runUptime } from "./jobs/uptime";
import { runErrorDigest } from "./jobs/error-digest";
import { runWeeklyBackup } from "./jobs/backup";
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
    ctx.waitUntil(moveAvatarsToR2(env.DB, env.FILES).then(
        (r) => { if (r.moved || r.failed.length) console.log(JSON.stringify({ job: "avatars_to_r2", moved: r.moved, failed: r.failed })); },
        (e) => console.log(JSON.stringify({ job: "avatars_to_r2", error: e instanceof Error ? e.name + ":" + e.message.slice(0, 120) : "error" })),
      ));
    // 網站自動巡檢（依後台「系統功能」設定的頻率；失敗不影響其他排程工作）。
    const mailer = env.EMAIL && env.EMAIL_FROM ? { binding: env.EMAIL, from: env.EMAIL_FROM, name: "會員中心" } : undefined;
    if (env.ENVIRONMENT === "production") ctx.waitUntil(runUptime(env.DB, mailer, (u, i) => fetch(u, i), now).then((n) => { if (n) console.log(JSON.stringify({ job: "uptime", probed: n })); }, () => console.log(JSON.stringify({ job: "uptime", error: true }))));
    if (env.ENVIRONMENT === "production") ctx.waitUntil(runErrorDigest(env.DB, mailer, now).then((n) => { if (n) console.log(JSON.stringify({ job: "error_digest", errors: n })); }, () => console.log(JSON.stringify({ job: "error_digest", error: true }))));
    if (env.ENVIRONMENT === "production") ctx.waitUntil(runWeeklyBackup(env.DB, env.FILES, now).then((n) => { if (n) console.log(JSON.stringify({ job: "weekly_backup", rows: n })); }, () => console.log(JSON.stringify({ job: "weekly_backup", error: true }))));
    if (now.getUTCHours() === 19 && now.getUTCMinutes() < 5) {
      ctx.waitUntil(
        Promise.all([runCleanup(env.DB, now), purgeOldEvents(env.DB, now), sweepAvatars(env.DB, env.FILES, now)]).then(([r, purged, swept]) => {
          console.log(JSON.stringify({ job: "cleanup", purged_members: r.purgedMembers, purged_webhook_events: purged, swept_avatar_files: swept }));
        }),
      );
    }
  },
} satisfies ExportedHandler<Env>;
