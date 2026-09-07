import { seededInt } from "@dev-das-promos/providers";
import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { conversions, dealCandidates, marketplaceProducts, offers } from "../schema/index.js";

/**
 * Mocked conversions -- see packages/database/schema/conversion.ts for why
 * real conversion import isn't wired up yet. This gives analytics
 * something real to aggregate in the demo.
 */
export async function seedConversions(db: Database): Promise<void> {
  const publishedDeals = await db
    .select({
      dealCandidateId: dealCandidates.id,
      marketplace: marketplaceProducts.marketplace,
      effectivePriceCents: offers.effectivePriceCents,
    })
    .from(dealCandidates)
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .where(eq(dealCandidates.status, "published"));

  for (const deal of publishedDeals) {
    const conversionCount = seededInt(`conversions:${deal.dealCandidateId}:count`, 0, 3);

    for (let i = 0; i < conversionCount; i++) {
      const daysAgo = seededInt(`conversions:${deal.dealCandidateId}:day:${i}`, 0, 10);
      const occurredAt = new Date();
      occurredAt.setDate(occurredAt.getDate() - daysAgo);

      const quantity = seededInt(`conversions:${deal.dealCandidateId}:qty:${i}`, 1, 2);
      const revenueCents = deal.effectivePriceCents * quantity;
      const commissionRatePct = seededInt(`conversions:${deal.dealCandidateId}:rate:${i}`, 4, 12);
      const commissionCents = Math.round((revenueCents * commissionRatePct) / 100);

      await db.insert(conversions).values({
        marketplace: deal.marketplace,
        dealCandidateId: deal.dealCandidateId,
        orderReference: `SEED-${deal.dealCandidateId.slice(0, 8)}-${i}`,
        revenueCents,
        commissionCents,
        currency: "BRL",
        occurredAt,
        metadata: { source: "mock", quantity },
      });
    }
  }
}
