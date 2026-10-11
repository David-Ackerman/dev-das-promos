import { createPublisherRegistry } from "@dev-das-promos/content-engine";
import { type Database, dealCandidates, publications } from "@dev-das-promos/database";
import type { PublicationChannel } from "@dev-das-promos/shared";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../env.js";
import {
  affiliateLinkSupportError,
  requiresManualAffiliateLink,
} from "../lib/affiliate-link-support.js";
import { isOfferCurrent, isPublishableDealStatus } from "../lib/deal-freshness.js";
import { loadDealContext } from "./deal-context.js";

const publisherRegistry = createPublisherRegistry({
  telegram: { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID },
  x: {
    apiKey: env.X_API_KEY,
    apiSecret: env.X_API_SECRET,
    accessToken: env.X_ACCESS_TOKEN,
    accessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
  },
});

/**
 * Sends a deal's already-generated content to one channel via the
 * configured Publisher (mock unless real credentials are set -- see
 * packages/content-engine/publishers). Marks the candidate "published" once
 * at least one channel succeeds. Public routes separately require a
 * successful `web` publication before exposing a deal.
 */
export async function publishDealToChannel(
  db: Database,
  dealCandidateId: string,
  channel: PublicationChannel,
): Promise<{ status: string; errorMessage?: string }> {
  if (
    env.NODE_ENV === "production" &&
    ((channel === "telegram" && !(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)) ||
      (channel === "x" &&
        !(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET)))
  ) {
    throw new Error(`Real ${channel} credentials are required for production publishing`);
  }

  const [publication] = await db
    .select()
    .from(publications)
    .where(
      and(eq(publications.dealCandidateId, dealCandidateId), eq(publications.channel, channel)),
    );

  if (!publication || !publication.content) {
    throw new Error(
      `No generated content for deal ${dealCandidateId} on channel ${channel}. Run content generation first.`,
    );
  }

  const context = await loadDealContext(db, dealCandidateId);
  if (env.NODE_ENV === "production" && context?.isDemoListing) {
    throw new Error("Demo marketplace offers cannot be published in production");
  }
  if (context && requiresManualAffiliateLink(context.marketplace, env.NODE_ENV)) {
    throw new Error(affiliateLinkSupportError(context.marketplace));
  }
  if (
    !context ||
    !isOfferCurrent(context.availability, context.capturedAt) ||
    !isPublishableDealStatus(context.status)
  ) {
    throw new Error(
      `Deal candidate ${dealCandidateId} is not approved for publishing or has no current available offer`,
    );
  }

  // Claim the row before contacting an external API. Duplicate queue jobs
  // must not send the same Telegram/X post twice.
  const [claimed] = await db
    .update(publications)
    .set({ status: "publishing", errorMessage: null })
    .where(and(eq(publications.id, publication.id), eq(publications.status, "queued")))
    .returning({
      id: publications.id,
      content: publications.content,
      metadata: publications.metadata,
    });

  if (!claimed) return { status: publication.status };

  // Reload after claiming so a concurrent re-generation cannot leave us
  // holding the previous content while the row contains the new snapshot.
  const latestContext = await loadDealContext(db, dealCandidateId);
  if (
    !latestContext ||
    (env.NODE_ENV === "production" && latestContext.isDemoListing) ||
    !isOfferCurrent(latestContext.availability, latestContext.capturedAt) ||
    !isPublishableDealStatus(latestContext.status)
  ) {
    const errorMessage =
      env.NODE_ENV === "production" && latestContext?.isDemoListing
        ? "Demo marketplace offers cannot be published in production."
        : "Deal is no longer approved for publishing or has no current available offer.";
    await db
      .update(publications)
      .set({ status: "failed", errorMessage })
      .where(and(eq(publications.id, claimed.id), eq(publications.status, "publishing")));
    return { status: "failed", errorMessage };
  }

  if (!claimed.content || claimed.metadata.offerId !== latestContext.offerId) {
    const errorMessage = "Offer changed after content generation; retry to regenerate this post.";
    await db
      .update(publications)
      .set({ status: "failed", errorMessage })
      .where(and(eq(publications.id, claimed.id), eq(publications.status, "publishing")));
    return { status: "failed", errorMessage };
  }

  const publisher = publisherRegistry[channel];
  let result: Awaited<ReturnType<typeof publisher.publish>>;
  try {
    result = await publisher.publish({
      dealCandidateId,
      channel,
      content: claimed.content,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(publications)
      .set({
        status: "failed",
        errorMessage,
      })
      .where(and(eq(publications.id, claimed.id), eq(publications.status, "publishing")));
    // A transport error can happen after the channel accepted the post.
    // Do not let BullMQ automatically repeat an externally-visible action;
    // an operator can inspect the channel and use the explicit retry flow.
    return { status: "failed", errorMessage };
  }

  const [completed] = await db
    .update(publications)
    .set({
      status: result.status === "published" ? "published" : "failed",
      externalPublicationId: result.externalPublicationId,
      publishedAt: result.publishedAt,
      errorMessage: result.errorMessage,
    })
    .where(and(eq(publications.id, claimed.id), eq(publications.status, "publishing")))
    .returning({ id: publications.id });

  if (result.status === "published" && completed) {
    await db
      .update(dealCandidates)
      .set({ status: "published" })
      .where(
        and(
          eq(dealCandidates.id, dealCandidateId),
          inArray(dealCandidates.status, ["approved", "auto_approved", "published"]),
        ),
      );
  }

  return { status: completed ? result.status : "skipped", errorMessage: result.errorMessage };
}
