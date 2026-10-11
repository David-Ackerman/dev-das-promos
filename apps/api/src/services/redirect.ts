import { type UtmParams, buildClickTrackingRecord } from "@dev-das-promos/affiliate";
import {
  type Database,
  clickEvents,
  dealCandidates,
  marketplaceProducts,
  offers,
  redirects,
} from "@dev-das-promos/database";
import type { Marketplace, PublicationChannel } from "@dev-das-promos/shared";
import { eq, sql } from "drizzle-orm";
import { env } from "../env.js";

export interface RedirectClickInput {
  ip: string | undefined;
  userAgent: string | undefined;
  referrer: string | undefined;
  utm?: UtmParams;
}

export interface ResolvedRedirect {
  destinationUrl: string;
  marketplace: Marketplace;
  dealStatus: string;
  availability: (typeof offers.$inferSelect)["availability"];
  capturedAt: Date;
  dealCandidateId: string;
  channel: PublicationChannel | null;
  campaign: string | null;
  source: string | null;
  isDemoListing: boolean;
  redirectId: string;
}

/**
 * Looks up a redirect code. The destination NEVER comes from the request
 * -- only from what we stored server-side when the redirect was created.
 * GET /go/:code validates that the deal is still public and fresh, then
 * checks the destination against the marketplace's HTTPS host allowlist.
 */
export async function resolveRedirect(
  db: Database,
  code: string,
): Promise<ResolvedRedirect | null> {
  const [row] = await db
    .select({
      id: redirects.id,
      destinationUrl: redirects.destinationUrl,
      dealCandidateId: redirects.dealCandidateId,
      channel: redirects.channel,
      campaign: redirects.campaign,
      source: redirects.source,
      marketplace: marketplaceProducts.marketplace,
      isDemoListing: sql<boolean>`coalesce(${marketplaceProducts.metadata}->>'source' = 'mock', false) or (${marketplaceProducts.metadata} ? 'catalogKey')`,
      dealStatus: dealCandidates.status,
      availability: offers.availability,
      capturedAt: offers.capturedAt,
    })
    .from(redirects)
    .innerJoin(dealCandidates, eq(redirects.dealCandidateId, dealCandidates.id))
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .where(eq(redirects.code, code));
  if (!row) return null;

  return {
    destinationUrl: row.destinationUrl,
    marketplace: row.marketplace,
    dealStatus: row.dealStatus,
    availability: row.availability,
    capturedAt: row.capturedAt,
    dealCandidateId: row.dealCandidateId,
    channel: row.channel,
    campaign: row.campaign,
    source: row.source,
    isDemoListing: row.isDemoListing,
    redirectId: row.id,
  };
}

/**
 * Records the click asynchronously (fire-and-forget, errors logged, never
 * awaited by the caller) so the 302 response is never held up by
 * tracking. Never stores a raw IP -- see packages/affiliate/click-tracking.ts.
 */
export function trackClickAsync(
  db: Database,
  redirect: ResolvedRedirect,
  input: RedirectClickInput,
): void {
  const record = buildClickTrackingRecord({
    ip: input.ip,
    ipHashSalt: env.AUTH_SECRET,
    userAgent: input.userAgent,
    referrer: input.referrer,
  });

  db.insert(clickEvents)
    .values({
      redirectId: redirect.redirectId,
      dealCandidateId: redirect.dealCandidateId,
      channel: redirect.channel,
      campaign: redirect.campaign,
      source: redirect.source,
      referrer: record.referrer,
      userAgentSummary: record.userAgentSummary,
      ipHash: record.ipHash,
      metadata: {
        ...(input.utm?.utmSource ? { utm_source: input.utm.utmSource } : {}),
        ...(input.utm?.utmMedium ? { utm_medium: input.utm.utmMedium } : {}),
        ...(input.utm?.utmCampaign ? { utm_campaign: input.utm.utmCampaign } : {}),
      },
    })
    .catch((error: unknown) => {
      console.error("Failed to record click event:", error);
    });
}
