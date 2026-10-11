import { isAllowedAffiliateDestination } from "@dev-das-promos/affiliate";
import type { MarketplaceOfferData } from "@dev-das-promos/providers";
import type { Marketplace } from "@dev-das-promos/shared";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

function isNonNegativePostgresInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_POSTGRES_INTEGER;
}

/** Reject malformed provider records before they can enter scoring or the public catalog. */
export function validateMarketplaceOffer(
  marketplace: Marketplace,
  offer: MarketplaceOfferData,
): void {
  if (!offer.externalId.trim()) {
    throw new Error(`${marketplace} returned an offer without an external ID`);
  }
  if (!offer.productName.trim()) {
    throw new Error(`${marketplace} returned an offer without a product name`);
  }
  if (!isAllowedAffiliateDestination(marketplace, offer.url)) {
    throw new Error(`${marketplace} returned a product URL outside its allowed HTTPS domains`);
  }
  if (offer.currency !== "BRL") {
    throw new Error(
      `${marketplace} returned unsupported currency ${offer.currency}; only BRL offers can be scored`,
    );
  }
  if (!(offer.capturedAt instanceof Date) || !Number.isFinite(offer.capturedAt.getTime())) {
    throw new Error(`${marketplace} returned an invalid offer capture time`);
  }
  if (offer.capturedAt.getTime() > Date.now()) {
    throw new Error(`${marketplace} returned an offer capture time in the future`);
  }
  if (
    !(["in_stock", "low_stock", "out_of_stock", "unknown"] as const).includes(offer.availability)
  ) {
    throw new Error(`${marketplace} returned an invalid availability status`);
  }
  if (!isNonNegativePostgresInteger(offer.priceCents) || offer.priceCents === 0) {
    throw new Error(`${marketplace} returned an invalid offer price`);
  }

  for (const [field, value] of [
    ["original price", offer.originalPriceCents],
    ["shipping price", offer.shippingPriceCents],
    ["coupon value", offer.couponValueCents],
  ] as const) {
    if (value !== undefined && !isNonNegativePostgresInteger(value)) {
      throw new Error(`${marketplace} returned an invalid ${field}`);
    }
  }
  if (offer.originalPriceCents !== undefined && offer.originalPriceCents < offer.priceCents) {
    throw new Error(`${marketplace} returned an original price below the offer price`);
  }

  for (const [field, value] of [
    ["seller rating", offer.sellerRating],
    ["popularity score", offer.popularityScore],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) {
      throw new Error(
        `${marketplace} returned an invalid ${field}; expected a value from 0 to 100`,
      );
    }
  }

  const grossPrice = offer.priceCents + (offer.shippingPriceCents ?? 0);
  const effectivePrice = grossPrice - (offer.couponValueCents ?? 0);
  if (
    !isNonNegativePostgresInteger(grossPrice) ||
    !isNonNegativePostgresInteger(effectivePrice) ||
    effectivePrice <= 0
  ) {
    throw new Error(`${marketplace} returned an invalid effective offer price`);
  }
}
