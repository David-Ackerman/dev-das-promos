import { DEFAULT_DEAL_SCORE_WEIGHTS, type DealScoreWeights } from "@dev-das-promos/config";
import { roundTo } from "@dev-das-promos/shared";
import {
  commissionScore,
  conversionScore,
  discountScore,
  freshnessScore,
  historicalDiscountScore,
  popularityScore,
  sellerScore,
} from "./components.js";
import { calculateAdvertisedDiscount, calculateRealDiscount } from "./discount.js";
import type { DealScoreResult, DealScoringInput } from "./types.js";

/**
 * Scores one offer. Pure function: same input always produces the same
 * output, which is what lets us unit test it exhaustively and re-run it
 * deterministically from the "Re-evaluate" admin action.
 */
export function scoreDeal(
  input: DealScoringInput,
  weights: DealScoreWeights = DEFAULT_DEAL_SCORE_WEIGHTS,
  now: Date = new Date(),
): DealScoreResult {
  const realDiscount = calculateRealDiscount(input);
  const advertisedDiscountPercentage = calculateAdvertisedDiscount(input);

  const historical = historicalDiscountScore(realDiscount, input);
  const discount = discountScore(advertisedDiscountPercentage, historical.score);
  const commission = commissionScore(input.commissionRate);
  const seller = sellerScore(input.sellerRating);
  const popularity = popularityScore(input.popularityScore);
  const conversion = conversionScore(input.historicalConversionRate);
  const freshness = freshnessScore(input.capturedAt, now);

  const components = {
    discount: roundTo(discount.score, 1),
    historicalDiscount: roundTo(historical.score, 1),
    commission: roundTo(commission.score, 1),
    seller: roundTo(seller.score, 1),
    popularity: roundTo(popularity.score, 1),
    conversion: roundTo(conversion.score, 1),
    freshness: roundTo(freshness.score, 1),
  };

  const rawScore =
    components.historicalDiscount * weights.historicalDiscount +
    components.discount * weights.discount +
    components.commission * weights.commission +
    components.seller * weights.seller +
    components.popularity * weights.popularity +
    components.conversion * weights.conversion +
    components.freshness * weights.freshness;

  const signals = dedupe([
    ...historical.signals,
    ...discount.signals,
    ...commission.signals,
    ...seller.signals,
    ...popularity.signals,
    ...conversion.signals,
    ...freshness.signals,
  ]);

  const score = roundTo(clampScore(rawScore), 1);

  return {
    score,
    components,
    realDiscountPercentage: roundTo(realDiscount.realDiscountPercentage, 1),
    advertisedDiscountPercentage:
      advertisedDiscountPercentage !== undefined
        ? roundTo(advertisedDiscountPercentage, 1)
        : undefined,
    confidenceScore: roundTo(realDiscount.confidenceScore, 1),
    signals,
    reasoning: buildReasoning(score, realDiscount.realDiscountPercentage, signals),
  };
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function buildReasoning(score: number, realDiscountPercentage: number, signals: string[]): string {
  const parts: string[] = [];
  parts.push(`Score ${score.toFixed(1)}/100.`);
  if (realDiscountPercentage > 0) {
    parts.push(`${realDiscountPercentage.toFixed(1)}% below the historical baseline price.`);
  } else {
    parts.push("No meaningful discount versus the historical baseline price.");
  }
  if (signals.includes("ALL_TIME_LOW")) parts.push("This is the lowest price ever observed.");
  else if (signals.includes("LOWEST_PRICE_90D"))
    parts.push("Lowest price seen in the last 90 days.");
  if (signals.includes("HIGH_COMMISSION_CATEGORY")) parts.push("High-commission category.");
  if (signals.includes("SELLER_RATING_LOW")) parts.push("Seller rating is below average.");
  if (signals.includes("PRICE_HISTORY_INSUFFICIENT")) {
    parts.push("Not enough price history to confirm this is a genuine discount.");
  }
  return parts.join(" ");
}
