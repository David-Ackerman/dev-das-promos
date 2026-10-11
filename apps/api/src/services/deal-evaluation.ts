import { type AffiliateProgramLike, resolveCommissionRate } from "@dev-das-promos/affiliate";
import { DEFAULT_APPROVAL_THRESHOLDS, DEFAULT_DEAL_SCORE_WEIGHTS } from "@dev-das-promos/config";
import {
  type Database,
  affiliatePrograms,
  dealCandidates,
  getPriceHistorySummary,
  marketplaceProducts,
  offers,
  products,
  publications,
} from "@dev-das-promos/database";
import {
  applyApprovalThresholds,
  estimateMonetization,
  scoreDeal,
} from "@dev-das-promos/deal-engine";
import { slugify } from "@dev-das-promos/shared";
import { and, eq } from "drizzle-orm";
import { estimateHistoricalConversionRate } from "./conversion-signal.js";

export interface EvaluateOfferOptions {
  /** When true (default), a human decision is kept only while re-evaluating the same offer snapshot. */
  preserveHumanDecision?: boolean;
}

export interface EvaluateOfferResult {
  dealCandidateId: string;
  score: number;
  status: string;
}

/**
 * Runs the deal engine against one offer and upserts its DealCandidate.
 * This is the "run deal engine -> create/update deal candidate ->
 * approval rules" stage of the pipeline (docs/architecture.md), shared by
 * the deal-evaluation queue worker and the admin "Re-evaluate" action.
 */
export async function evaluateOffer(
  db: Database,
  offerId: string,
  options: EvaluateOfferOptions = {},
): Promise<EvaluateOfferResult> {
  const preserveHumanDecision = options.preserveHumanDecision ?? true;

  const [row] = await db
    .select({
      offerId: offers.id,
      priceCents: offers.priceCents,
      originalPriceCents: offers.originalPriceCents,
      effectivePriceCents: offers.effectivePriceCents,
      capturedAt: offers.capturedAt,
      availability: offers.availability,
      marketplaceProductId: marketplaceProducts.id,
      marketplace: marketplaceProducts.marketplace,
      sellerRating: marketplaceProducts.sellerRating,
      productId: products.id,
      productName: products.name,
      categoryId: products.categoryId,
      productMetadata: products.metadata,
    })
    .from(offers)
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .innerJoin(products, eq(marketplaceProducts.productId, products.id))
    .where(eq(offers.id, offerId));

  if (!row) throw new Error(`Offer ${offerId} not found`);

  const history = await getPriceHistorySummary(db, row.marketplaceProductId);

  const programRows = await db.select().from(affiliatePrograms);
  const programs: AffiliateProgramLike[] = programRows.map((p) => ({
    marketplace: p.marketplace,
    categoryId: p.categoryId,
    commissionRateBps: p.commissionRateBps,
    extraCommissionRateBps: p.extraCommissionRateBps,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
  }));
  const commission = resolveCommissionRate(programs, {
    marketplace: row.marketplace,
    categoryId: row.categoryId,
  });

  const popularityScore = (row.productMetadata as Record<string, unknown> | null)
    ?.popularityScore as number | undefined;

  const historicalConversionRate = await estimateHistoricalConversionRate(db, row.categoryId);

  const scoreResult = scoreDeal(
    {
      currentPrice: row.effectivePriceCents,
      advertisedOriginalPrice: row.originalPriceCents ?? undefined,
      avg7dPrice: history.avg7dCents,
      avg30dPrice: history.avg30dCents,
      avg90dPrice: history.avg90dCents,
      min30dPrice: history.min30dCents,
      min90dPrice: history.min90dCents,
      historicalMinPrice: history.historicalMinCents,
      priceHistorySampleCount: history.sampleCount,
      commissionRate: commission.rate,
      sellerRating: row.sellerRating ?? undefined,
      popularityScore,
      historicalConversionRate,
      capturedAt: row.capturedAt,
    },
    DEFAULT_DEAL_SCORE_WEIGHTS,
  );

  const monetization = estimateMonetization({
    effectivePrice: row.effectivePriceCents,
    commissionRate: commission.rate,
    historicalConversionRate,
  });

  const computedStatus =
    row.availability === "out_of_stock"
      ? "expired"
      : applyApprovalThresholds(scoreResult.score, DEFAULT_APPROVAL_THRESHOLDS);
  const slug = slugify(`${row.productName}-${row.marketplace}`);

  const [existing] = await db
    .select({
      id: dealCandidates.id,
      offerId: dealCandidates.offerId,
      dealScore: dealCandidates.dealScore,
      status: dealCandidates.status,
      reviewedBy: dealCandidates.reviewedBy,
      reviewedAt: dealCandidates.reviewedAt,
      currentOfferCapturedAt: offers.capturedAt,
    })
    .from(dealCandidates)
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .where(eq(dealCandidates.slug, slug));

  const scoreFields = {
    offerId,
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
    signals: scoreResult.signals,
    reasoning: scoreResult.reasoning,
  };

  if (existing) {
    const sameOfferSnapshot = existing.offerId === offerId;
    if (!sameOfferSnapshot && existing.currentOfferCapturedAt >= row.capturedAt) {
      // Queue workers can finish out of order. Never replace a newer offer
      // (or an equally recent snapshot) with an older evaluation result.
      return {
        dealCandidateId: existing.id,
        score: existing.dealScore,
        status: existing.status,
      };
    }
    const keepHumanStatus =
      preserveHumanDecision &&
      sameOfferSnapshot &&
      Boolean(existing.reviewedBy) &&
      existing.status !== "expired" &&
      computedStatus !== "expired";
    const priorPublications = await db
      .select({ metadata: publications.metadata })
      .from(publications)
      .where(
        and(eq(publications.dealCandidateId, existing.id), eq(publications.status, "published")),
      );
    const keepPublishedStatus =
      priorPublications.some((publication) => publication.metadata.offerId === offerId) &&
      computedStatus === "auto_approved";
    const [updated] = await db
      .update(dealCandidates)
      .set({
        ...scoreFields,
        status: keepHumanStatus
          ? existing.status
          : keepPublishedStatus
            ? "published"
            : computedStatus,
        ...(keepHumanStatus ? {} : { reviewedBy: null, reviewedAt: null }),
      })
      .where(
        and(
          eq(dealCandidates.id, existing.id),
          eq(dealCandidates.offerId, existing.offerId),
          eq(dealCandidates.status, existing.status),
        ),
      )
      .returning();

    if (!updated) throw new Error("Failed to update deal candidate");
    return { dealCandidateId: updated.id, score: updated.dealScore, status: updated.status };
  }

  const [created] = await db
    .insert(dealCandidates)
    .values({ ...scoreFields, slug, status: computedStatus })
    .returning();

  if (!created) throw new Error("Failed to create deal candidate");
  return { dealCandidateId: created.id, score: created.dealScore, status: created.status };
}
