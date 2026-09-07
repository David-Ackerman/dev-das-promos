import type { Database } from "@dev-das-promos/database";
import { getClickAggregates } from "./click-aggregates.js";
import { getConversionAggregates } from "./conversion-aggregates.js";
import { mergeAnalyticsRows } from "./merge.js";
import type { AnalyticsDimension, AnalyticsFilters, AnalyticsGroupRow } from "./types.js";

export async function getGroupedAnalytics(
  db: Database,
  dimension: AnalyticsDimension,
  filters: AnalyticsFilters = {},
): Promise<AnalyticsGroupRow[]> {
  const [clicks, conversionRows] = await Promise.all([
    getClickAggregates(db, dimension, filters),
    getConversionAggregates(db, dimension, filters),
  ]);
  return mergeAnalyticsRows(clicks, conversionRows);
}
