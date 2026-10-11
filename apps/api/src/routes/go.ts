import {
  extractUtmParams,
  isAllowedAffiliateDestination,
  isValidRedirectCode,
} from "@dev-das-promos/affiliate";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { isOfferCurrent } from "../lib/deal-freshness.js";
import { resolveRedirect, trackClickAsync } from "../services/redirect.js";

export default async function goRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/go/:code",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { code } = request.params as { code: string };

      if (!isValidRedirectCode(code)) {
        return reply.code(404).send({ error: "Not found" });
      }

      const redirect = await resolveRedirect(fastify.db, code);
      if (!redirect) {
        return reply.code(404).send({ error: "Not found" });
      }

      if (
        redirect.dealStatus !== "published" ||
        !isOfferCurrent(redirect.availability, redirect.capturedAt) ||
        (env.NODE_ENV === "production" && redirect.isDemoListing)
      ) {
        return reply.code(404).send({ error: "Not found" });
      }

      // Never trust the destination from anywhere but our own stored record.
      if (!isAllowedAffiliateDestination(redirect.marketplace, redirect.destinationUrl)) {
        request.log.error(
          { redirectId: redirect.redirectId, marketplace: redirect.marketplace },
          "Stored affiliate URL has an invalid marketplace domain",
        );
        return reply.code(502).send({ error: "Invalid affiliate destination" });
      }
      const utm = extractUtmParams(request.query as Record<string, unknown>);

      trackClickAsync(fastify.db, redirect, {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        referrer: request.headers.referer,
        utm,
      });

      // Keep API-vended affiliate URLs byte-for-byte intact. Incoming UTM
      // values are recorded with the click instead of being appended to a
      // marketplace URL, which can invalidate affiliate attribution.
      return reply.code(302).redirect(redirect.destinationUrl);
    },
  );
}
