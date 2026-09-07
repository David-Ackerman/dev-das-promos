import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES, type QueueBundle, type ScheduledPublishJob } from "@dev-das-promos/queue";
import { type ConnectionOptions, Worker } from "bullmq";
import { publishReadyDeals } from "../services/scheduled-publish.js";

export function createScheduledPublishWorker(
  db: Database,
  queues: QueueBundle,
  connection: ConnectionOptions,
) {
  return new Worker(
    QUEUE_NAMES.scheduledPublish,
    async (job) => {
      const { limit } = job.data as ScheduledPublishJob;
      const result = await publishReadyDeals(db, queues, { limit });
      console.log(`[scheduled-publish] enqueued ${result.enqueued} deal(s) for publishing`);
      return result;
    },
    { connection },
  );
}
