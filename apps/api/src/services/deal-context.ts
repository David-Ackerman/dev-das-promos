import {
  type Database,
  type PriceHistorySummary,
  categories,
  dealCandidates,
  getPriceHistorySummary,
  marketplaceProducts,
  offers,
  products,
  redirects,
} from "@dev-das-promos/database";
import type { Marketplace } from "@dev-das-promos/shared";
import { and, eq } from "drizzle-orm";

export interface DealContext {
  dealCandidateId: string;
  slug: string;
  dealScore: number;
  realDiscountPercentage: number;
  advertisedDiscountPercentage: number | null;
  historicalPriceScore: number;
  discountScore: number;
  commissionScore: number;
  sellerScore: number;
  popularityScore: number;
  conversionScore: number;
  freshnessScore: number;
  confidenceScore: number;
  estimatedEpcCents: number;
  estimatedRevenuePer1000ImpressionsCents: number;
  estimateBasis: string;
  signals: string[];
  reasoning: string | null;
  status: string;
  offerId: string;
  priceCents: number;
  originalPriceCents: number | null;
  effectivePriceCents: number;
  currency: string;
  capturedAt: Date;
  marketplaceProductId: string;
  marketplace: Marketplace;
  externalId: string;
  productUrl: string;
  sellerName: string | null;
  sellerRating: number | null;
  productId: string;
  productName: string;
  productSlug: string;
  brand: string | null;
  imageUrl: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  history: PriceHistorySummary;
  /** The /go/:code short-link code for the "web" channel, when publication has run. */
  redirectCode: string | undefined;
}

/** Assembles everything needed to render or publish a deal, in one place. */
export async function loadDealContext(
  db: Database,
  dealCandidateId: string,
): Promise<DealContext | null> {
  const [row] = await db
    .select({
      dealCandidateId: dealCandidates.id,
      slug: dealCandidates.slug,
      dealScore: dealCandidates.dealScore,
      realDiscountPercentage: dealCandidates.realDiscountPercentage,
      advertisedDiscountPercentage: dealCandidates.advertisedDiscountPercentage,
      historicalPriceScore: dealCandidates.historicalPriceScore,
      discountScore: dealCandidates.discountScore,
      commissionScore: dealCandidates.commissionScore,
      sellerScore: dealCandidates.sellerScore,
      popularityScore: dealCandidates.popularityScore,
      conversionScore: dealCandidates.conversionScore,
      freshnessScore: dealCandidates.freshnessScore,
      confidenceScore: dealCandidates.confidenceScore,
      estimatedEpcCents: dealCandidates.estimatedEpcCents,
      estimatedRevenuePer1000ImpressionsCents:
        dealCandidates.estimatedRevenuePer1000ImpressionsCents,
      estimateBasis: dealCandidates.estimateBasis,
      signals: dealCandidates.signals,
      reasoning: dealCandidates.reasoning,
      status: dealCandidates.status,
      offerId: offers.id,
      priceCents: offers.priceCents,
      originalPriceCents: offers.originalPriceCents,
      effectivePriceCents: offers.effectivePriceCents,
      currency: offers.currency,
      capturedAt: offers.capturedAt,
      marketplaceProductId: marketplaceProducts.id,
      marketplace: marketplaceProducts.marketplace,
      externalId: marketplaceProducts.externalId,
      productUrl: marketplaceProducts.url,
      sellerName: marketplaceProducts.sellerName,
      sellerRating: marketplaceProducts.sellerRating,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      brand: products.brand,
      imageUrl: products.imageUrl,
      description: products.description,
      categoryId: products.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
    })
    .from(dealCandidates)
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .innerJoin(products, eq(marketplaceProducts.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(dealCandidates.id, dealCandidateId));

  if (!row) return null;

  const history = await getPriceHistorySummary(db, row.marketplaceProductId);

  const [webRedirect] = await db
    .select({ code: redirects.code })
    .from(redirects)
    .where(and(eq(redirects.dealCandidateId, dealCandidateId), eq(redirects.channel, "web")));
  const [anyRedirect] = webRedirect
    ? []
    : await db
        .select({ code: redirects.code })
        .from(redirects)
        .where(eq(redirects.dealCandidateId, dealCandidateId));

  return { ...row, history, redirectCode: webRedirect?.code ?? anyRedirect?.code };
}

export async function loadDealContextBySlug(
  db: Database,
  slug: string,
): Promise<DealContext | null> {
  const [row] = await db
    .select({ id: dealCandidates.id })
    .from(dealCandidates)
    .where(eq(dealCandidates.slug, slug));
  if (!row) return null;
  return loadDealContext(db, row.id);
}
