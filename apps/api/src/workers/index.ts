import type { Database } from "@dev-das-promos/database";
import type { QueueBundle, Redis } from "@dev-das-promos/queue";
import { createAnalyticsProcessingWorker } from "./analytics-processing.worker.js";
import { createContentGenerationWorker } from "./content-generation.worker.js";
import { createDealEvaluationWorker } from "./deal-evaluation.worker.js";
import { createOfferIngestionWorker } from "./offer-ingestion.worker.js";
import { createPublicationWorker } from "./publication.worker.js";
import { createScheduledPublishWorker } from "./scheduled-publish.worker.js";

export function startWorkers(db: Database, queues: QueueBundle, connection: Redis) {
  const workers = [
    createOfferIngestionWorker(db, queues, connection),
    createDealEvaluationWorker(db, connection),
    createContentGenerationWorker(db, queues, connection),
    createPublicationWorker(db, connection),
    createAnalyticsProcessingWorker(db, connection),
    createScheduledPublishWorker(db, queues, connection),
  ];

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      console.error(`[worker:${worker.name}] job ${job?.id} failed:`, error);
    });
  }

  return {
    workers,
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
