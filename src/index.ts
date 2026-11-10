import { createApp } from "./app";
import type { Env } from "./env";
import { runCleanup } from "./jobs/cleanup";

const app = createApp();

export default {
  fetch: app.fetch,
  // Daily cron (wrangler.jsonc `triggers.crons`): housekeeping and the 1-year retention rule.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCleanup(env.DB, new Date()).then((r) => {
        console.log(JSON.stringify({ job: "cleanup", purged_members: r.purgedMembers }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
