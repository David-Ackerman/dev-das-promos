import {
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
  publications,
} from "@dev-das-promos/database";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export default async function adminPublicationsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAdmin);

  fastify.get("/admin/publications", async () => {
    const rows = await fastify.db
      .select({
        id: publications.id,
        channel: publications.channel,
        status: publications.status,
        publishedAt: publications.publishedAt,
        externalPublicationId: publications.externalPublicationId,
        errorMessage: publications.errorMessage,
        dealCandidateId: publications.dealCandidateId,
        productName: products.name,
        marketplace: marketplaceProducts.marketplace,
        dealScore: dealCandidates.dealScore,
      })
      .from(publications)
      .innerJoin(dealCandidates, eq(publications.dealCandidateId, dealCandidates.id))
      .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
      .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
      .innerJoin(products, eq(marketplaceProducts.productId, products.id))
      .orderBy(desc(publications.createdAt));

    return { publications: rows };
  });
}
