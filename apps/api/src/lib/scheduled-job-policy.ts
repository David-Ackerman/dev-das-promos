import {
  type Database,
  dealCandidates,
  marketplaceProducts,
  offers,
} from "@dev-das-promos/database";
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { scheduleConfigFromEnv } from "./scheduler.js";

/** Re-check queued automatic work against the live kill switch and marketplace allowlist. */
export async function isScheduledDealAllowed(db: Database, dealCandidateId: string) {
  if (!env.SCHEDULE_ENABLED) return false;

  const [row] = await db
    .select({ marketplace: marketplaceProducts.marketplace })
    .from(dealCandidates)
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .where(eq(dealCandidates.id, dealCandidateId));

  return Boolean(row && scheduleConfigFromEnv(env).marketplaces.includes(row.marketplace));
}
