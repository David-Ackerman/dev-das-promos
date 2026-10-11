import { createHash } from "node:crypto";

/**
 * Click tracking stores this truncated, salted one-way hash instead of the
 * raw IP address. The salt is supplied by the caller (currently AUTH_SECRET).
 * HTTP rate limiting is handled separately by Fastify.
 */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}
