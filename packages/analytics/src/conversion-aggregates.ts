import {
  type Database,
  categories,
  conversions,
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
} from "@dev-das-promos/database";
import { type SQL, and, eq, gte, lte, sql } from "drizzle-orm";
import type { AnalyticsDimension, AnalyticsFilters, ConversionAggregateRow } from "./types.js";

function keyLabelExpr(dimension: AnalyticsDimension): { key: SQL<string>; label: SQL<string> } {
  switch (dimension) {
    case "channel":
      // Conversions are not attributed to a publication channel in this MVP
      // (see docs/analytics.md) -- everything rolls into one bucket. The
      // explicit ::text cast is required: Postgres rejects a bare,
      // untyped string constant in GROUP BY ("non-integer constant in
      // GROUP BY") since only integer literals are valid as a positional
      // shorthand there.
      return {
        key: sql<string>`'unattributed'::text`,
        label: sql<string>`'Unattributed'::text`,
      };
    case "marketplace":
      return {
        key: sql<string>`${conversions.marketplace}`,
        label: sql<string>`${conversions.marketplace}`,
      };
    case "category":
      return {
        key: sql<string>`coalesce(${products.categoryId}, 'uncategorized')`,
        label: sql<string>`coalesce(${categories.name}, 'Uncategorized')`,
      };
    case "deal":
      return {
        key: sql<string>`coalesce(${conversions.dealCandidateId}, 'unattributed')`,
        label: sql<string>`coalesce(${products.name}, ${conversions.dealCandidateId}, 'Unattributed')`,
      };
    case "date":
      return {
        key: sql<string>`to_char(${conversions.occurredAt}, 'YYYY-MM-DD')`,
        label: sql<string>`to_char(${conversions.occurredAt}, 'YYYY-MM-DD')`,
      };
  }
}

export async function getConversionAggregates(
  db: Database,
  dimension: AnalyticsDimension,
  filters: AnalyticsFilters = {},
): Promise<ConversionAggregateRow[]> {
  const { key, label } = keyLabelExpr(dimension);

  const conditions: (SQL | undefined)[] = [
    filters.from ? gte(conversions.occurredAt, filters.from) : undefined,
    filters.to ? lte(conversions.occurredAt, filters.to) : undefined,
    filters.marketplace ? eq(conversions.marketplace, filters.marketplace) : undefined,
    filters.categoryId ? eq(products.categoryId, filters.categoryId) : undefined,
    filters.dealCandidateId ? eq(conversions.dealCandidateId, filters.dealCandidateId) : undefined,
  ];

  const rows = await db
    .select({
      key,
      label,
      conversions: sql<number>`count(*)`,
      revenueCents: sql<number>`coalesce(sum(${conversions.revenueCents}), 0)`,
      commissionCents: sql<number>`coalesce(sum(${conversions.commissionCents}), 0)`,
    })
    .from(conversions)
    .leftJoin(dealCandidates, eq(conversions.dealCandidateId, dealCandidates.id))
    .leftJoin(offers, eq(dealCandidates.offerId, offers.id))
    .leftJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .leftJoin(products, eq(marketplaceProducts.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
    .groupBy(key, label);

  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    conversions: Number(row.conversions),
    revenueCents: Number(row.revenueCents),
    commissionCents: Number(row.commissionCents),
  }));
}
