import { createRedirectCode, isAllowedAffiliateDestination } from "@dev-das-promos/affiliate";
import { getScoreLabel } from "@dev-das-promos/config";
import {
  type ContentGenerator,
  type DealContentInput,
  type GeneratedDealContent,
  TemplateContentGenerator,
  createOpenRouterContentGenerator,
} from "@dev-das-promos/content-engine";
import { type Database, publications, redirects } from "@dev-das-promos/database";
import { createProviderRegistry } from "@dev-das-promos/providers";
import type { QueueBundle, Redis } from "@dev-das-promos/queue";
import type { PublicationChannel } from "@dev-das-promos/shared";
import { and, eq } from "drizzle-orm";
import { env } from "../env.js";
import {
  affiliateLinkSupportError,
  requiresManualAffiliateLink,
} from "../lib/affiliate-link-support.js";
import { reserveDailyAiContentSlot } from "../lib/ai-content-quota.js";
import { isOfferCurrent, isPublishableDealStatus } from "../lib/deal-freshness.js";
import {
  hasRealMarketplaceCredentials,
  providerRegistryOptionsFromEnv,
} from "../lib/provider-registry-options.js";
import { loadDealContext } from "./deal-context.js";

const templateGenerator = new TemplateContentGenerator();
const openRouterGenerator = createOpenRouterContentGenerator({
  apiKey: env.OPENROUTER_API_KEY,
  model: env.OPENROUTER_MODEL,
});
const openRouterConfigured = Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL);
const CHANNELS: PublicationChannel[] =
  env.NODE_ENV === "production"
    ? [
        ...(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? (["telegram"] as const) : []),
        ...(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET
          ? (["x"] as const)
          : []),
        "web",
      ]
    : ["telegram", "x", "web"];

/**
 * Picks the AI generator for this deal only if OpenRouter is configured
 * AND today's free-tier quota (AI_CONTENT_DAILY_LIMIT, see
 * apps/api/src/lib/ai-content-quota.ts) has room -- one reservation per
 * deal, reused across all of that deal's channels below, not one per
 * channel, so a single deal never costs 3x its fair share of the daily
 * budget. Falls back to the always-available template generator
 * otherwise, exactly like a provider/publisher falls back to its mock
 * when real credentials are absent.
 */
async function pickContentGenerator(redis: Redis): Promise<ContentGenerator> {
  if (!openRouterConfigured) return templateGenerator;
  const hasQuota = await reserveDailyAiContentSlot(redis, env.AI_CONTENT_DAILY_LIMIT);
  return hasQuota ? openRouterGenerator : templateGenerator;
}

/** Never let a flaky/rate-limited AI call block the whole publication pipeline. */
async function generateWithFallback(
  generator: ContentGenerator,
  input: DealContentInput,
): Promise<GeneratedDealContent> {
  try {
    return await generator.generateDealContent(input);
  } catch (error) {
    if (generator === templateGenerator) throw error;
    console.warn(
      `OpenRouter content generation failed, falling back to templates: ${error instanceof Error ? error.message : String(error)}`,
    );
    return templateGenerator.generateDealContent(input);
  }
}

/**
 * Finds or creates the /go/:code redirect for a deal+channel. The
 * destination is resolved once, server-side, from the provider's
 * affiliate URL builder -- never from client input (see
 * packages/affiliate/redirect.ts for why that matters).
 */
async function findOrCreateRedirect(
  db: Database,
  dealCandidateId: string,
  channel: PublicationChannel,
  destinationUrl: string,
): Promise<string> {
  const [existing] = await db
    .select()
    .from(redirects)
    .where(and(eq(redirects.dealCandidateId, dealCandidateId), eq(redirects.channel, channel)));
  if (existing) {
    await db.update(redirects).set({ destinationUrl }).where(eq(redirects.id, existing.id));
    return existing.code;
  }

  const code = createRedirectCode();
  await db
    .insert(redirects)
    .values({ code, dealCandidateId, destinationUrl, channel, campaign: "auto" });
  return code;
}

/**
 * Generates channel content for a deal and stores it as a "queued"
 * Publication row per channel, then enqueues the actual publish job.
 * Kept separate from `publishDealToChannel` so content generation (cheap,
 * deterministic, safe to retry) and the actual channel call (can fail,
 * hits an external API) are independent, individually-retryable steps.
 */
