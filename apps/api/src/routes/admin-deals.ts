import { getScoreLabel } from "@dev-das-promos/config";
import {
  type Database,
  dealCandidateStatusEnum,
  dealCandidates,
  marketplaceEnum,
  marketplaceProducts,
  offers,
  products,
  publications,
} from "@dev-das-promos/database";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import {
  affiliateLinkSupportError,
  requiresManualAffiliateLink,
} from "../lib/affiliate-link-support.js";
import { isOfferCurrent } from "../lib/deal-freshness.js";
import {
  hasRealMarketplaceCredentials,
  realMarketplaceCredentialsError,
} from "../lib/provider-registry-options.js";
import { approveDeal, reEvaluateDeal, rejectDeal } from "../services/approval.js";
import { loadDealContext } from "../services/deal-context.js";

const listQuerySchema = z.object({
  status: z.enum(dealCandidateStatusEnum.enumValues).optional(),
  marketplace: z.enum(marketplaceEnum.enumValues).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

async function listDeals(db: Database, query: z.infer<typeof listQuerySchema>) {
  const conditions = [
    query.status ? eq(dealCandidates.status, query.status) : undefined,
    query.marketplace ? eq(marketplaceProducts.marketplace, query.marketplace) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: dealCandidates.id,
      slug: dealCandidates.slug,
      dealScore: dealCandidates.dealScore,
      realDiscountPercentage: dealCandidates.realDiscountPercentage,
      commissionScore: dealCandidates.commissionScore,
      status: dealCandidates.status,
      createdAt: dealCandidates.createdAt,
      productName: products.name,
      marketplace: marketplaceProducts.marketplace,
      priceCents: offers.effectivePriceCents,
    })
    .from(dealCandidates)
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .innerJoin(products, eq(marketplaceProducts.productId, products.id))
    .where(whereClause)
    .orderBy(desc(dealCandidates.dealScore))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(dealCandidates)
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .where(whereClause);

  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

export default async function adminDealsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAdmin);

  fastify.get("/admin/deals", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });

    const { rows, total } = await listDeals(fastify.db, parsed.data);
    return { deals: rows, total, page: parsed.data.page, pageSize: parsed.data.pageSize };
  });

  fastify.get("/admin/deals/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await loadDealContext(fastify.db, id);
    if (!context) return reply.code(404).send({ error: "Deal not found" });

    const pubs = await fastify.db
      .select()
      .from(publications)
      .where(eq(publications.dealCandidateId, id));

    return { ...context, scoreLabel: getScoreLabel(context.dealScore), publications: pubs };
  });

  fastify.post("/admin/deals/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [existing] = await fastify.db
      .select({ status: dealCandidates.status })
      .from(dealCandidates)
      .where(eq(dealCandidates.id, id));
    if (!existing) return reply.code(404).send({ error: "Deal not found" });
    if (!["pending", "auto_approved", "rejected"].includes(existing.status)) {
      return reply
        .code(409)
        .send({ error: `Deal cannot be approved from status ${existing.status}` });
    }

    const updated = await approveDeal(fastify.db, id, request.currentAdmin?.email ?? "admin");
    if (!updated)
      return reply.code(409).send({ error: "Deal status changed; reload and try again" });
    return updated;
  });

  fastify.post("/admin/deals/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const [existing] = await fastify.db
      .select({ status: dealCandidates.status })
      .from(dealCandidates)
      .where(eq(dealCandidates.id, id));
    if (!existing) return reply.code(404).send({ error: "Deal not found" });
    if (!["pending", "approved", "auto_approved", "published"].includes(existing.status)) {
      return reply
        .code(409)
        .send({ error: `Deal cannot be rejected from status ${existing.status}` });
    }

    const updated = await rejectDeal(fastify.db, id, request.currentAdmin?.email ?? "admin");
    if (!updated)
      return reply.code(409).send({ error: "Deal status changed; reload and try again" });
    return updated;
  });

  fastify.post("/admin/deals/:id/re-evaluate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await reEvaluateDeal(fastify.db, id);
    if (!result) return reply.code(404).send({ error: "Deal not found" });
    return result;
  });

  fastify.post("/admin/deals/:id/publish", async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = await loadDealContext(fastify.db, id);
    if (!context) return reply.code(404).send({ error: "Deal not found" });

    if (env.NODE_ENV === "production" && context.isDemoListing) {
      return reply
        .code(409)
        .send({ error: "Demo marketplace offers cannot be published in production" });
    }
    if (requiresManualAffiliateLink(context.marketplace, env.NODE_ENV)) {
      return reply.code(409).send({ error: affiliateLinkSupportError(context.marketplace) });
    }
    if (env.NODE_ENV === "production" && !hasRealMarketplaceCredentials(env, context.marketplace)) {
      return reply.code(409).send({
        error: realMarketplaceCredentialsError(context.marketplace, true),
      });
    }

    if (context.status === "rejected" || context.status === "pending") {
      return reply
        .code(409)
        .send({ error: `Deal must be approved before publishing (status: ${context.status})` });
    }
    if (!isOfferCurrent(context.availability, context.capturedAt) || context.status === "expired") {
      return reply.code(409).send({ error: "Deal has no current available offer" });
    }

    const [existingPublication] = await fastify.db
      .select({ id: publications.id, status: publications.status })
      .from(publications)
      .where(
        and(
          eq(publications.dealCandidateId, id),
          inArray(publications.status, ["failed", "publishing"]),
        ),
      )
      .limit(1);
    if (existingPublication) {
      return reply.code(409).send({
        error:
          "A publication is failed or in progress. Check Publications and retry only when the action is available.",
      });
    }

    await fastify.queues.contentGeneration.add("generate", { dealCandidateId: id });
    return { queued: true };
  });
}
