import { createPublisherRegistry } from "@dev-das-promos/content-engine";
import { type Database, dealCandidates, publications } from "@dev-das-promos/database";
import type { PublicationChannel } from "@dev-das-promos/shared";
import { and, eq } from "drizzle-orm";
import { env } from "../env.js";

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
 * packages/content-engine/publishers). Marks the deal "published" once at
 * least one channel succeeds.
 */
export async function publishDealToChannel(
  db: Database,
  dealCandidateId: string,
  channel: PublicationChannel,
): Promise<{ status: string; errorMessage?: string }> {
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

  await db
    .update(publications)
    .set({ status: "publishing" })
    .where(eq(publications.id, publication.id));

  const publisher = publisherRegistry[channel];
  const result = await publisher.publish({
    dealCandidateId,
    channel,
    content: publication.content,
  });

  await db
    .update(publications)
    .set({
      status: result.status === "published" ? "published" : "failed",
      externalPublicationId: result.externalPublicationId,
      publishedAt: result.publishedAt,
      errorMessage: result.errorMessage,
    })
    .where(eq(publications.id, publication.id));

  if (result.status === "published") {
    await db
      .update(dealCandidates)
      .set({ status: "published" })
      .where(and(eq(dealCandidates.id, dealCandidateId)));
  }

  return { status: result.status, errorMessage: result.errorMessage };
}
