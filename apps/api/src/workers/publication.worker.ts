import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES } from "@dev-das-promos/queue";
import type { PublicationChannel } from "@dev-das-promos/shared";
import { type ConnectionOptions, Worker } from "bullmq";
import { publishDealToChannel } from "../services/publication.js";

export function createPublicationWorker(db: Database, connection: ConnectionOptions) {
  return new Worker(
    QUEUE_NAMES.publication,
    async (job) => {
      const { dealCandidateId, channel } = job.data as {
        dealCandidateId: string;
        channel: PublicationChannel;
      };
      return publishDealToChannel(db, dealCandidateId, channel);
    },
    { connection },
  );
}
