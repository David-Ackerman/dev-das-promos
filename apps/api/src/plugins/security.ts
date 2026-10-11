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
  const adminOrigin = new URL(env.ADMIN_URL).origin;

  fastify.addHook("onRequest", async (request, reply) => {
    if (env.NODE_ENV !== "production") return;

    const rawPath = request.url.split("?", 1)[0] ?? request.url;
    let normalizedPath = rawPath;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const decodedPath = decodeURIComponent(normalizedPath);
        if (decodedPath === normalizedPath) break;
        normalizedPath = decodedPath;
      }
    } catch {
      // Malformed encodings cannot turn an unrelated path into a trusted route.
    }
    normalizedPath = normalizedPath.replaceAll("\\", "/").replace(/\/{2,}/g, "/");

    // Match the resolved route template first: Fastify may percent-decode
    // path segments before selecting a handler, while request.url remains raw.
    const routePath = request.routeOptions.url || normalizedPath;
    const isAdminOrAuthPath = routePath.startsWith("/admin/") || routePath.startsWith("/auth/");
    if (!isAdminOrAuthPath) return;

    const origin = request.headers.origin;
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
    // The public site is also an allowed CORS origin for unauthenticated
    // browsing. Never let it use a domain-scoped admin cookie to read private
    // routes. SSR requests from the admin server have no Origin header; browser
    // requests must come from the exact admin origin.
    if (
      (origin !== undefined && origin !== adminOrigin) ||
      (isMutation && origin !== adminOrigin)
    ) {
      await reply.code(403).send({ error: "Invalid request origin" });
    }
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // API returns JSON/redirects only, never renders HTML itself.
  });

  await fastify.register(cors, {
    origin: [new URL(env.ADMIN_URL).origin, new URL(env.PUBLIC_WEB_URL).origin],
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
