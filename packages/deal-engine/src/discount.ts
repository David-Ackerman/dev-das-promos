import { clamp } from "@dev-das-promos/shared";
import type { DealScoringInput, RealDiscountResult } from "./types.js";

/**
 * Never trust a marketplace's advertised "was" price. Instead compute a
 * discount against an observed historical baseline, preferring the widest
 * available window first:
 *
 *   1. 90-day average price   (most representative of "normal" price)
 *   2. 30-day average price   (fallback when 90d history is thin)
 *   3. advertised original price (last resort, and the least trustworthy)
 *
 * When none are available there is nothing to compare against, so the
 * real discount is reported as 0 with confidence 0 -- callers should show
 * a "not enough data" signal rather than pretending this is a real deal.
 */
export function calculateRealDiscount(input: DealScoringInput): RealDiscountResult {
  const { currentPrice } = input;

  const sampleCount = input.priceHistorySampleCount ?? 0;

  if (input.avg90dPrice && input.avg90dPrice > 0) {
    const confidenceScore = clamp(60 + Math.min(sampleCount, 40), 0, 100);
    return {
      realDiscountPercentage: discountPercentage(input.avg90dPrice, currentPrice),
      baselineUsed: "90d_avg",
      baselinePrice: input.avg90dPrice,
      confidenceScore,
    };
  }

  if (input.avg30dPrice && input.avg30dPrice > 0) {
    const confidenceScore = clamp(35 + Math.min(sampleCount, 25), 0, 70);
    return {
      realDiscountPercentage: discountPercentage(input.avg30dPrice, currentPrice),
      baselineUsed: "30d_avg",
      baselinePrice: input.avg30dPrice,
      confidenceScore,
    };
  }

  if (input.advertisedOriginalPrice && input.advertisedOriginalPrice > currentPrice) {
    return {
      realDiscountPercentage: discountPercentage(input.advertisedOriginalPrice, currentPrice),
      baselineUsed: "advertised",
      baselinePrice: input.advertisedOriginalPrice,
      confidenceScore: 25,
    };
  }

  return {
    realDiscountPercentage: 0,
    baselineUsed: "none",
    baselinePrice: undefined,
    confidenceScore: 0,
  };
}

function discountPercentage(baseline: number, current: number): number {
  if (baseline <= 0) return 0;
  return clamp(((baseline - current) / baseline) * 100, -100, 100);
}

export function calculateAdvertisedDiscount(input: DealScoringInput): number | undefined {
  if (!input.advertisedOriginalPrice || input.advertisedOriginalPrice <= 0) return undefined;
  return discountPercentage(input.advertisedOriginalPrice, input.currentPrice);
}
