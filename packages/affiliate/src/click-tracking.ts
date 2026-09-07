import { hashIp } from "@dev-das-promos/shared";

/**
 * Coarse device/browser summary instead of the raw User-Agent string --
 * enough to segment analytics (mobile vs desktop, browser family) without
 * retaining a near-unique fingerprint per visitor.
 */
export function summarizeUserAgent(userAgent: string | undefined | null): string | undefined {
  if (!userAgent) return undefined;

  const device = /mobile|android|iphone/i.test(userAgent) ? "mobile" : "desktop";

  let browser = "other";
  if (/edg\//i.test(userAgent)) browser = "edge";
  else if (/chrome\//i.test(userAgent)) browser = "chrome";
  else if (/firefox\//i.test(userAgent)) browser = "firefox";
  else if (/safari\//i.test(userAgent)) browser = "safari";

  return `${device}:${browser}`;
}

export interface ClickTrackingInput {
  ip: string | undefined;
  ipHashSalt: string;
  userAgent: string | undefined;
  referrer: string | undefined;
}

export interface ClickTrackingRecord {
  ipHash: string | undefined;
  userAgentSummary: string | undefined;
  referrer: string | undefined;
}

/**
 * Builds the privacy-safe record persisted for a click. Raw IP is hashed
 * (never stored) and the user agent is reduced to a coarse summary; see
 * packages/database/schema/click-event.ts for the storage shape.
 */
export function buildClickTrackingRecord(input: ClickTrackingInput): ClickTrackingRecord {
  return {
    ipHash: input.ip ? hashIp(input.ip, input.ipHashSalt) : undefined,
    userAgentSummary: summarizeUserAgent(input.userAgent),
    referrer: input.referrer,
  };
}
