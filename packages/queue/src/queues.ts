import { type ConnectionOptions, Queue } from "bullmq";
import type { JobPayloadMap } from "./job-types.js";
import { QUEUE_NAMES, type QueueName } from "./queue-names.js";

export interface QueueBundle {
  offerIngestion: Queue<JobPayloadMap["offer-ingestion"]>;
  dealEvaluation: Queue<JobPayloadMap["deal-evaluation"]>;
  contentGeneration: Queue<JobPayloadMap["content-generation"]>;
  publication: Queue<JobPayloadMap["publication"]>;
  analyticsProcessing: Queue<JobPayloadMap["analytics-processing"]>;
  scheduledPublish: Queue<JobPayloadMap["scheduled-publish"]>;
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
} as const;

export function createQueues(connection: ConnectionOptions): QueueBundle {
  return {
    offerIngestion: new Queue(QUEUE_NAMES.offerIngestion, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    dealEvaluation: new Queue(QUEUE_NAMES.dealEvaluation, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    contentGeneration: new Queue(QUEUE_NAMES.contentGeneration, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    publication: new Queue(QUEUE_NAMES.publication, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    analyticsProcessing: new Queue(QUEUE_NAMES.analyticsProcessing, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    scheduledPublish: new Queue(QUEUE_NAMES.scheduledPublish, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
  };
}

export async function closeQueues(queues: QueueBundle): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
}

export type { QueueName };
export { QUEUE_NAMES };
