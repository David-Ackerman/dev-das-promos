import { buildClickTrackingRecord } from "@dev-das-promos/affiliate";
import { type Database, clickEvents, redirects } from "@dev-das-promos/database";
import type { PublicationChannel } from "@dev-das-promos/shared";
import { eq } from "drizzle-orm";
import { env } from "../env.js";

export interface RedirectClickInput {
  ip: string | undefined;
  userAgent: string | undefined;
  referrer: string | undefined;
}

export interface ResolvedRedirect {
  destinationUrl: string;
  dealCandidateId: string;
  channel: PublicationChannel | null;
  campaign: string | null;
  source: string | null;
  redirectId: string;
}

/**
 * Looks up a redirect code. The destination NEVER comes from the request
 * -- only from what we stored server-side when the redirect was created
 * -- which is what keeps GET /go/:code from being an open redirect.
 */
export async function resolveRedirect(
  db: Database,
  code: string,
): Promise<ResolvedRedirect | null> {
  const [row] = await db.select().from(redirects).where(eq(redirects.code, code));
  if (!row) return null;

  return {
    destinationUrl: row.destinationUrl,
    dealCandidateId: row.dealCandidateId,
    channel: row.channel,
    campaign: row.campaign,
    source: row.source,
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
    })
    .catch((error: unknown) => {
      console.error("Failed to record click event:", error);
    });
}
