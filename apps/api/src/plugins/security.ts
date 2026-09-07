import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

/**
 * Baseline HTTP security: strict CORS (only the two known frontends, with
 * credentials for the admin's cookie session), secure headers via helmet,
 * signed cookies for the admin session, and a conservative global rate
 * limit. Route-specific limits (e.g. /go/:code) are tighter and are
 * applied per-route.
 */
export default fp(async function securityPlugin(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // API returns JSON/redirects only, never renders HTML itself.
  });

  await fastify.register(cors, {
    origin: [env.ADMIN_URL, env.PUBLIC_WEB_URL],
    credentials: true,
  });

  await fastify.register(cookie, {
    secret: env.AUTH_SECRET,
  });

  await fastify.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });
});
