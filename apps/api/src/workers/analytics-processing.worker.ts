import { getDashboardTotals } from "@dev-das-promos/analytics";
import type { Database } from "@dev-das-promos/database";
import { QUEUE_NAMES } from "@dev-das-promos/queue";
import { type ConnectionOptions, Worker } from "bullmq";

/**
 * Placeholder rollup job. Today packages/analytics computes everything
 * on-demand straight from click_events/conversions/deal_candidates, which
 * is fast enough at this dataset size and always exactly correct. This
 * worker exists so the queue slot and processing pattern are already in
 * place for when a materialized daily-rollup table becomes worthwhile
 * (see docs/analytics.md) -- for now it just recomputes and logs totals
 * as a health signal.
 */
export function createAnalyticsProcessingWorker(db: Database, connection: ConnectionOptions) {
  return new Worker(
    QUEUE_NAMES.analyticsProcessing,
    async () => {
      const totals = await getDashboardTotals(db, {});
      console.log("[analytics-processing] totals snapshot:", totals);
      return totals;
    },
    { connection },
  );
}
