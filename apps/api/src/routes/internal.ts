import { marketplaceEnum } from "@dev-das-promos/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireInternalToken } from "../lib/internal-auth.js";
import { approveDeal, reEvaluateDeal, rejectDeal } from "../services/approval.js";
import { loadDealContext } from "../services/deal-context.js";

const ingestionBodySchema = z.object({
  marketplace: z.enum(marketplaceEnum.enumValues),
  category: z.string().optional(),
});

/**
 * n8n-facing endpoints (see docs/n8n.md). Every route here is guarded by
 * the shared X-Internal-Token header -- n8n holds no admin session cookie
 * and is never treated as a logged-in operator.
 */
export default async function internalRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireInternalToken);

  fastify.post("/internal/ingestion/run", async (request, reply) => {
    const parsed = ingestionBodySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });

    await fastify.queues.offerIngestion.add("ingest", parsed.data);
    return { queued: true, marketplace: parsed.data.marketplace };
  });

  fastify.post("/internal/deals/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await approveDeal(fastify.db, id, "n8n");
    if (!updated) return reply.code(404).send({ error: "Deal not found" });
    return updated;
  });

  fastify.post("/internal/deals/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const updated = await rejectDeal(fastify.db, id, "n8n");
    if (!updated) return reply.code(404).send({ error: "Deal not found" });
    return updated;
  });

  fastify.post("/internal/deals/:id/re-evaluate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await reEvaluateDeal(fastify.db, id);
    if (!result) return reply.code(404).send({ error: "Deal not found" });
    return result;
  });

  fastify.post("/internal/deals/:id/publish", async (request, reply) => {
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
