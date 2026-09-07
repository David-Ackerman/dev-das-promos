import { generateRedirectCode } from "@dev-das-promos/shared";

/** Codes are alphanumeric only -- reject anything else before ever hitting the DB. */
const REDIRECT_CODE_PATTERN = /^[a-z0-9]{4,32}$/;

export function isValidRedirectCode(code: string): boolean {
  return REDIRECT_CODE_PATTERN.test(code);
}

export function createRedirectCode(): string {
  return generateRedirectCode(8);
}

/**
 * Builds the public-facing short link for a deal. This never embeds the
 * destination -- the destination is looked up server-side from the
 * `redirects` table by `code`, which is what makes /go/:code safe against
 * becoming an open redirect (see apps/api/src/routes/go.ts).
 */
export function buildGoUrl(publicWebBaseUrl: string, code: string): string {
  return `${publicWebBaseUrl.replace(/\/+$/, "")}/go/${code}`;
}

export interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

const ALLOWED_UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

/**
 * Extracts only the known UTM query params, ignoring everything else.
 * This is what keeps /go/:code from being (ab)used to smuggle arbitrary
 * query data through to the destination.
 */
export function extractUtmParams(query: Record<string, unknown>): UtmParams {
  const result: UtmParams = {};
  for (const key of ALLOWED_UTM_KEYS) {
    const value = query[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 100) {
      const camelKey = ("utm" + key.slice(4, 5).toUpperCase() + key.slice(5)) as keyof UtmParams;
      result[camelKey] = value;
    }
  }
  return result;
}
