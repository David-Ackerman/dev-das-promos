import { adminUsers } from "@dev-das-promos/database";
import { verifyPassword } from "@dev-das-promos/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearSessionCookie, setSessionCookie } from "../plugins/auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const [admin] = await fastify.db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, parsed.data.email));
      if (!admin) {
        return reply.code(401).send({ error: "Invalid email or password" });
      }

      const valid = await verifyPassword(parsed.data.password, admin.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: "Invalid email or password" });
      }

      setSessionCookie(reply, admin.id);
      return { id: admin.id, email: admin.email, name: admin.name };
    },
  );

  fastify.post("/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  fastify.get(
    "/auth/me",
    { preHandler: fastify.requireAdmin },
    async (request) => request.currentAdmin,
  );
}
