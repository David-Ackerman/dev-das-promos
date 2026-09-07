import type { MonetizationInput, MonetizationResult } from "./types.js";

/**
 * Global fallback assumptions used until we have observed
 * channel/category-specific CTR and conversion data. These are
 * intentionally conservative and clearly labeled "heuristic" in the
 * result so nobody downstream mistakes them for a measured figure. Once
 * packages/analytics has enough click/conversion volume per
 * channel+category, callers should pass `historicalConversionRate` (and,
 * later, an observed CTR) to flip the basis to "historical".
 */
export const DEFAULT_MONETIZATION_ASSUMPTIONS = {
  predictedCtr: 0.02,
  predictedConversionRate: 0.02,
};

/**
 * estimatedRevenue = impressions * CTR * conversionRate * price * commissionRate
 *
 * estimatedEpc (earnings per CLICK, not impression) therefore drops the
 * CTR term: a click has already happened.
 * estimatedRevenuePer1000Impressions applies the full formula at
 * impressions = 1000.
 */
export function estimateMonetization(input: MonetizationInput): MonetizationResult {
  const ctr = input.predictedCtr ?? DEFAULT_MONETIZATION_ASSUMPTIONS.predictedCtr;
  const conversionRate =
    input.historicalConversionRate ??
    input.predictedConversionRate ??
    DEFAULT_MONETIZATION_ASSUMPTIONS.predictedConversionRate;

  const basis = input.historicalConversionRate !== undefined ? "historical" : "heuristic";

  const estimatedEpc = conversionRate * input.effectivePrice * input.commissionRate;
  const estimatedRevenuePer1000Impressions =
    1000 * ctr * conversionRate * input.effectivePrice * input.commissionRate;

  const estimatedRevenue =
    input.estimatedImpressions !== undefined
      ? input.estimatedImpressions *
        ctr *
        conversionRate *
        input.effectivePrice *
        input.commissionRate
      : undefined;

  return {
    estimatedEpc: Math.round(estimatedEpc),
    estimatedRevenuePer1000Impressions: Math.round(estimatedRevenuePer1000Impressions),
    estimatedRevenue: estimatedRevenue !== undefined ? Math.round(estimatedRevenue) : undefined,
    basis,
  };
}
