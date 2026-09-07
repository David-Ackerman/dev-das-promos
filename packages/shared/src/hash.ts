import { createHash } from "node:crypto";

/**
 * Privacy: we never persist raw IP addresses. Click events store a salted,
 * one-way hash instead, which is enough to de-duplicate/rate-limit clicks
 * without retaining personal data. Rotate DAS_IP_HASH_SALT to invalidate
 * historical linkability if ever required (e.g. by a data request).
 */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}
