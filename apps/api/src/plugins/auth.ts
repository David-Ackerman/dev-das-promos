import { adminUsers } from "@dev-das-promos/database";
import { ADMIN_SESSION_COOKIE_NAME } from "@dev-das-promos/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

export const SESSION_COOKIE_NAME = ADMIN_SESSION_COOKIE_NAME;
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
 * MVP admin auth: a signed httpOnly cookie holding the admin user's id and
 * its expiration time (signed via @fastify/cookie, which uses Node's
 * well-tested HMAC signing under the hood -- no custom crypto). This is
 * intentionally simpler than wiring up Auth.js for a single/small set of
 * internal operators; see packages/database/schema/admin-user.ts.
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

    const [adminId, expirationValue, extra] = unsigned.value.split(".");
    const expirationSeconds = Number(expirationValue);
    if (
      !adminId ||
      !expirationValue ||
      extra !== undefined ||
      !/^\d+$/.test(expirationValue) ||
      !Number.isSafeInteger(expirationSeconds) ||
      expirationSeconds <= Math.floor(Date.now() / 1000)
    ) {
      await reply.code(401).send({ error: "Not authenticated" });
      return;
    }

    const [admin] = await fastify.db
      .select({ id: adminUsers.id, email: adminUsers.email, name: adminUsers.name })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId));

    if (!admin) {
      await reply.code(401).send({ error: "Not authenticated" });
      return;
    }

    request.currentAdmin = admin;
  });
});

export function setSessionCookie(reply: FastifyReply, adminUserId: string): void {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  reply.setCookie(SESSION_COOKIE_NAME, `${adminUserId}.${expiresAt}`, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    domain: env.SESSION_COOKIE_DOMAIN || undefined,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",
    domain: env.SESSION_COOKIE_DOMAIN || undefined,
  });
}
