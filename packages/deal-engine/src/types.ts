import type { EstimateBasis } from "@dev-das-promos/shared";

/**
 * Everything the deal engine needs to score one offer. Framework/DB
 * independent on purpose: callers (ingestion pipeline, tests, seed
 * scripts) build this from whatever storage they use. All price fields
 * are integer cents.
 */
export interface DealScoringInput {
  /** Effective price the buyer actually pays (price + shipping - coupon). */
  currentPrice: number;
  /** Marketplace-advertised "was" / list price, if shown. Never trusted alone. */
  advertisedOriginalPrice?: number;
  avg7dPrice?: number;
  avg30dPrice?: number;
  avg90dPrice?: number;
  min30dPrice?: number;
  min90dPrice?: number;
  /** All-time lowest observed price, if known. */
  historicalMinPrice?: number;
  /** How many price observations back the historical figures above. */
  priceHistorySampleCount?: number;
  /** Fraction, e.g. 0.08 for 8%. */
  commissionRate?: number;
  /** Seller rating normalized 0-100. */
  sellerRating?: number;
  /** Popularity/demand signal normalized 0-100 (sales rank, review count, etc). */
  popularityScore?: number;
  /** Fraction, e.g. 0.03 for a 3% historical conversion rate. */
  historicalConversionRate?: number;
  capturedAt: Date;
}

export interface DealScoreComponents {
  discount: number;
  historicalDiscount: number;
  commission: number;
  seller: number;
  popularity: number;
  conversion: number;
  freshness: number;
}

export interface RealDiscountResult {
  realDiscountPercentage: number;
  /** Which baseline the "real" discount was computed against. */
  baselineUsed: "90d_avg" | "30d_avg" | "advertised" | "none";
  baselinePrice: number | undefined;
  /** 0-100: how much we trust this baseline (sample depth + recency). */
  confidenceScore: number;
}

export interface DealScoreResult {
  score: number;
  components: DealScoreComponents;
  realDiscountPercentage: number;
  advertisedDiscountPercentage: number | undefined;
  confidenceScore: number;
  signals: string[];
  reasoning: string;
}

export interface MonetizationInput {
  /** Effective price in cents. */
  effectivePrice: number;
  /** Fraction, e.g. 0.08 for 8%. */
  commissionRate: number;
  /** Assumed/observed audience size the content will reach. */
  estimatedImpressions?: number;
  /** Fraction, e.g. 0.02 for 2%. Falls back to a category/channel default. */
  predictedCtr?: number;
  /** Fraction, e.g. 0.02 for 2%. Falls back to a category/channel default. */
  predictedConversionRate?: number;
  /** When supplied, conversion assumption is marked "historical" instead of "heuristic". */
  historicalConversionRate?: number;
}

export interface MonetizationResult {
  estimatedEpc: number;
  estimatedRevenuePer1000Impressions: number;
  estimatedRevenue: number | undefined;
  basis: EstimateBasis;
}
