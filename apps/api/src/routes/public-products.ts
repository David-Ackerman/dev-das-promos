import { getScoreLabel } from "@dev-das-promos/config";
import {
  categories,
  dealCandidates,
  getPriceHistorySummary,
  marketplaceProducts,
  offers,
  products,
} from "@dev-das-promos/database";
import { sanitizeMarketplaceImageUrl } from "@dev-das-promos/providers";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import {
  currentOfferConditions,
  nonMockMarketplaceProductCondition,
  publishedWebPublicationCondition,
} from "../lib/deal-freshness.js";

export default async function publicProductsRoutes(fastify: FastifyInstance) {
  fastify.get("/public/products/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const [product] = await fastify.db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        brand: products.brand,
        description: products.description,
        imageUrl: products.imageUrl,
        categoryName: categories.name,
        categorySlug: categories.slug,
      })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(products.slug, slug));

    if (!product) return reply.code(404).send({ error: "Product not found" });

    // Only expose currently available, published candidates. Each
    // marketplace listing has at most one, kept up to date by evaluateOffer's
    // upsert-by-slug logic -- NOT one row per historical offer.
    const listings = await fastify.db
      .select({
        marketplaceProductId: marketplaceProducts.id,
        marketplace: marketplaceProducts.marketplace,
        sellerName: marketplaceProducts.sellerName,
        sellerRating: marketplaceProducts.sellerRating,
        dealSlug: dealCandidates.slug,
        dealScore: dealCandidates.dealScore,
        dealStatus: dealCandidates.status,
        effectivePriceCents: offers.effectivePriceCents,
        currency: offers.currency,
      })
      .from(dealCandidates)
      .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
      .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
      .where(
        and(
          eq(marketplaceProducts.productId, product.id),
          eq(dealCandidates.status, "published"),
          publishedWebPublicationCondition(),
          ...(env.NODE_ENV === "production" ? [nonMockMarketplaceProductCondition()] : []),
          ...currentOfferConditions(),
        ),
      );

    if (listings.length === 0) {
      return reply.code(404).send({ error: "Product not found" });
    }

    const listingsWithHistory = await Promise.all(
      listings.map(async (listing) => ({
        ...listing,
        scoreLabel: getScoreLabel(listing.dealScore),
        priceHistory: await getPriceHistorySummary(fastify.db, listing.marketplaceProductId),
      })),
    );

    return {
      ...product,
      imageUrl: sanitizeMarketplaceImageUrl(product.imageUrl),
      listings: listingsWithHistory,
    };
  });
}
