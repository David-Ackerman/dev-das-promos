import { describe, expect, it } from "vitest";
import { type AffiliateProgramLike, resolveCommissionRate } from "../commission.js";

const AT = new Date("2026-06-01T00:00:00Z");

function program(overrides: Partial<AffiliateProgramLike>): AffiliateProgramLike {
  return {
    marketplace: "amazon_br",
    categoryId: null,
    commissionRateBps: 500,
    extraCommissionRateBps: 0,
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: null,
    ...overrides,
  };
}

describe("resolveCommissionRate", () => {
  it("returns the default program rate when no category-specific program exists", () => {
    const programs = [program({ commissionRateBps: 800 })];
    const result = resolveCommissionRate(programs, {
      marketplace: "amazon_br",
      categoryId: "gaming",
      at: AT,
    });
    expect(result.source).toBe("default");
    expect(result.rate).toBeCloseTo(0.08, 5);
  });

  it("prefers a category-specific program over the default", () => {
    const programs = [
      program({ commissionRateBps: 500 }),
      program({ commissionRateBps: 1200, categoryId: "gaming" }),
    ];
    const result = resolveCommissionRate(programs, {
      marketplace: "amazon_br",
      categoryId: "gaming",
      at: AT,
    });
    expect(result.source).toBe("category");
    expect(result.rate).toBeCloseTo(0.12, 5);
  });

  it("includes extra/bonus commission in the resolved rate", () => {
    const programs = [program({ commissionRateBps: 500, extraCommissionRateBps: 300 })];
    const result = resolveCommissionRate(programs, { marketplace: "amazon_br", at: AT });
    expect(result.rate).toBeCloseTo(0.08, 5);
    expect(result.baseRateBps).toBe(500);
    expect(result.extraRateBps).toBe(300);
  });

  it("ignores programs outside their validity window", () => {
    const expired = program({
      commissionRateBps: 1500,
      validFrom: new Date("2025-01-01"),
      validUntil: new Date("2025-12-31"),
    });
    const current = program({ commissionRateBps: 600 });
    const result = resolveCommissionRate([expired, current], { marketplace: "amazon_br", at: AT });
    expect(result.rate).toBeCloseTo(0.06, 5);
  });

  it("ignores programs for a different marketplace", () => {
    const shopeeOnly = program({ marketplace: "shopee_br", commissionRateBps: 900 });
    const result = resolveCommissionRate([shopeeOnly], { marketplace: "amazon_br", at: AT });
    expect(result.source).toBe("none");
    expect(result.rate).toBe(0);
  });

  it("picks the most recently configured program when multiple of the same specificity are active", () => {
    const older = program({ commissionRateBps: 500, validFrom: new Date("2026-01-01") });
    const newer = program({ commissionRateBps: 700, validFrom: new Date("2026-03-01") });
    const result = resolveCommissionRate([older, newer], { marketplace: "amazon_br", at: AT });
    expect(result.rate).toBeCloseTo(0.07, 5);
  });

  it("returns a zero none-source result when nothing matches", () => {
    const result = resolveCommissionRate([], { marketplace: "amazon_br", at: AT });
    expect(result).toEqual({ rate: 0, baseRateBps: 0, extraRateBps: 0, source: "none" });
  });
});
