import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES, type QueueBundle, type Redis } from "@dev-das-promos/queue";
import type { PublicationChannel } from "@dev-das-promos/shared";
import { Worker } from "bullmq";
import { isScheduledDealAllowed } from "../lib/scheduled-job-policy.js";
import { generateContentForDeal } from "../services/content-generation.js";

export function createContentGenerationWorker(
  db: Database,
  queues: QueueBundle,
  connection: Redis,
) {
  return new Worker(
    QUEUE_NAMES.contentGeneration,
    async (job) => {
      const { dealCandidateId, scheduled, channel } = job.data as {
        dealCandidateId: string;
        channel?: PublicationChannel;
        scheduled?: boolean;
      };
      if (scheduled && !(await isScheduledDealAllowed(db, dealCandidateId))) {
        console.log(
          `[content-generation] skipped scheduled deal ${dealCandidateId}: schedule is disabled or marketplace is no longer configured`,
        );
        return { skipped: true };
      }
      await generateContentForDeal(db, queues, dealCandidateId, connection, { scheduled, channel });
    },
    { connection },
  );
}
