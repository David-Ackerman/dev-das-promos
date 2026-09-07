import type { Database } from "@dev-das-promos/database";
import { type OfferIngestionJob, QUEUE_NAMES, type QueueBundle } from "@dev-das-promos/queue";
import { type ConnectionOptions, Worker } from "bullmq";
import { ingestMarketplaceOffers } from "../services/ingestion.js";

export function createOfferIngestionWorker(
  db: Database,
  queues: QueueBundle,
  connection: ConnectionOptions,
) {
  return new Worker(
    QUEUE_NAMES.offerIngestion,
    async (job) => {
      const { marketplace, category } = job.data as OfferIngestionJob;
      const result = await ingestMarketplaceOffers(db, queues, marketplace, { category });
      return result;
    },
    { connection },
  );
}
