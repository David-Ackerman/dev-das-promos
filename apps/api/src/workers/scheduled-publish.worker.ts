import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES, type QueueBundle, type ScheduledPublishJob } from "@dev-das-promos/queue";
import { type ConnectionOptions, Worker } from "bullmq";
import { env } from "../env.js";
import { scheduleConfigFromEnv } from "../lib/scheduler.js";
import { publishReadyDeals } from "../services/scheduled-publish.js";

export function createScheduledPublishWorker(
  db: Database,
  queues: QueueBundle,
  connection: ConnectionOptions,
) {
  return new Worker(
    QUEUE_NAMES.scheduledPublish,
    async (job) => {
      if (!env.SCHEDULE_ENABLED) {
        console.log("[scheduled-publish] skipped queued schedule: schedule is disabled");
        return { enqueued: 0, dealCandidateIds: [], skipped: true };
      }
      const configured = scheduleConfigFromEnv(env);
      const queued = job.data as ScheduledPublishJob;
      const marketplaces = queued.marketplaces
        ? queued.marketplaces.filter((marketplace) => configured.marketplaces.includes(marketplace))
        : configured.marketplaces;
      if (marketplaces.length === 0) {
        console.log(
          "[scheduled-publish] skipped queued schedule: no queued marketplaces remain configured",
        );
        return { enqueued: 0, dealCandidateIds: [], skipped: true };
      }

      const result = await publishReadyDeals(db, queues, {
        limit: Math.min(queued.limit ?? configured.publishLimit, configured.publishLimit),
        marketplaces,
      });
      console.log(`[scheduled-publish] enqueued ${result.enqueued} deal(s) for publishing`);
      return result;
    },
    { connection },
  );
}
