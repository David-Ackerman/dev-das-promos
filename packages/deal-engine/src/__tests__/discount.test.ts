import { describe, expect, it } from "vitest";
import { calculateAdvertisedDiscount, calculateRealDiscount } from "../discount.js";
import type { DealScoringInput } from "../types.js";

function baseInput(overrides: Partial<DealScoringInput> = {}): DealScoringInput {
  return {
    currentPrice: 10_000,
    capturedAt: new Date(),
    ...overrides,
  };
}

describe("calculateRealDiscount", () => {
  it("prefers the 90-day average baseline when available", () => {
    const result = calculateRealDiscount(
      baseInput({ currentPrice: 8_000, avg90dPrice: 10_000, avg30dPrice: 9_000 }),
    );
    expect(result.baselineUsed).toBe("90d_avg");
    expect(result.baselinePrice).toBe(10_000);
    expect(result.realDiscountPercentage).toBeCloseTo(20, 5);
  });

  it("falls back to the 30-day average when 90d data is missing", () => {
    const result = calculateRealDiscount(baseInput({ currentPrice: 9_000, avg30dPrice: 10_000 }));
    expect(result.baselineUsed).toBe("30d_avg");
    expect(result.realDiscountPercentage).toBeCloseTo(10, 5);
  });

  it("falls back to the advertised price only when nothing else is available", () => {
    const result = calculateRealDiscount(
      baseInput({ currentPrice: 7_500, advertisedOriginalPrice: 10_000 }),
    );
    expect(result.baselineUsed).toBe("advertised");
    expect(result.realDiscountPercentage).toBeCloseTo(25, 5);
    expect(result.confidenceScore).toBeLessThan(30);
  });

  it("ignores an advertised price that is not actually higher than current price", () => {
    const result = calculateRealDiscount(
      baseInput({ currentPrice: 10_000, advertisedOriginalPrice: 9_000 }),
    );
    expect(result.baselineUsed).toBe("none");
    expect(result.realDiscountPercentage).toBe(0);
    expect(result.confidenceScore).toBe(0);
  });

  it("reports no baseline and zero confidence when there is no historical data at all", () => {
    const result = calculateRealDiscount(baseInput());
    expect(result.baselineUsed).toBe("none");
    expect(result.confidenceScore).toBe(0);
  });

  it("gives higher confidence to 90d baselines backed by more samples", () => {
    const thin = calculateRealDiscount(
      baseInput({ currentPrice: 9_000, avg90dPrice: 10_000, priceHistorySampleCount: 2 }),
    );
    const rich = calculateRealDiscount(
      baseInput({ currentPrice: 9_000, avg90dPrice: 10_000, priceHistorySampleCount: 60 }),
    );
    expect(rich.confidenceScore).toBeGreaterThan(thin.confidenceScore);
  });

  it("clamps discount percentage and never goes negative from a price increase context", () => {
    const result = calculateRealDiscount(baseInput({ currentPrice: 12_000, avg90dPrice: 10_000 }));
    expect(result.realDiscountPercentage).toBeLessThan(0);
    expect(result.realDiscountPercentage).toBeGreaterThanOrEqual(-100);
  });
});

describe("calculateAdvertisedDiscount", () => {
  it("returns undefined when there is no advertised price", () => {
    expect(calculateAdvertisedDiscount(baseInput())).toBeUndefined();
  });

  it("computes the naive discount off the advertised price", () => {
    const pct = calculateAdvertisedDiscount(
      baseInput({ currentPrice: 8_000, advertisedOriginalPrice: 10_000 }),
    );
    expect(pct).toBeCloseTo(20, 5);
  });
});
