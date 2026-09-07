/**
 * One BullMQ queue per pipeline stage (see docs/architecture.md). Kept as
 * a small fixed set on purpose -- this is a modular monolith, not a
 * microservice mesh: all queues are processed by worker functions running
 * inside the apps/api process for the MVP (see apps/api/src/workers).
 */
export const QUEUE_NAMES = {
  offerIngestion: "offer-ingestion",
  dealEvaluation: "deal-evaluation",
  contentGeneration: "content-generation",
  publication: "publication",
  analyticsProcessing: "analytics-processing",
  scheduledPublish: "scheduled-publish",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
