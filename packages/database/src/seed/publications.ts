import { createRedirectCode } from "@dev-das-promos/affiliate";
import { getScoreLabel } from "@dev-das-promos/config";
import {
  type DealContentInput,
  TemplateContentGenerator,
  createPublisherRegistry,
} from "@dev-das-promos/content-engine";
import { createProviderRegistry } from "@dev-das-promos/providers";
import type { Marketplace } from "@dev-das-promos/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { getPriceHistorySummary } from "../price-history.js";
import {
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
  publications,
  redirects,
} from "../schema/index.js";
import type { SeededDeal } from "./deals.js";

// /go/:code is served by apps/api (see routes/go.ts), not the public web app.
const API_URL = process.env.API_URL || "http://localhost:4000";

const MARKETPLACE_LABEL: Record<Marketplace, string> = {
  amazon_br: "Amazon Brasil",
  shopee_br: "Shopee Brasil",
  mercado_livre: "Mercado Livre",
};

/**
 * Publishes the strongest deals end-to-end (redirect + content + mock
 * publish on all three channels) so the seeded database demonstrates the
 * full pipeline, not just raw scored candidates.
 */
export async function seedPublications(db: Database, deals: SeededDeal[]): Promise<void> {
  const toPublish = [...deals]
    .filter((d) => d.status === "auto_approved" || d.status === "approved")
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const providerRegistry = createProviderRegistry({
    amazonAffiliateTag: process.env.AMAZON_AFFILIATE_TAG || "dasdeals-20",
    shopeeAffiliateId: process.env.SHOPEE_AFFILIATE_ID || "dasdeals",
  });
  const publisherRegistry = createPublisherRegistry();
  const contentGenerator = new TemplateContentGenerator();

  for (const deal of toPublish) {
    const [row] = await db
      .select({
        dealScore: dealCandidates.dealScore,
        realDiscountPercentage: dealCandidates.realDiscountPercentage,
        advertisedDiscountPercentage: dealCandidates.advertisedDiscountPercentage,
        signals: dealCandidates.signals,
        reasoning: dealCandidates.reasoning,
        offerPriceCents: offers.priceCents,
        offerOriginalPriceCents: offers.originalPriceCents,
        offerEffectivePriceCents: offers.effectivePriceCents,
        offerCurrency: offers.currency,
        marketplaceProductId: marketplaceProducts.id,
        marketplace: marketplaceProducts.marketplace,
        externalId: marketplaceProducts.externalId,
        url: marketplaceProducts.url,
        sellerName: marketplaceProducts.sellerName,
        productName: products.name,
        brand: products.brand,
      })
      .from(dealCandidates)
      .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
      .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
      .innerJoin(products, eq(marketplaceProducts.productId, products.id))
      .where(eq(dealCandidates.id, deal.dealCandidateId));

    if (!row) continue;

    const history = await getPriceHistorySummary(db, row.marketplaceProductId);
    const provider = providerRegistry[row.marketplace];
    const affiliateUrl = await provider.buildAffiliateUrl(
      { externalId: row.externalId, productName: row.productName, url: row.url },
      { campaign: "seed-launch" },
    );

    for (const channel of ["telegram", "x", "web"] as const) {
      const code = createRedirectCode();
      const goUrl = `${API_URL.replace(/\/+$/, "")}/go/${code}`;

      const [redirectRow] = await db
        .insert(redirects)
        .values({
          code,
          dealCandidateId: deal.dealCandidateId,
          destinationUrl: affiliateUrl,
          channel,
          campaign: "seed-launch",
          source: MARKETPLACE_LABEL[row.marketplace],
        })
        .returning();
      if (!redirectRow) continue;

      const contentInput: DealContentInput = {
        productName: row.productName,
        brand: row.brand ?? undefined,
        marketplace: row.marketplace,
        sellerName: row.sellerName ?? undefined,
        currency: row.offerCurrency,
        effectivePriceCents: row.offerEffectivePriceCents,
        originalPriceCents: row.offerOriginalPriceCents ?? undefined,
        baselinePriceCents: history.avg90dCents ?? history.avg30dCents,
        baselineLabel: history.avg90dCents
          ? "média de 90 dias"
          : history.avg30dCents
            ? "média de 30 dias"
            : undefined,
        realDiscountPercentage: row.realDiscountPercentage,
        dealScore: row.dealScore,
        scoreLabel: getScoreLabel(row.dealScore),
        signals: row.signals,
        reasoning: row.reasoning ?? undefined,
        goUrl,
      };

      const generated = await contentGenerator.generateDealContent(contentInput);
      const content =
        channel === "telegram"
          ? generated.telegram
          : channel === "x"
            ? generated.x
            : generated.webSummary;

      const publisher = publisherRegistry[channel];
      const result = await publisher.publish({
        dealCandidateId: deal.dealCandidateId,
        channel,
        content,
      });

      await db.insert(publications).values({
        dealCandidateId: deal.dealCandidateId,
        channel,
        externalPublicationId: result.externalPublicationId,
        status: result.status === "published" ? "published" : "failed",
        content,
        publishedAt: result.publishedAt,
        errorMessage: result.errorMessage,
      });
    }

    await db
      .update(dealCandidates)
      .set({ status: "published" })
      .where(eq(dealCandidates.id, deal.dealCandidateId));
  }

  // Keep the in-memory list's status consistent for any later seed step that reads it.
  const publishedIds = new Set(toPublish.map((d) => d.dealCandidateId));
  for (const deal of deals) {
    if (publishedIds.has(deal.dealCandidateId)) deal.status = "published";
  }
}
