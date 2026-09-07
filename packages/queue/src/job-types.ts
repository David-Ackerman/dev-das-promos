import type { Marketplace, PublicationChannel } from "@dev-das-promos/shared";

export interface OfferIngestionJob {
  marketplace: Marketplace;
  /** When set, ingest only this category; otherwise the provider's whole mock catalog. */
  category?: string;
}

export interface DealEvaluationJob {
  offerId: string;
}

export interface ContentGenerationJob {
  dealCandidateId: string;
}

export interface PublicationJob {
  dealCandidateId: string;
  channel: PublicationChannel;
}

export interface AnalyticsProcessingJob {
  /** ISO date (yyyy-mm-dd) to (re)compute daily rollups for; defaults to "today" when absent. */
  date?: string;
}

export interface ScheduledPublishJob {
  /** Max deals to enqueue for publishing in this run; defaults to a small batch. */
  limit?: number;
}

export interface JobPayloadMap {
  "offer-ingestion": OfferIngestionJob;
  "deal-evaluation": DealEvaluationJob;
  "content-generation": ContentGenerationJob;
  publication: PublicationJob;
  "analytics-processing": AnalyticsProcessingJob;
  "scheduled-publish": ScheduledPublishJob;
}
