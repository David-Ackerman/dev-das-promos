import {
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
  publications,
} from "@dev-das-promos/database";
import { and, desc, eq, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import {
  affiliateLinkSupportError,
  requiresManualAffiliateLink,
} from "../lib/affiliate-link-support.js";
import {
  hasRealMarketplaceCredentials,
  realMarketplaceCredentialsError,
} from "../lib/provider-registry-options.js";
import { loadDealContext } from "../services/deal-context.js";

export default async function adminPublicationsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAdmin);

  fastify.get("/admin/publications", async () => {
    const rows = await fastify.db
      .select({
        id: publications.id,
        channel: publications.channel,
        status: publications.status,
        updatedAt: publications.updatedAt,
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

  fastify.post(
    "/admin/publications/:id/retry",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const [publication] = await fastify.db
        .select({
          id: publications.id,
          channel: publications.channel,
          status: publications.status,
          dealCandidateId: publications.dealCandidateId,
          updatedAt: publications.updatedAt,
        })
        .from(publications)
        .where(eq(publications.id, id))
        .limit(1);

      if (!publication) return reply.code(404).send({ error: "Publication not found" });
      if (publication.status === "published") {
        return reply.code(409).send({ error: "Publication is already published" });
      }

      const deal = await loadDealContext(fastify.db, publication.dealCandidateId);
      if (env.NODE_ENV === "production" && deal?.isDemoListing) {
        return reply
          .code(409)
          .send({ error: "Demo marketplace offers cannot be published in production" });
      }
      if (deal && requiresManualAffiliateLink(deal.marketplace, env.NODE_ENV)) {
        return reply.code(409).send({ error: affiliateLinkSupportError(deal.marketplace) });
      }
      if (
        deal &&
        env.NODE_ENV === "production" &&
        !hasRealMarketplaceCredentials(env, deal.marketplace)
      ) {
        return reply.code(409).send({
          error: realMarketplaceCredentialsError(deal.marketplace, true),
        });
      }

      const staleCutoff = new Date(Date.now() - 10 * 60 * 1000);
      const retryable =
        publication.status === "failed" ||
        ((publication.status === "queued" || publication.status === "publishing") &&
          publication.updatedAt < staleCutoff);
      if (!retryable) {
        return reply.code(409).send({ error: "Publication is not failed or stale" });
      }

      const eligibleStatus = publication.status;
      const [updated] = await fastify.db
        .update(publications)
        .set({
          status: "queued",
          externalPublicationId: null,
          publishedAt: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(publications.id, id),
            eq(publications.status, eligibleStatus),
            eq(publications.updatedAt, publication.updatedAt),
            ...(eligibleStatus === "failed" ? [] : [lt(publications.updatedAt, staleCutoff)]),
          ),
        )
        .returning({ id: publications.id });

      if (!updated)
        return reply.code(409).send({ error: "Publication changed; refresh and retry" });

      try {
        await fastify.queues.contentGeneration.add("generate", {
          dealCandidateId: publication.dealCandidateId,
          channel: publication.channel,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        fastify.log.error(
          { error, publicationId: publication.id },
          "Failed to enqueue publication retry",
        );
        await fastify.db
          .update(publications)
          .set({ errorMessage, updatedAt: new Date() })
          .where(and(eq(publications.id, id), eq(publications.status, "queued")));
        return reply.code(503).send({
          error: "Could not queue publication retry; try again later",
        });
      }
      return { queued: true };
    },
  );
}
