import { DEFAULT_DEAL_SCORE_WEIGHTS } from "@dev-das-promos/config";
import { describe, expect, it } from "vitest";
import { scoreDeal } from "../scoring.js";
import type { DealScoringInput } from "../types.js";

const NOW = new Date("2026-08-24T12:00:00Z");

function excellentDealInput(): DealScoringInput {
  return {
    currentPrice: 6_000,
    advertisedOriginalPrice: 10_000,
    avg90dPrice: 10_000,
    min90dPrice: 6_000,
    historicalMinPrice: 6_000,
    priceHistorySampleCount: 45,
    commissionRate: 0.15,
    sellerRating: 95,
    popularityScore: 90,
    historicalConversionRate: 0.04,
    capturedAt: NOW,
  };
}

function weakDealInput(): DealScoringInput {
  return {
    currentPrice: 9_900,
    advertisedOriginalPrice: 10_000,
    avg90dPrice: 10_000,
    priceHistorySampleCount: 30,
    commissionRate: 0.01,
    sellerRating: 40,
    popularityScore: 10,
    historicalConversionRate: 0.001,
    capturedAt: new Date(NOW.getTime() - 72 * 60 * 60 * 1000),
  };
}

describe("scoreDeal", () => {
  it("scores an excellent, well-documented deal near the top of the range", () => {
    const result = scoreDeal(excellentDealInput(), DEFAULT_DEAL_SCORE_WEIGHTS, NOW);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.signals).toContain("ALL_TIME_LOW");
    expect(result.signals).toContain("HIGH_COMMISSION_CATEGORY");
  });

  it("scores a weak, stale, low-commission deal near the bottom of the range", () => {
    const result = scoreDeal(weakDealInput(), DEFAULT_DEAL_SCORE_WEIGHTS, NOW);
    expect(result.score).toBeLessThan(30);
    expect(result.signals).toContain("STALE_OFFER");
    expect(result.signals).toContain("SELLER_RATING_LOW");
  });

  it("always returns a score within [0, 100]", () => {
    const inputs: DealScoringInput[] = [
      { currentPrice: 0, capturedAt: NOW },
      { currentPrice: 999_999_999, avg90dPrice: 1, capturedAt: NOW },
      excellentDealInput(),
      weakDealInput(),
    ];
    for (const input of inputs) {
      const { score } = scoreDeal(input, DEFAULT_DEAL_SCORE_WEIGHTS, NOW);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("weights components according to the supplied configuration, not hidden constants", () => {
    const input = excellentDealInput();
    const defaultResult = scoreDeal(input, DEFAULT_DEAL_SCORE_WEIGHTS, NOW);
    const historicalOnlyWeights = {
      historicalDiscount: 1,
      discount: 0,
      commission: 0,
      seller: 0,
      popularity: 0,
      conversion: 0,
      freshness: 0,
    };
    const historicalOnlyResult = scoreDeal(input, historicalOnlyWeights, NOW);
    expect(historicalOnlyResult.score).toBeCloseTo(
      historicalOnlyResult.components.historicalDiscount,
      1,
    );
    expect(historicalOnlyResult.score).not.toBeCloseTo(defaultResult.score, 1);
  });

  it("flags insufficient price history and produces a low historical-discount component", () => {
    const result = scoreDeal(
      { currentPrice: 5_000, capturedAt: NOW },
      DEFAULT_DEAL_SCORE_WEIGHTS,
      NOW,
    );
    expect(result.signals).toContain("PRICE_HISTORY_INSUFFICIENT");
    expect(result.components.historicalDiscount).toBe(0);
    expect(result.confidenceScore).toBe(0);
  });

  it("is deterministic: identical input always produces identical output", () => {
    const input = excellentDealInput();
    const first = scoreDeal(input, DEFAULT_DEAL_SCORE_WEIGHTS, NOW);
    const second = scoreDeal(input, DEFAULT_DEAL_SCORE_WEIGHTS, NOW);
    expect(second).toEqual(first);
  });

  it("produces a non-empty human-readable reasoning string", () => {
    const result = scoreDeal(excellentDealInput(), DEFAULT_DEAL_SCORE_WEIGHTS, NOW);
    expect(result.reasoning.length).toBeGreaterThan(10);
  });
});
