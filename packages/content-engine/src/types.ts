import type { Marketplace, PublicationChannel } from "@dev-das-promos/shared";

/**
 * Everything a content template is allowed to use. Deliberately flat and
 * fully-supplied by the caller: templates must never invent facts, so
 * there is no lookup or enrichment inside content-engine itself -- only
 * string formatting of exactly what's passed in.
 */
export interface DealContentInput {
  productName: string;
  brand?: string;
  marketplace: Marketplace;
  sellerName?: string;
  currency: string;
  effectivePriceCents: number;
  originalPriceCents?: number;
  baselinePriceCents?: number;
  baselineLabel?: string;
  realDiscountPercentage: number;
  dealScore: number;
  scoreLabel: string;
  signals: string[];
  reasoning?: string;
  /** Public /go/:code short link -- the only link ever placed in generated content. */
  goUrl: string;
}

export interface GeneratedDealContent {
  telegram: string;
  x: string;
  webSummary: string;
}

/**
 * Isolation boundary for AI integrations. The default implementation
 * (TemplateContentGenerator) is fully deterministic and calls no
 * external service. A future Anthropic/OpenAI-backed generator implements
 * this same interface and can be swapped in via config without touching
 * any caller.
 */
export interface ContentGenerator {
  generateDealContent(input: DealContentInput): Promise<GeneratedDealContent>;
}

export interface PublicationPayload {
  dealCandidateId: string;
  channel: PublicationChannel;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface PublicationResult {
  status: "published" | "failed";
  externalPublicationId?: string;
  errorMessage?: string;
  publishedAt?: Date;
}

/**
 * Common contract for shipping content to a channel. Adding WhatsApp,
 * Threads, email, or Instagram later means implementing this interface
 * once and registering it -- the publication queue/worker never depends
 * on a concrete channel.
 */
export interface Publisher {
  channel: PublicationChannel;
  publish(payload: PublicationPayload): Promise<PublicationResult>;
}
