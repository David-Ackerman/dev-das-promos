import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.js";

import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import queuesPlugin from "./plugins/queues.js";
import securityPlugin from "./plugins/security.js";

import adminAnalyticsRoutes from "./routes/admin-analytics.js";
import adminDealsRoutes from "./routes/admin-deals.js";
import adminIngestionRoutes from "./routes/admin-ingestion.js";
import adminProductsRoutes from "./routes/admin-products.js";
import adminPublicationsRoutes from "./routes/admin-publications.js";
import authRoutes from "./routes/auth.js";
import goRoutes from "./routes/go.js";
import healthRoutes from "./routes/health.js";
import internalRoutes from "./routes/internal.js";
import publicCategoriesRoutes from "./routes/public-categories.js";
import publicDealsRoutes from "./routes/public-deals.js";
import publicProductsRoutes from "./routes/public-products.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "warn",
    },
    // Only the private Docker reverse proxy may supply forwarding headers.
    trustProxy: env.NODE_ENV === "production" ? ["loopback", "linklocal", "uniquelocal"] : false,
  });

  await app.register(securityPlugin);
  await app.register(dbPlugin);
  await app.register(queuesPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(goRoutes);
  await app.register(adminDealsRoutes);
  await app.register(adminProductsRoutes);
  await app.register(adminPublicationsRoutes);
  await app.register(adminAnalyticsRoutes);
  await app.register(adminIngestionRoutes);
  await app.register(publicDealsRoutes);
  await app.register(publicProductsRoutes);
  await app.register(publicCategoriesRoutes);
  await app.register(internalRoutes);

  return app;
}
