import { marketplaceEnum } from "@dev-das-promos/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const bodySchema = z.object({
  marketplace: z.enum(marketplaceEnum.enumValues),
  category: z.string().optional(),
});

export default async function adminIngestionRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.requireAdmin);

  fastify.post("/admin/ingestion/run", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    await fastify.queues.offerIngestion.add("ingest", parsed.data);
    return { queued: true, marketplace: parsed.data.marketplace };
  });
}
