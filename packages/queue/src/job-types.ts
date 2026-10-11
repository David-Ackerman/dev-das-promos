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
  /** Restrict regeneration to one channel when an operator retries a publication. */
  channel?: PublicationChannel;
  /** True for work created by the automatic schedule; used by its kill switch. */
  scheduled?: boolean;
}

export interface PublicationJob {
  dealCandidateId: string;
  channel: PublicationChannel;
  /** True for work created by the automatic schedule; used by its kill switch. */
  scheduled?: boolean;
}

export interface AnalyticsProcessingJob {
  /** ISO date (yyyy-mm-dd) to (re)compute daily rollups for; defaults to "today" when absent. */
  date?: string;
}

export interface ScheduledPublishJob {
  /** Max deals to enqueue for publishing in this run; defaults to a small batch. */
  limit?: number;
  /** Restrict automatic publishing to the marketplaces ingested by this schedule. */
  marketplaces?: Marketplace[];
}

export interface JobPayloadMap {
  "offer-ingestion": OfferIngestionJob;
  "deal-evaluation": DealEvaluationJob;
  "content-generation": ContentGenerationJob;
  publication: PublicationJob;
  "analytics-processing": AnalyticsProcessingJob;
  "scheduled-publish": ScheduledPublishJob;
}
