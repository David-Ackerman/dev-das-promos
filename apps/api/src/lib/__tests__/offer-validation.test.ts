import type { MarketplaceOfferData } from "@dev-das-promos/providers";
import { describe, expect, it } from "vitest";
import { validateMarketplaceOffer } from "../offer-validation.js";

const validOffer: MarketplaceOfferData = {
  externalId: "B0EXAMPLE",
  productName: "Fone Bluetooth",
  url: "https://www.amazon.com.br/dp/B0EXAMPLE",
  priceCents: 10_000,
  originalPriceCents: 12_000,
  shippingPriceCents: 500,
  couponValueCents: 1_000,
  sellerRating: 95,
  popularityScore: 70,
  currency: "BRL",
  availability: "in_stock",
  capturedAt: new Date("2026-09-29T12:00:00.000Z"),
};

describe("validateMarketplaceOffer", () => {
  it("accepts a well-formed offer", () => {
    expect(() => validateMarketplaceOffer("amazon_br", validOffer)).not.toThrow();
  });

  it.each([
    ["negative shipping", { shippingPriceCents: -1 }, /shipping price/],
    ["oversized price", { priceCents: 2_147_483_648 }, /offer price/],
    ["fractional coupon", { couponValueCents: 1.5 }, /coupon value/],
    ["coupon at or above total", { couponValueCents: 10_500 }, /effective offer price/],
    ["original price below offer", { originalPriceCents: 9_999 }, /original price below/],
    ["future capture time", { capturedAt: new Date(Date.now() + 60_000) }, /in the future/],
    ["rating outside scale", { sellerRating: 101 }, /seller rating/],
    ["popularity outside scale", { popularityScore: -1 }, /popularity score/],
  ] as const)("rejects %s", (_label, overrides, expectedError) => {
    expect(() =>
      validateMarketplaceOffer("amazon_br", {
        ...validOffer,
        ...overrides,
      } as MarketplaceOfferData),
    ).toThrowError(expectedError);
  });
});
