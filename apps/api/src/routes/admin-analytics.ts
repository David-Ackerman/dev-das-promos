import { getDashboardTotals, getGroupedAnalytics } from "@dev-das-promos/analytics";
import { marketplaceEnum, publicationChannelEnum } from "@dev-das-promos/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  dimension: z.enum(["channel", "marketplace", "category", "deal", "date"]).optional(),
  channel: z.enum(publicationChannelEnum.enumValues).optional(),
  marketplace: z.enum(marketplaceEnum.enumValues).optional(),
  categoryId: z.string().optional(),
  dealCandidateId: z.string().optional(),
});

export default async function adminAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAdmin);

  fastify.get("/admin/analytics", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });

    const { dimension, ...filters } = parsed.data;

    const totals = await getDashboardTotals(fastify.db, { from: filters.from, to: filters.to });
    const grouped = dimension
      ? await getGroupedAnalytics(fastify.db, dimension, filters)
      : undefined;

    return { totals, dimension, grouped };
  });
}
