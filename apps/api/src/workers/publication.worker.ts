import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES } from "@dev-das-promos/queue";
import type { PublicationChannel } from "@dev-das-promos/shared";
import { type ConnectionOptions, Worker } from "bullmq";
import { isScheduledDealAllowed } from "../lib/scheduled-job-policy.js";
import { publishDealToChannel } from "../services/publication.js";

export function createPublicationWorker(db: Database, connection: ConnectionOptions) {
  return new Worker(
    QUEUE_NAMES.publication,
    async (job) => {
      const { dealCandidateId, channel, scheduled } = job.data as {
        dealCandidateId: string;
        channel: PublicationChannel;
        scheduled?: boolean;
      };
      if (scheduled && !(await isScheduledDealAllowed(db, dealCandidateId))) {
        console.log(
          `[publication] skipped scheduled ${channel} post for ${dealCandidateId}: schedule is disabled or marketplace is no longer configured`,
        );
        return { status: "skipped" };
      }
      return publishDealToChannel(db, dealCandidateId, channel);
    },
    { connection },
  );
}
