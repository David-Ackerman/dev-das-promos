import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";

/**
 * Guards /internal/* routes, which n8n calls to trigger ingestion,
 * approvals, and publications (see docs/n8n.md). Requires the shared
 * `X-Internal-Token` header to match INTERNAL_API_TOKEN exactly, compared
 * in constant time to avoid leaking the token via response-timing.
 */
export async function requireInternalToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const provided = request.headers["x-internal-token"];

  if (typeof provided !== "string" || !constantTimeEquals(provided, env.INTERNAL_API_TOKEN)) {
    await reply.code(401).send({ error: "Invalid or missing X-Internal-Token" });
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
