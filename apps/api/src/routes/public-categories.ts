import { getScoreLabel } from "@dev-das-promos/config";
import {
  categories,
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
} from "@dev-das-promos/database";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export default async function publicCategoriesRoutes(fastify: FastifyInstance) {
  fastify.get("/public/categories", async () => {
    const rows = await fastify.db.select().from(categories).orderBy(categories.name);
    return { categories: rows };
  });

  fastify.get("/public/categories/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const [category] = await fastify.db.select().from(categories).where(eq(categories.slug, slug));
    if (!category) return reply.code(404).send({ error: "Category not found" });

    const children = await fastify.db
      .select()
      .from(categories)
      .where(eq(categories.parentId, category.id));
    const categoryIds = [category.id, ...children.map((c) => c.id)];

    const deals = await fastify.db
      .select({
        slug: dealCandidates.slug,
        dealScore: dealCandidates.dealScore,
        realDiscountPercentage: dealCandidates.realDiscountPercentage,
        productName: products.name,
        imageUrl: products.imageUrl,
        marketplace: marketplaceProducts.marketplace,
        effectivePriceCents: offers.effectivePriceCents,
        currency: offers.currency,
      })
      .from(dealCandidates)
      .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
      .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
      .innerJoin(products, eq(marketplaceProducts.productId, products.id))
      .where(and(inArray(products.categoryId, categoryIds), eq(dealCandidates.status, "published")))
      .orderBy(desc(dealCandidates.dealScore));

    return {
      category,
      children,
      deals: deals.map((d) => ({ ...d, scoreLabel: getScoreLabel(d.dealScore) })),
    };
  });
}