export async function generateContentForDeal(
  db: Database,
  queues: QueueBundle,
  dealCandidateId: string,
  redis: Redis,
  options: { scheduled?: boolean; channel?: PublicationChannel } = {},
): Promise<void> {
  const context = await loadDealContext(db, dealCandidateId);
  if (!context) throw new Error(`Deal candidate ${dealCandidateId} not found`);
  if (env.NODE_ENV === "production" && context.isDemoListing) {
    throw new Error("Demo marketplace offers cannot be published in production");
  }
  if (requiresManualAffiliateLink(context.marketplace, env.NODE_ENV)) {
    throw new Error(affiliateLinkSupportError(context.marketplace));
  }
  if (env.NODE_ENV === "production" && !hasRealMarketplaceCredentials(env, context.marketplace)) {
    throw new Error(
      `Real ${context.marketplace} credentials are required for production content generation`,
    );
  }
  if (!isPublishableDealStatus(context.status)) {
    throw new Error(
      `Deal candidate ${dealCandidateId} cannot be published from status ${context.status}`,
    );
  }
  if (!isOfferCurrent(context.availability, context.capturedAt)) {
    throw new Error(`Deal candidate ${dealCandidateId} has no current available offer`);
  }

  const providerRegistry = createProviderRegistry(providerRegistryOptionsFromEnv(env));
  const provider = providerRegistry[context.marketplace];
  const affiliateUrl = await provider.buildAffiliateUrl(
    { externalId: context.externalId, productName: context.productName, url: context.productUrl },
    { campaign: "content-engine" },
  );
  if (!isAllowedAffiliateDestination(context.marketplace, affiliateUrl)) {
    throw new Error(`Affiliate URL for ${context.marketplace} has an invalid destination domain`);
  }
  // Validation parses the URL but the stored destination remains the exact
  // provider-vended string; serializing through `URL` can normalize it.
  const affiliateDestinationUrl = affiliateUrl;
  // A deal can have redirects for several channels. A channel-scoped retry
  // must not leave the public web CTA pointing to an older offer snapshot.
  await db
    .update(redirects)
    .set({ destinationUrl: affiliateDestinationUrl })
    .where(eq(redirects.dealCandidateId, dealCandidateId));

  // One quota reservation for the whole deal, reused across channels below.
  // Existing content for the same offer snapshot is retried as-is, without
  // spending a new AI slot.
  let generator: ContentGenerator | undefined;

  const channels = options.channel ? [options.channel] : CHANNELS;
  for (const channel of channels) {
    const [existingPublication] = await db
      .select()
      .from(publications)
      .where(
        and(eq(publications.dealCandidateId, dealCandidateId), eq(publications.channel, channel)),
      );

    const publicationMatchesSnapshot = existingPublication?.metadata.offerId === context.offerId;
    if (
      (existingPublication?.status === "published" && publicationMatchesSnapshot) ||
      existingPublication?.status === "publishing" ||
      (existingPublication?.status === "failed" && !options.channel)
    )
      continue;

    const code = await findOrCreateRedirect(db, dealCandidateId, channel, affiliateDestinationUrl);
    // /go/:code is served by this API (see routes/go.ts), not the public web app.
    const goUrl = `${env.API_URL.replace(/\/+$/, "")}/go/${code}`;

    const baselinePriceCents = context.history.avg90dCents ?? context.history.avg30dCents;
    const baselineLabel = context.history.avg90dCents
      ? "média de 90 dias"
      : context.history.avg30dCents
        ? "média de 30 dias"
        : undefined;

    const input: DealContentInput = {
      productName: context.productName,
      brand: context.brand ?? undefined,
      marketplace: context.marketplace,
      sellerName: context.sellerName ?? undefined,
      currency: context.currency,
      effectivePriceCents: context.effectivePriceCents,
      originalPriceCents: context.originalPriceCents ?? undefined,
      baselinePriceCents,
      baselineLabel,
      realDiscountPercentage: context.realDiscountPercentage,
      dealScore: context.dealScore,
      scoreLabel: getScoreLabel(context.dealScore),
      signals: context.signals,
      reasoning: context.reasoning ?? undefined,
      goUrl,
    };

    const contentMatchesSnapshot =
      existingPublication?.metadata.offerId === context.offerId &&
      Boolean(existingPublication.content);
    let content = contentMatchesSnapshot ? (existingPublication?.content ?? null) : null;
    if (!content) {
      generator ??= await pickContentGenerator(redis);
      const generated = await generateWithFallback(generator, input);
      content =
        channel === "telegram"
          ? generated.telegram
          : channel === "x"
            ? generated.x
            : generated.webSummary;
    }

    if (existingPublication?.status === "queued") {
      // A prior generator may have persisted content before its queue add.
      // Keep it only when it was generated from this same offer snapshot.
      if (
        existingPublication.metadata.offerId !== context.offerId ||
        !existingPublication.content
      ) {
        await db
          .update(publications)
          .set({
            content,
            externalPublicationId: null,
            publishedAt: null,
            errorMessage: null,
            metadata: { ...existingPublication.metadata, offerId: context.offerId },
          })
          .where(eq(publications.id, existingPublication.id));
      }
    } else if (existingPublication) {
      await db
        .update(publications)
        .set({
          content,
          status: "queued",
          externalPublicationId: null,
          publishedAt: null,
          errorMessage: null,
          metadata: { ...existingPublication.metadata, offerId: context.offerId },
        })
        .where(eq(publications.id, existingPublication.id));
    } else {
      await db.insert(publications).values({
        dealCandidateId,
        channel,
        content,
        status: "queued",
        metadata: { offerId: context.offerId },
      });
    }

    await queues.publication.add("publish", {
      dealCandidateId,
      channel,
      ...(options.scheduled ? { scheduled: true } : {}),
    });
  }
}
