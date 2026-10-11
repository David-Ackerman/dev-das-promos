import {
  type Database,
  dealCandidates,
  marketplaceProducts,
  offers,
  publications,
} from "@dev-das-promos/database";
import type { QueueBundle } from "@dev-das-promos/queue";
import type { Marketplace } from "@dev-das-promos/shared";
import { and, desc, eq, inArray, notExists } from "drizzle-orm";
import { env } from "../env.js";
import {
  currentOfferConditions,
  nonMockMarketplaceProductCondition,
} from "../lib/deal-freshness.js";

/** Statuses eligible for scheduled publishing -- matches what POST /admin/deals/:id/publish already allows. */
const PUBLISHABLE_STATUSES = ["auto_approved", "approved"] as const;

const DEFAULT_LIMIT = 1;
const AUTO_AFFILIATE_MARKETPLACES: Marketplace[] = ["amazon_br", "shopee_br"];

export interface PublishReadyDealsResult {
  enqueued: number;
  dealCandidateIds: string[];
}

/**
 * Finds approved (auto or human) deals that have no publication rows and
 * enqueues content generation for the highest-scoring ones. Existing rows
 * in any state are left for the admin retry flow: a failed status can mean
 * the external channel accepted the post before a timeout.
 *
 * This is the "publish at the best engagement times" half of the scheduled
 * routine (see lib/scheduler.ts): ingestion keeps deal_candidates fresh,
 * this picks from whatever is currently ready at each scheduled publish
 * time, so it always reflects the most-recently-ingested/evaluated data.
 */
export async function publishReadyDeals(
  db: Database,
  queues: QueueBundle,
  options: { limit?: number; marketplaces?: Marketplace[] } = {},
): Promise<PublishReadyDealsResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const marketplaces = (options.marketplaces ?? AUTO_AFFILIATE_MARKETPLACES).filter((marketplace) =>
    AUTO_AFFILIATE_MARKETPLACES.includes(marketplace),
  );
  if (marketplaces.length === 0) return { enqueued: 0, dealCandidateIds: [] };

  const ready = await db
    .select({ id: dealCandidates.id })
    .from(dealCandidates)
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .where(
      and(
        inArray(dealCandidates.status, [...PUBLISHABLE_STATUSES]),
        // Mercado Livre has no supported automatic affiliate-link generator;
        // attempting to publish one would repeatedly fail content generation.
        inArray(marketplaceProducts.marketplace, marketplaces),
        ...(env.NODE_ENV === "production" ? [nonMockMarketplaceProductCondition()] : []),
        // Once a publication row exists, leave retries to an operator. A
        // failed response can follow a successful external post, so the
        // schedule must never blindly retry an ambiguous delivery.
        notExists(
          db
            .select({ id: publications.id })
            .from(publications)
            .where(eq(publications.dealCandidateId, dealCandidates.id)),
        ),
        ...currentOfferConditions(),
      ),
    )
    .orderBy(desc(dealCandidates.dealScore))
    .limit(limit);

  const scheduledDay = new Date().toISOString().slice(0, 10);
  for (const deal of ready) {
    // BullMQ atomically ignores a duplicate job ID, so overlapping schedule
    // events cannot generate the same candidate twice on the same UTC day.
    await queues.contentGeneration.add(
      "generate",
      { dealCandidateId: deal.id, scheduled: true },
      { jobId: `scheduled-${scheduledDay}-${deal.id}` },
    );
  }

  return { enqueued: ready.length, dealCandidateIds: ready.map((d) => d.id) };
}
