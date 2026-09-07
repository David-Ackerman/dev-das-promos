import { clamp } from "@dev-das-promos/shared";
import type { DealScoringInput, RealDiscountResult } from "./types.js";

/**
 * Curve mapping a discount percentage to a 0-100 score. 40%+ off maps to
 * a full 100; this is a deliberately simple linear ramp rather than a
 * fitted model, since we don't yet have enough historical conversion
 * data to justify anything fancier (see docs/deal-engine.md).
 */
const DISCOUNT_SCORE_SATURATION_PERCENT = 40;

export function scoreFromDiscountPercentage(discountPercentage: number): number {
  return clamp((discountPercentage / DISCOUNT_SCORE_SATURATION_PERCENT) * 100, 0, 100);
}

export function historicalDiscountScore(
  realDiscount: RealDiscountResult,
  input: DealScoringInput,
): { score: number; signals: string[] } {
  const signals: string[] = [];

  if (realDiscount.baselineUsed === "none") {
    signals.push("PRICE_HISTORY_INSUFFICIENT");
    return { score: 0, signals };
  }

  let score = scoreFromDiscountPercentage(realDiscount.realDiscountPercentage);

  if (realDiscount.realDiscountPercentage >= 20) signals.push("20_PERCENT_BELOW_HISTORICAL_AVG");

  const floor = input.historicalMinPrice ?? input.min90dPrice;
  if (floor !== undefined && input.currentPrice <= floor) {
    signals.push(
      input.historicalMinPrice !== undefined && input.currentPrice <= input.historicalMinPrice
        ? "ALL_TIME_LOW"
        : "LOWEST_PRICE_90D",
    );
    score = 100;
  }

  if (realDiscount.baselineUsed === "30d_avg") signals.push("HISTORY_LIMITED_TO_30D");
  if (realDiscount.baselineUsed === "advertised") signals.push("HISTORY_FALLBACK_ADVERTISED_PRICE");

  return { score, signals };
}

export function discountScore(
  advertisedDiscountPercentage: number | undefined,
  fallbackScore: number,
): { score: number; signals: string[] } {
  if (advertisedDiscountPercentage === undefined) {
    return { score: fallbackScore, signals: ["NO_ADVERTISED_PRICE"] };
  }
  return { score: scoreFromDiscountPercentage(advertisedDiscountPercentage), signals: [] };
}

/** Commission rate at/above this fraction saturates the commission score to 100. */
const COMMISSION_SCORE_SATURATION_RATE = 0.12;
const DEFAULT_COMMISSION_SCORE = 50;

export function commissionScore(commissionRate: number | undefined): {
  score: number;
  signals: string[];
} {
  if (commissionRate === undefined) {
    return { score: DEFAULT_COMMISSION_SCORE, signals: ["COMMISSION_RATE_UNKNOWN"] };
  }
  const score = clamp((commissionRate / COMMISSION_SCORE_SATURATION_RATE) * 100, 0, 100);
  const signals = score >= 80 ? ["HIGH_COMMISSION_CATEGORY"] : [];
  return { score, signals };
}

const DEFAULT_SELLER_SCORE = 60;
const LOW_SELLER_RATING_THRESHOLD = 70;

export function sellerScore(sellerRating: number | undefined): {
  score: number;
  signals: string[];
} {
  if (sellerRating === undefined) {
    return { score: DEFAULT_SELLER_SCORE, signals: ["SELLER_RATING_UNKNOWN"] };
  }
  const score = clamp(sellerRating, 0, 100);
  const signals = score < LOW_SELLER_RATING_THRESHOLD ? ["SELLER_RATING_LOW"] : [];
  return { score, signals };
}

const DEFAULT_POPULARITY_SCORE = 50;

export function popularityScore(popularity: number | undefined): {
  score: number;
  signals: string[];
} {
  if (popularity === undefined) {
    return { score: DEFAULT_POPULARITY_SCORE, signals: ["POPULARITY_UNKNOWN"] };
  }
  return { score: clamp(popularity, 0, 100), signals: [] };
}

/** A 3% historical conversion rate saturates the conversion score to 100. */
const CONVERSION_SCORE_SATURATION_RATE = 0.03;
const DEFAULT_CONVERSION_SCORE = 50;

export function conversionScore(historicalConversionRate: number | undefined): {
  score: number;
  signals: string[];
} {
  if (historicalConversionRate === undefined) {
    return { score: DEFAULT_CONVERSION_SCORE, signals: ["CONVERSION_DATA_UNAVAILABLE"] };
  }
  const score = clamp((historicalConversionRate / CONVERSION_SCORE_SATURATION_RATE) * 100, 0, 100);
  return { score, signals: [] };
}

/** Offers older than this (hours) score 0 on freshness. */
const FRESHNESS_DECAY_HOURS = 24;
const STALE_SCORE_THRESHOLD = 30;

export function freshnessScore(
  capturedAt: Date,
  now: Date = new Date(),
): {
  score: number;
  signals: string[];
} {
  const ageHours = Math.max(0, (now.getTime() - capturedAt.getTime()) / (1000 * 60 * 60));
  const score = clamp(100 - (ageHours / FRESHNESS_DECAY_HOURS) * 100, 0, 100);
  const signals = score < STALE_SCORE_THRESHOLD ? ["STALE_OFFER"] : [];
  return { score, signals };
}
