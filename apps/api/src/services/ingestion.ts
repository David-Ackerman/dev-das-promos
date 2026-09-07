import { type Database, marketplaceProducts, offers, products } from "@dev-das-promos/database";
import { type MarketplaceOfferData, createProviderRegistry } from "@dev-das-promos/providers";
import type { QueueBundle } from "@dev-das-promos/queue";
import { type Marketplace, slugify } from "@dev-das-promos/shared";
import { and, eq } from "drizzle-orm";
import { env } from "../env.js";
import { providerRegistryOptionsFromEnv } from "../lib/provider-registry-options.js";
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
  const registry = createProviderRegistry(providerRegistryOptionsFromEnv(env));
  const provider = registry[marketplace];

  const offerDataList = await provider.fetchOffers({ category: options.category });
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
  const slug = slugify(offerData.productName);

  const [existing] = await db.select().from(products).where(eq(products.slug, slug));
  if (existing) return existing.id;

  const categoryId = offerData.category
    ? await findOrCreateCategory(db, offerData.category)
    : undefined;

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
    .returning();

  if (!created) throw new Error(`Failed to create product "${offerData.productName}"`);
  return created.id;
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
  if (existing) return existing.id;

  const [created] = await db
    .insert(marketplaceProducts)
    .values({
      productId,
      marketplace,
      externalId: offerData.externalId,
      url: offerData.url,
      sellerName: offerData.sellerName,
      sellerRating: offerData.sellerRating,
      metadata: {},
    })
    .returning();

  if (!created) throw new Error("Failed to create marketplace product");
  return created.id;
}
