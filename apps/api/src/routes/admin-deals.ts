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
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { approveDeal, reEvaluateDeal, rejectDeal } from "../services/approval.js";
import { loadDealContext } from "../services/deal-context.js";

const listQuerySchema = z.object({
  status: z.enum(dealCandidateStatusEnum.enumValues).optional(),
  marketplace: z.enum(marketplaceEnum.enumValues).optional(),
  page: z.coerce.number().int().min(1).default(1),
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
    const updated = await approveDeal(fastify.db, id, request.currentAdmin?.email ?? "admin");
    if (!updated) return reply.code(404).send({ error: "Deal not found" });
    return updated;
  });

  fastify.post("/admin/deals/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await rejectDeal(fastify.db, id, request.currentAdmin?.email ?? "admin");
    if (!updated) return reply.code(404).send({ error: "Deal not found" });
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

    if (context.status === "rejected" || context.status === "pending") {
      return reply
        .code(409)
        .send({ error: `Deal must be approved before publishing (status: ${context.status})` });
    }

    await fastify.queues.contentGeneration.add("generate", { dealCandidateId: id });
    return { queued: true };
  });
}
