import { type Database, dealCandidates } from "@dev-das-promos/database";
import type { QueueBundle } from "@dev-das-promos/queue";
import { desc, inArray } from "drizzle-orm";

/** Statuses eligible for scheduled publishing -- matches what POST /admin/deals/:id/publish already allows. */
const PUBLISHABLE_STATUSES = ["auto_approved", "approved"] as const;

const DEFAULT_LIMIT = 5;

export interface PublishReadyDealsResult {
  enqueued: number;
  dealCandidateIds: string[];
}

/**
 * Finds deals that are approved (auto or human) but not yet published, and
 * enqueues content generation for the highest-scoring ones. Once a deal
 * publishes successfully on at least one channel its status flips to
 * "published" (see publishDealToChannel in services/publication.ts), so it
 * naturally drops out of this candidate set on the next run -- no separate
 * "already published" bookkeeping needed here.
 *
 * This is the "publish at the best engagement times" half of the scheduled
 * routine (see lib/scheduler.ts): ingestion keeps deal_candidates fresh,
 * this picks from whatever is currently ready at each scheduled publish
 * time, so it always reflects the most-recently-ingested/evaluated data.
 */
export async function publishReadyDeals(
  db: Database,
  queues: QueueBundle,
  options: { limit?: number } = {},
): Promise<PublishReadyDealsResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;

  const ready = await db
    .select({ id: dealCandidates.id })
    .from(dealCandidates)
    .where(inArray(dealCandidates.status, [...PUBLISHABLE_STATUSES]))
    .orderBy(desc(dealCandidates.dealScore))
    .limit(limit);

  for (const deal of ready) {
    await queues.contentGeneration.add("generate", { dealCandidateId: deal.id });
  }

  return { enqueued: ready.length, dealCandidateIds: ready.map((d) => d.id) };
}
