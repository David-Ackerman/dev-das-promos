import {
  PUBLIC_DEALS_MAX_PAGE,
  PUBLIC_DEALS_MAX_PAGE_SIZE,
  getScoreLabel,
} from "@dev-das-promos/config";
import {
  categories,
  dealCandidates,
  getPriceSeries,
  marketplaceProducts,
  offers,
  products,
} from "@dev-das-promos/database";
import { sanitizeMarketplaceImageUrl } from "@dev-das-promos/providers";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import {
  currentOfferConditions,
  isOfferCurrent,
  nonMockMarketplaceProductCondition,
  publishedWebPublicationCondition,
} from "../lib/deal-freshness.js";
import { loadDealContextBySlug } from "../services/deal-context.js";

const listQuerySchema = z.object({
  categorySlug: z.string().optional(),
  page: z.coerce.number().int().min(1).max(PUBLIC_DEALS_MAX_PAGE).default(1),
  pageSize: z.coerce.number().int().min(1).max(PUBLIC_DEALS_MAX_PAGE_SIZE).default(24),
});

const priceHistoryQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d", "all"]).default("90d"),
});

const RANGE_DAYS: Record<string, number | "all"> = { "7d": 7, "30d": 30, "90d": 90, all: "all" };

/**
 * Everything under /public/* is unauthenticated and safe to expose to
 * apps/web for server-side rendering. It only ever returns `published`
 * deals -- pending/rejected candidates never leak to the public site.
 */
export default async function publicDealsRoutes(fastify: FastifyInstance) {
  fastify.get("/public/deals", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });

    const conditions = [
      inArray(dealCandidates.status, ["published"]),
      publishedWebPublicationCondition(),
      ...currentOfferConditions(),
      env.NODE_ENV === "production" ? nonMockMarketplaceProductCondition() : undefined,
      parsed.data.categorySlug ? eq(categories.slug, parsed.data.categorySlug) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await fastify.db
      .select({
        slug: dealCandidates.slug,
        dealScore: dealCandidates.dealScore,
        realDiscountPercentage: dealCandidates.realDiscountPercentage,
        productName: products.name,
        productSlug: products.slug,
        imageUrl: products.imageUrl,
        marketplace: marketplaceProducts.marketplace,
        effectivePriceCents: offers.effectivePriceCents,
        currency: offers.currency,
        publishedAt: dealCandidates.updatedAt,
      })
      .from(dealCandidates)
      .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
      .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
      .innerJoin(products, eq(marketplaceProducts.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(and(...conditions))
      .orderBy(desc(dealCandidates.dealScore))
      .limit(parsed.data.pageSize)
      .offset((parsed.data.page - 1) * parsed.data.pageSize);

    return {
      deals: rows.map((r) => ({
        ...r,
        imageUrl: sanitizeMarketplaceImageUrl(r.imageUrl),
        scoreLabel: getScoreLabel(r.dealScore),
      })),
    };
  });

  fastify.get("/public/deals/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const context = await loadDealContextBySlug(fastify.db, slug, {
      requirePublishedWebPublication: true,
    });

    if (
      !context ||
      context.status !== "published" ||
      !isOfferCurrent(context.availability, context.capturedAt) ||
      (env.NODE_ENV === "production" && context.isDemoListing)
    ) {
      return reply.code(404).send({ error: "Deal not found" });
    }

    const { isDemoListing: _isDemoListing, ...publicContext } = context;
    return { ...publicContext, scoreLabel: getScoreLabel(context.dealScore) };
  });

  fastify.get("/public/deals/:slug/price-history", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = priceHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });

    const context = await loadDealContextBySlug(fastify.db, slug, {
      requirePublishedWebPublication: true,
    });
    if (
      !context ||
      context.status !== "published" ||
      !isOfferCurrent(context.availability, context.capturedAt) ||
      (env.NODE_ENV === "production" && context.isDemoListing)
    ) {
      return reply.code(404).send({ error: "Deal not found" });
    }

    const points = await getPriceSeries(
      fastify.db,
      context.marketplaceProductId,
      RANGE_DAYS[parsed.data.range]!,
    );
    return { range: parsed.data.range, points };
  });
}
