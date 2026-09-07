import { type AffiliateProgramLike, resolveCommissionRate } from "@dev-das-promos/affiliate";
import { DEFAULT_APPROVAL_THRESHOLDS, DEFAULT_DEAL_SCORE_WEIGHTS } from "@dev-das-promos/config";
import {
  applyApprovalThresholds,
  estimateMonetization,
  scoreDeal,
} from "@dev-das-promos/deal-engine";
import { seededInt } from "@dev-das-promos/providers";
import { slugify } from "@dev-das-promos/shared";
import type { Database } from "../client.js";
import { getPriceHistorySummary } from "../price-history.js";
import { affiliatePrograms, dealCandidates } from "../schema/index.js";
import type { SeededMarketplaceProduct } from "./marketplace-products.js";
import type { SeededProduct } from "./products.js";

export interface SeededDeal {
  dealCandidateId: string;
  productId: string;
  productName: string;
  productSlug: string;
  marketplace: string;
  catalogKey: string;
  score: number;
  status: string;
}

export async function seedDealCandidates(
  db: Database,
  marketplaceProductsSeeded: SeededMarketplaceProduct[],
  latestOffers: { marketplaceProductId: string; latestOfferId: string }[],
  productsSeeded: SeededProduct[],
): Promise<SeededDeal[]> {
  const productByCatalogKey = new Map(productsSeeded.map((p) => [p.catalogKey, p]));
  const latestOfferByMp = new Map(
    latestOffers.map((o) => [o.marketplaceProductId, o.latestOfferId]),
  );

  const programRows = await db.select().from(affiliatePrograms);
  const programs: AffiliateProgramLike[] = programRows.map((row) => ({
    marketplace: row.marketplace,
    categoryId: row.categoryId,
    commissionRateBps: row.commissionRateBps,
    extraCommissionRateBps: row.extraCommissionRateBps,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
  }));

  const results: SeededDeal[] = [];

  for (const mp of marketplaceProductsSeeded) {
    const product = productByCatalogKey.get(mp.catalogKey);
    const offerId = latestOfferByMp.get(mp.marketplaceProductId);
    if (!product || !offerId) continue;

    const history = await getPriceHistorySummary(db, mp.marketplaceProductId);
    const commission = resolveCommissionRate(programs, {
      marketplace: mp.marketplace,
      categoryId: product.categoryId ?? null,
    });

    // Demo-only mocked conversion signal per product, standing in for real
    // observed channel/category conversion data (see docs/analytics.md).
    const historicalConversionRate =
      seededInt(`conv:${mp.marketplace}:${mp.catalogKey}`, 5, 40) / 1000;

    const capturedAt = new Date();

    const scoreResult = scoreDeal(
      {
        currentPrice: history.currentEffectivePriceCents ?? mp.offer.priceCents,
        advertisedOriginalPrice: mp.offer.originalPriceCents,
        avg7dPrice: history.avg7dCents,
        avg30dPrice: history.avg30dCents,
        avg90dPrice: history.avg90dCents,
        min30dPrice: history.min30dCents,
        min90dPrice: history.min90dCents,
        historicalMinPrice: history.historicalMinCents,
        priceHistorySampleCount: history.sampleCount,
        commissionRate: commission.rate,
        sellerRating: mp.offer.sellerRating,
        popularityScore: mp.offer.popularityScore ?? product.popularityScore,
        historicalConversionRate,
        capturedAt,
      },
      DEFAULT_DEAL_SCORE_WEIGHTS,
      capturedAt,
    );

    const monetization = estimateMonetization({
      effectivePrice: history.currentEffectivePriceCents ?? mp.offer.priceCents,
      commissionRate: commission.rate,
      historicalConversionRate,
    });

    const status = applyApprovalThresholds(scoreResult.score, DEFAULT_APPROVAL_THRESHOLDS);
    const slug = slugify(`${product.name}-${mp.marketplace}`);

    const [row] = await db
      .insert(dealCandidates)
      .values({
        offerId,
        slug,
        dealScore: scoreResult.score,
        realDiscountPercentage: scoreResult.realDiscountPercentage,
        advertisedDiscountPercentage: scoreResult.advertisedDiscountPercentage,
        historicalPriceScore: scoreResult.components.historicalDiscount,
        discountScore: scoreResult.components.discount,
        commissionScore: scoreResult.components.commission,
        sellerScore: scoreResult.components.seller,
        popularityScore: scoreResult.components.popularity,
        conversionScore: scoreResult.components.conversion,
        freshnessScore: scoreResult.components.freshness,
        confidenceScore: scoreResult.confidenceScore,
        estimatedEpcCents: monetization.estimatedEpc,
        estimatedRevenuePer1000ImpressionsCents: monetization.estimatedRevenuePer1000Impressions,
        estimateBasis: monetization.basis,
        status,
        signals: scoreResult.signals,
        reasoning: scoreResult.reasoning,
      })
      .returning();

    if (row) {
      results.push({
        dealCandidateId: row.id,
        productId: product.productId,
        productName: product.name,
        productSlug: product.slug,
        marketplace: mp.marketplace,
        catalogKey: mp.catalogKey,
        score: scoreResult.score,
        status,
      });
    }
  }

  return results;
}
