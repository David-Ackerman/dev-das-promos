import { describe, expect, it } from "vitest";
import { estimateMonetization } from "../monetization.js";

describe("estimateMonetization", () => {
  it("marks the estimate heuristic when no historical conversion rate is supplied", () => {
    const result = estimateMonetization({ effectivePrice: 10_000, commissionRate: 0.1 });
    expect(result.basis).toBe("heuristic");
  });

  it("marks the estimate historical when a historical conversion rate is supplied", () => {
    const result = estimateMonetization({
      effectivePrice: 10_000,
      commissionRate: 0.1,
      historicalConversionRate: 0.05,
    });
    expect(result.basis).toBe("historical");
  });

  it("computes EPC as conversionRate * price * commissionRate (no CTR term)", () => {
    const result = estimateMonetization({
      effectivePrice: 10_000,
      commissionRate: 0.1,
      predictedConversionRate: 0.02,
    });
    // 0.02 * 10000 * 0.1 = 20
    expect(result.estimatedEpc).toBe(20);
  });

  it("computes RPM as the full formula at 1000 impressions", () => {
    const result = estimateMonetization({
      effectivePrice: 10_000,
      commissionRate: 0.1,
      predictedCtr: 0.02,
      predictedConversionRate: 0.02,
    });
    // 1000 * 0.02 * 0.02 * 10000 * 0.1 = 400
    expect(result.estimatedRevenuePer1000Impressions).toBe(400);
  });

  it("only computes estimatedRevenue when impressions are supplied", () => {
    const withoutImpressions = estimateMonetization({
      effectivePrice: 10_000,
      commissionRate: 0.1,
    });
    expect(withoutImpressions.estimatedRevenue).toBeUndefined();

    const withImpressions = estimateMonetization({
      effectivePrice: 10_000,
      commissionRate: 0.1,
      estimatedImpressions: 5000,
      predictedCtr: 0.02,
      predictedConversionRate: 0.02,
    });
    // 5000 * 0.02 * 0.02 * 10000 * 0.1 = 2000
    expect(withImpressions.estimatedRevenue).toBe(2000);
  });

  it("never returns negative values for zero-priced or zero-commission input", () => {
    const result = estimateMonetization({ effectivePrice: 0, commissionRate: 0 });
    expect(result.estimatedEpc).toBe(0);
    expect(result.estimatedRevenuePer1000Impressions).toBe(0);
  });
});
