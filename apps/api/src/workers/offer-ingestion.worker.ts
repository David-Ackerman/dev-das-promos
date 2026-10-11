import type { Database } from "@dev-das-promos/database";
import { type OfferIngestionJob, QUEUE_NAMES, type QueueBundle } from "@dev-das-promos/queue";
import { type ConnectionOptions, Worker } from "bullmq";
import { env } from "../env.js";
import { scheduleConfigFromEnv } from "../lib/scheduler.js";
import { ingestMarketplaceOffers } from "../services/ingestion.js";

export function createOfferIngestionWorker(
  db: Database,
  queues: QueueBundle,
  connection: ConnectionOptions,
) {
  return new Worker(
    QUEUE_NAMES.offerIngestion,
    async (job) => {
      if (job.name === "scheduled-ingest") {
        const marketplace = job.data.marketplace;
        const stillConfigured = scheduleConfigFromEnv(env).marketplaces.includes(marketplace);
        if (!env.SCHEDULE_ENABLED || !stillConfigured) {
          const reason = env.SCHEDULE_ENABLED
            ? "marketplace is no longer configured"
            : "schedule is disabled";
          console.log(`[offer-ingestion] skipped scheduled ${marketplace} run: ${reason}`);
          return { marketplace, offersIngested: 0, offerIds: [], skipped: true };
        }
      }
      const { marketplace, category } = job.data as OfferIngestionJob;
      const result = await ingestMarketplaceOffers(db, queues, marketplace, { category });
      return result;
    },
    { connection },
  );
}
