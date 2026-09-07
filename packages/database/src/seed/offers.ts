import { seededInt } from "@dev-das-promos/providers";
import type { Database } from "../client.js";
import { offers } from "../schema/index.js";
import type { SeededMarketplaceProduct } from "./marketplace-products.js";

const HISTORY_DAYS = 90;
const SAMPLE_EVERY_DAYS = 3;

/**
 * Builds a synthetic ~90-day daily-ish price series that trends from a
 * "normal" price down to the mock provider's current (possibly
 * discounted) offer price, with small noise per sample -- enough history
 * for the deal engine's 7d/30d/90d aggregates to be meaningful in a demo.
 */
function buildPriceSeries(seedKey: string, startPriceCents: number, endPriceCents: number) {
  const points: { daysAgo: number; priceCents: number }[] = [];
  for (let daysAgo = HISTORY_DAYS; daysAgo >= SAMPLE_EVERY_DAYS; daysAgo -= SAMPLE_EVERY_DAYS) {
    const t = 1 - daysAgo / HISTORY_DAYS;
    const base = startPriceCents + (endPriceCents - startPriceCents) * t;
    const noisePct = seededInt(`${seedKey}:noise:${daysAgo}`, -3, 3);
    points.push({ daysAgo, priceCents: Math.max(1, Math.round(base * (1 + noisePct / 100))) });
  }
  return points;
}

export async function seedOffers(
  db: Database,
  marketplaceProductsSeeded: SeededMarketplaceProduct[],
): Promise<{ marketplaceProductId: string; latestOfferId: string }[]> {
  const latest: { marketplaceProductId: string; latestOfferId: string }[] = [];

  for (const mp of marketplaceProductsSeeded) {
    const { offer } = mp;
    const endPriceCents = offer.priceCents;
    // A "normal" starting price ~10-25% above where the price ends up, so
    // the most recent observation reads as a genuine, gradual discount.
    const startPriceCents = Math.round(
      endPriceCents * (1 + seededInt(`${mp.marketplace}:${mp.catalogKey}:start`, 10, 25) / 100),
    );

    const series = buildPriceSeries(
      `${mp.marketplace}:${mp.catalogKey}`,
      startPriceCents,
      endPriceCents,
    );

    const now = new Date();

    for (const point of series) {
      const capturedAt = new Date(now.getTime() - point.daysAgo * 24 * 60 * 60 * 1000);
      await db.insert(offers).values({
        marketplaceProductId: mp.marketplaceProductId,
        priceCents: point.priceCents,
        originalPriceCents: undefined,
        shippingPriceCents: 0,
        couponValueCents: 0,
        effectivePriceCents: point.priceCents,
        currency: "BRL",
        availability: "in_stock",
        capturedAt,
      });
    }

    // Today's observation: exactly what the mock provider currently reports,
    // including shipping/coupon/original-price and the real availability.
    const effectivePriceCents = Math.max(
      0,
      offer.priceCents + (offer.shippingPriceCents ?? 0) - (offer.couponValueCents ?? 0),
    );

    const [latestRow] = await db
      .insert(offers)
      .values({
        marketplaceProductId: mp.marketplaceProductId,
        priceCents: offer.priceCents,
        originalPriceCents: offer.originalPriceCents,
        shippingPriceCents: offer.shippingPriceCents ?? 0,
        couponValueCents: offer.couponValueCents ?? 0,
        effectivePriceCents,
        currency: offer.currency,
        availability: offer.availability,
        capturedAt: now,
      })
      .returning();

    if (latestRow) {
      latest.push({ marketplaceProductId: mp.marketplaceProductId, latestOfferId: latestRow.id });
    }
  }

  return latest;
}
