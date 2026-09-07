import { getClickAggregates, getConversionAggregates } from "@dev-das-promos/analytics";
import type { Database } from "@dev-das-promos/database";

/** Below this many observed clicks we don't trust a category's conversion rate yet. */
const MIN_CLICKS_FOR_HISTORICAL_SIGNAL = 20;

/**
 * Looks up a real, observed conversion rate for a category from actual
 * click/conversion data, so the deal engine can flip from a heuristic
 * default to a historical figure once enough traffic has flowed through
 * the category (see packages/deal-engine MonetizationResult.basis and
 * docs/deal-engine.md). Returns undefined until there is enough signal.
 */
export async function estimateHistoricalConversionRate(
  db: Database,
  categoryId: string | null | undefined,
): Promise<number | undefined> {
  if (!categoryId) return undefined;

  const [clicks, conversions] = await Promise.all([
    getClickAggregates(db, "category", { categoryId }),
    getConversionAggregates(db, "category", { categoryId }),
  ]);

  const totalClicks = clicks.reduce((sum, row) => sum + row.clicks, 0);
  if (totalClicks < MIN_CLICKS_FOR_HISTORICAL_SIGNAL) return undefined;

  const totalConversions = conversions.reduce((sum, row) => sum + row.conversions, 0);
  return totalConversions / totalClicks;
}
