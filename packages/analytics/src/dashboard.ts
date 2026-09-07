import { type Database, clickEvents, conversions, dealCandidates } from "@dev-das-promos/database";
import { type SQL, and, gte, inArray, lte, sql } from "drizzle-orm";
import type { AnalyticsFilters, DashboardTotals } from "./types.js";

export async function getDashboardTotals(
  db: Database,
  filters: Pick<AnalyticsFilters, "from" | "to"> = {},
): Promise<DashboardTotals> {
  const dealConditions: (SQL | undefined)[] = [
    filters.from ? gte(dealCandidates.createdAt, filters.from) : undefined,
    filters.to ? lte(dealCandidates.createdAt, filters.to) : undefined,
  ];

  const [dealRow] = await db
    .select({
      totalDeals: sql<number>`count(*)`,
      approvedDeals: sql<number>`count(*) FILTER (WHERE ${inArray(dealCandidates.status, ["approved", "auto_approved", "published"])})`,
      publishedDeals: sql<number>`count(*) FILTER (WHERE ${dealCandidates.status} = 'published')`,
    })
    .from(dealCandidates)
    .where(and(...dealConditions.filter((c): c is SQL => c !== undefined)));

  const clickConditions: (SQL | undefined)[] = [
    filters.from ? gte(clickEvents.occurredAt, filters.from) : undefined,
    filters.to ? lte(clickEvents.occurredAt, filters.to) : undefined,
  ];

  const [clickRow] = await db
    .select({ clicks: sql<number>`count(*)` })
    .from(clickEvents)
    .where(and(...clickConditions.filter((c): c is SQL => c !== undefined)));

  const conversionConditions: (SQL | undefined)[] = [
    filters.from ? gte(conversions.occurredAt, filters.from) : undefined,
    filters.to ? lte(conversions.occurredAt, filters.to) : undefined,
  ];

  const [conversionRow] = await db
    .select({
      conversions: sql<number>`count(*)`,
      revenueCents: sql<number>`coalesce(sum(${conversions.revenueCents}), 0)`,
      commissionCents: sql<number>`coalesce(sum(${conversions.commissionCents}), 0)`,
    })
    .from(conversions)
    .where(and(...conversionConditions.filter((c): c is SQL => c !== undefined)));

  const clicks = Number(clickRow?.clicks ?? 0);
  const conversionCount = Number(conversionRow?.conversions ?? 0);
  const commissionCents = Number(conversionRow?.commissionCents ?? 0);

  return {
    totalDeals: Number(dealRow?.totalDeals ?? 0),
    approvedDeals: Number(dealRow?.approvedDeals ?? 0),
    publishedDeals: Number(dealRow?.publishedDeals ?? 0),
    clicks,
    conversions: conversionCount,
    revenueCents: Number(conversionRow?.revenueCents ?? 0),
    commissionCents,
    conversionRate: clicks > 0 ? conversionCount / clicks : undefined,
    epcCents: clicks > 0 ? Math.round(commissionCents / clicks) : undefined,
  };
}
