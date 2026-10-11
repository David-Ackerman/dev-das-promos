import { type Database, marketplaceProducts, offers, products } from "@dev-das-promos/database";
import { type MarketplaceOfferData, createProviderRegistry } from "@dev-das-promos/providers";
import type { QueueBundle } from "@dev-das-promos/queue";
import type { Marketplace } from "@dev-das-promos/shared";
import { and, eq } from "drizzle-orm";
import { env } from "../env.js";
import { productSlugCandidates, sameCatalogName } from "../lib/catalog-identity.js";
import { validateMarketplaceOffer } from "../lib/offer-validation.js";
import {
  hasRealMarketplaceApiCredentials,
  providerRegistryOptionsFromEnv,
} from "../lib/provider-registry-options.js";
import { findOrCreateCategory } from "./categories.js";

export interface IngestionResult {
  marketplace: Marketplace;
  offersIngested: number;
  offerIds: string[];
}

/**
 * Pulls current offers from a marketplace provider and persists them:
 * find-or-create the logical Product, find-or-create the
 * MarketplaceProduct listing, insert a new Offer observation, then
 * enqueue a deal-evaluation job for that offer. This is the ingestion
 * half of the pipeline described in docs/architecture.md; it is provider
 * agnostic -- swapping the mock provider for a real one later requires no
 * changes here.
 */
export async function ingestMarketplaceOffers(
  db: Database,
  queues: QueueBundle,
  marketplace: Marketplace,
  options: { category?: string } = {},
): Promise<IngestionResult> {
  if (env.NODE_ENV === "production" && !hasRealMarketplaceApiCredentials(env, marketplace)) {
    throw new Error(`Real ${marketplace} credentials are required for production ingestion`);
  }

  const registry = createProviderRegistry(providerRegistryOptionsFromEnv(env));
  const provider = registry[marketplace];

  const offerDataList = await provider.fetchOffers({ category: options.category });
  for (const offerData of offerDataList) validateMarketplaceOffer(marketplace, offerData);

  const offerIds: string[] = [];

  for (const offerData of offerDataList) {
    const offerId = await ingestOneOffer(db, marketplace, offerData);
    offerIds.push(offerId);
    await queues.dealEvaluation.add("evaluate", { offerId });
  }

  return { marketplace, offersIngested: offerIds.length, offerIds };
}

async function ingestOneOffer(
  db: Database,
  marketplace: Marketplace,
  offerData: MarketplaceOfferData,
): Promise<string> {
  const productId = await findOrCreateProduct(db, offerData);
  const marketplaceProductId = await findOrCreateMarketplaceProduct(
    db,
    marketplace,
    productId,
    offerData,
  );

  const effectivePriceCents = Math.max(
    0,
    offerData.priceCents + (offerData.shippingPriceCents ?? 0) - (offerData.couponValueCents ?? 0),
  );

  const [offerRow] = await db
    .insert(offers)
    .values({
      marketplaceProductId,
      priceCents: offerData.priceCents,
      originalPriceCents: offerData.originalPriceCents,
      shippingPriceCents: offerData.shippingPriceCents ?? 0,
      couponValueCents: offerData.couponValueCents ?? 0,
      effectivePriceCents,
      currency: offerData.currency,
      availability: offerData.availability,
      capturedAt: offerData.capturedAt,
    })
    .returning();

  if (!offerRow) throw new Error("Failed to insert offer");
  return offerRow.id;
}

async function findOrCreateProduct(db: Database, offerData: MarketplaceOfferData): Promise<string> {
  const slugs = productSlugCandidates(offerData.productName);

  const categoryId = offerData.category
    ? await findOrCreateCategory(db, offerData.category)
    : undefined;

  for (const slug of slugs) {
    const [existing] = await db.select().from(products).where(eq(products.slug, slug));
    if (existing) {
      if (sameCatalogName(existing.name, offerData.productName)) return existing.id;
      continue;
    }

    const [created] = await db
      .insert(products)
      .values({
        name: offerData.productName,
        slug,
        brand: offerData.brand,
        categoryId,
        imageUrl: offerData.imageUrl,
        description: offerData.description,
        metadata: {},
      })
      .onConflictDoNothing({ target: products.slug })
      .returning();
    if (created) return created.id;

    // Another ingestion worker may have inserted this logical product
    // after our lookup. Reuse it only when the full name agrees.
    const [concurrent] = await db.select().from(products).where(eq(products.slug, slug));
    if (concurrent && sameCatalogName(concurrent.name, offerData.productName)) {
      return concurrent.id;
    }
  }

  throw new Error(`Could not create a unique product slug for "${offerData.productName}"`);
}

async function findOrCreateMarketplaceProduct(
  db: Database,
  marketplace: Marketplace,
  productId: string,
  offerData: MarketplaceOfferData,
): Promise<string> {
  const [existing] = await db
    .select()
    .from(marketplaceProducts)
    .where(
      and(
        eq(marketplaceProducts.marketplace, marketplace),
        eq(marketplaceProducts.externalId, offerData.externalId),
      ),
    );
  if (existing) {
    // Listing URLs and seller details can change while the marketplace keeps
    // the same external ID. Refresh them so content and affiliate links use
    // the current listing observed by this ingestion.
    return refreshMarketplaceProduct(db, existing.id, offerData);
  }

  const [created] = await db
    .insert(marketplaceProducts)
    .values({
      productId,
      marketplace,
      externalId: offerData.externalId,
      url: offerData.url,
      sellerName: offerData.sellerName,
      sellerRating: offerData.sellerRating,
      metadata: offerData.metadata ?? {},
    })
    .onConflictDoNothing({
      target: [marketplaceProducts.marketplace, marketplaceProducts.externalId],
    })
    .returning();

  if (created) return created.id;

  // Another ingestion worker may have inserted this marketplace listing
  // after our lookup. Refresh its mutable fields using the newest response.
  const [concurrent] = await db
    .select({ id: marketplaceProducts.id })
    .from(marketplaceProducts)
    .where(
      and(
        eq(marketplaceProducts.marketplace, marketplace),
        eq(marketplaceProducts.externalId, offerData.externalId),
      ),
    );
  if (!concurrent) throw new Error("Failed to create marketplace product");
  return refreshMarketplaceProduct(db, concurrent.id, offerData);
}

async function refreshMarketplaceProduct(
  db: Database,
  id: string,
  offerData: MarketplaceOfferData,
): Promise<string> {
  await db
    .update(marketplaceProducts)
    .set({
      url: offerData.url,
      sellerName: offerData.sellerName,
      sellerRating: offerData.sellerRating,
      metadata: offerData.metadata ?? {},
    })
    .where(eq(marketplaceProducts.id, id));
  return id;
}
