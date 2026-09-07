import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES, type QueueBundle, type Redis } from "@dev-das-promos/queue";
import { Worker } from "bullmq";
import { generateContentForDeal } from "../services/content-generation.js";

export function createContentGenerationWorker(
  db: Database,
  queues: QueueBundle,
  connection: Redis,
) {
  return new Worker(
    QUEUE_NAMES.contentGeneration,
    async (job) => {
      const { dealCandidateId } = job.data as { dealCandidateId: string };
      await generateContentForDeal(db, queues, dealCandidateId, connection);
    },
    { connection },
  );
}
