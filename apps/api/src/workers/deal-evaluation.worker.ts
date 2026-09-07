import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES } from "@dev-das-promos/queue";
import { type ConnectionOptions, Worker } from "bullmq";
import { evaluateOffer } from "../services/deal-evaluation.js";

export function createDealEvaluationWorker(db: Database, connection: ConnectionOptions) {
  return new Worker(
    QUEUE_NAMES.dealEvaluation,
    async (job) => {
      const { offerId } = job.data as { offerId: string };
      return evaluateOffer(db, offerId);
    },
    { connection },
  );
}
