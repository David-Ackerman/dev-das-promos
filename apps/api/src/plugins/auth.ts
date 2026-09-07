import { adminUsers } from "@dev-das-promos/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

export const SESSION_COOKIE_NAME = "das_admin_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface CurrentAdmin {
  id: string;
  email: string;
  name: string | null;
}

declare module "fastify" {
  interface FastifyInstance {
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    currentAdmin?: CurrentAdmin;
  }
}

/**
 * MVP admin auth: a signed httpOnly cookie holding the admin user's id
 * (signed via @fastify/cookie, which uses Node's well-tested HMAC signing
 * under the hood -- no custom crypto). This is intentionally simpler than
 * wiring up Auth.js for a single/small set of internal operators; see
 * packages/database/schema/admin-user.ts for the migration note.
 */
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorate("requireAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.cookies[SESSION_COOKIE_NAME];
    if (!raw) {
      await reply.code(401).send({ error: "Not authenticated" });
      return;
    }

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      await reply.code(401).send({ error: "Not authenticated" });
      return;
    }

    const [admin] = await fastify.db
      .select({ id: adminUsers.id, email: adminUsers.email, name: adminUsers.name })
      .from(adminUsers)
      .where(eq(adminUsers.id, unsigned.value));

    if (!admin) {
      await reply.code(401).send({ error: "Not authenticated" });
      return;
    }

    request.currentAdmin = admin;
  });
});

export function setSessionCookie(reply: FastifyReply, adminUserId: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, adminUserId, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}
