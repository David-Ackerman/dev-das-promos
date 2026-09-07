import { extractUtmParams, isValidRedirectCode } from "@dev-das-promos/affiliate";
import type { FastifyInstance } from "fastify";
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

      // Never trust the destination from anywhere but our own stored record.
      const destination = new URL(redirect.destinationUrl);
      const utm = extractUtmParams(request.query as Record<string, unknown>);
      if (utm.utmSource) destination.searchParams.set("utm_source", utm.utmSource);
      if (utm.utmMedium) destination.searchParams.set("utm_medium", utm.utmMedium);
      if (utm.utmCampaign) destination.searchParams.set("utm_campaign", utm.utmCampaign);

      trackClickAsync(fastify.db, redirect, {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        referrer: request.headers.referer,
      });

      return reply.code(302).redirect(destination.toString());
    },
  );
}
