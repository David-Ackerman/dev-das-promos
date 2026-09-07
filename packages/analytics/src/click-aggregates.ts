import {
  type Database,
  categories,
  clickEvents,
  dealCandidates,
  marketplaceProducts,
  offers,
  products,
} from "@dev-das-promos/database";
import { type SQL, and, eq, gte, lte, sql } from "drizzle-orm";
import type { AnalyticsDimension, AnalyticsFilters, ClickAggregateRow } from "./types.js";

function keyLabelExpr(dimension: AnalyticsDimension): { key: SQL<string>; label: SQL<string> } {
  switch (dimension) {
    case "channel":
      // clickEvents.channel is a nullable Postgres enum column -- coalesce
      // against a plain string literal only works if both sides are the
      // same type, so the column must be cast to text first. Without the
      // cast, Postgres tries to validate 'unknown' as a value of the
      // publication_channel enum itself and throws 22P02.
      return {
        key: sql<string>`coalesce(${clickEvents.channel}::text, 'unknown')`,
        label: sql<string>`coalesce(${clickEvents.channel}::text, 'unknown')`,
      };
    case "marketplace":
      return {
        key: sql<string>`${marketplaceProducts.marketplace}`,
        label: sql<string>`${marketplaceProducts.marketplace}`,
      };
    case "category":
      return {
        key: sql<string>`coalesce(${products.categoryId}, 'uncategorized')`,
        label: sql<string>`coalesce(${categories.name}, 'Uncategorized')`,
      };
    case "deal":
      return {
        key: sql<string>`${dealCandidates.id}`,
        label: sql<string>`coalesce(${products.name}, ${dealCandidates.id})`,
      };
    case "date":
      return {
        key: sql<string>`to_char(${clickEvents.occurredAt}, 'YYYY-MM-DD')`,
        label: sql<string>`to_char(${clickEvents.occurredAt}, 'YYYY-MM-DD')`,
      };
  }
}

/**
 * Aggregates click counts by the requested dimension. Always joins the
 * full chain (deal -> offer -> marketplace product -> product ->
 * category) so any dimension/filter combination is supported without
 * conditional query building; the dataset size this platform targets
 * makes that join cost negligible.
 */
export async function getClickAggregates(
  db: Database,
  dimension: AnalyticsDimension,
  filters: AnalyticsFilters = {},
): Promise<ClickAggregateRow[]> {
  const { key, label } = keyLabelExpr(dimension);

  const conditions: (SQL | undefined)[] = [
    filters.from ? gte(clickEvents.occurredAt, filters.from) : undefined,
    filters.to ? lte(clickEvents.occurredAt, filters.to) : undefined,
    filters.channel ? eq(clickEvents.channel, filters.channel) : undefined,
    filters.marketplace ? eq(marketplaceProducts.marketplace, filters.marketplace) : undefined,
    filters.categoryId ? eq(products.categoryId, filters.categoryId) : undefined,
    filters.dealCandidateId ? eq(clickEvents.dealCandidateId, filters.dealCandidateId) : undefined,
  ];

  const rows = await db
    .select({ key, label, clicks: sql<number>`count(*)` })
    .from(clickEvents)
    .innerJoin(dealCandidates, eq(clickEvents.dealCandidateId, dealCandidates.id))
    .innerJoin(offers, eq(dealCandidates.offerId, offers.id))
    .innerJoin(marketplaceProducts, eq(offers.marketplaceProductId, marketplaceProducts.id))
    .innerJoin(products, eq(marketplaceProducts.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
    .groupBy(key, label);

  return rows.map((row) => ({ key: row.key, label: row.label, clicks: Number(row.clicks) }));
}
