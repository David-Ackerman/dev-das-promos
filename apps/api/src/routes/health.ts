import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  fastify.get("/ready", async (_request, reply) => {
    try {
      await fastify.db.execute(sql`select 1`);
      await fastify.redis.ping();
      return { status: "ready" };
    } catch (error) {
      fastify.log.error({ error }, "Readiness check failed");
      return reply.code(503).send({ status: "unavailable" });
    }
  });
}
