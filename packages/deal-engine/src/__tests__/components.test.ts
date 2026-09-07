import { describe, expect, it } from "vitest";
import {
  commissionScore,
  conversionScore,
  freshnessScore,
  popularityScore,
  scoreFromDiscountPercentage,
  sellerScore,
} from "../components.js";

describe("scoreFromDiscountPercentage", () => {
  it("maps 0% to a score of 0", () => {
    expect(scoreFromDiscountPercentage(0)).toBe(0);
  });

  it("saturates at 100 for discounts of 40% or more", () => {
    expect(scoreFromDiscountPercentage(40)).toBe(100);
    expect(scoreFromDiscountPercentage(80)).toBe(100);
  });

  it("scales linearly between 0 and the saturation point", () => {
    expect(scoreFromDiscountPercentage(20)).toBeCloseTo(50, 5);
  });

  it("never returns a negative score for a price increase", () => {
    expect(scoreFromDiscountPercentage(-10)).toBe(0);
  });
});

describe("commissionScore", () => {
  it("uses a neutral default and flags unknown commission", () => {
    const { score, signals } = commissionScore(undefined);
    expect(score).toBe(50);
    expect(signals).toContain("COMMISSION_RATE_UNKNOWN");
  });

  it("flags high-commission categories", () => {
    const { score, signals } = commissionScore(0.15);
    expect(score).toBe(100);
    expect(signals).toContain("HIGH_COMMISSION_CATEGORY");
  });

  it("scales proportionally below saturation", () => {
    const { score } = commissionScore(0.06);
    expect(score).toBeCloseTo(50, 5);
  });
});

describe("sellerScore", () => {
  it("flags low seller ratings", () => {
    const { score, signals } = sellerScore(55);
    expect(score).toBe(55);
    expect(signals).toContain("SELLER_RATING_LOW");
  });

  it("does not flag ratings at or above the threshold", () => {
    const { signals } = sellerScore(85);
    expect(signals).not.toContain("SELLER_RATING_LOW");
  });

  it("uses a neutral default when unknown", () => {
    const { score, signals } = sellerScore(undefined);
    expect(score).toBe(60);
    expect(signals).toContain("SELLER_RATING_UNKNOWN");
  });
});

describe("popularityScore", () => {
  it("clamps out-of-range input", () => {
    expect(popularityScore(150).score).toBe(100);
    expect(popularityScore(-20).score).toBe(0);
  });
});

describe("conversionScore", () => {
  it("saturates at the benchmark conversion rate", () => {
    expect(conversionScore(0.03).score).toBe(100);
    expect(conversionScore(0.06).score).toBe(100);
  });

  it("defaults to neutral when unavailable", () => {
    const { score, signals } = conversionScore(undefined);
    expect(score).toBe(50);
    expect(signals).toContain("CONVERSION_DATA_UNAVAILABLE");
  });
});

describe("freshnessScore", () => {
  const now = new Date("2026-08-24T12:00:00Z");

  it("scores a just-captured offer at 100", () => {
    expect(freshnessScore(now, now).score).toBe(100);
  });

  it("decays linearly over 24 hours", () => {
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    expect(freshnessScore(twelveHoursAgo, now).score).toBeCloseTo(50, 5);
  });

  it("flags stale offers older than the decay window", () => {
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const { score, signals } = freshnessScore(twoDaysAgo, now);
    expect(score).toBe(0);
    expect(signals).toContain("STALE_OFFER");
  });
});
